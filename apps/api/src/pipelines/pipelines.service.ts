import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  type Application,
  DEFAULT_PACKAGE_UPLOAD_CONFIG,
  defaultImageArtifactConfig,
  DEFAULT_PIPELINE_BUILD_CONFIG,
  IMAGE_REGISTRY_PRESETS,
  type ImageArtifactConfig,
  LIFECYCLE_STAGES,
  ensureArtifactUploadStage,
  type GlobalParam,
  type LifecycleStageKey,
  type PipelineBuildConfig,
  type PipelineDefinition,
  type PackageUploadConfig,
  type PipelineSourcePolicy,
  type SourceRepository,
  resolvePackageBuildCommandMode,
  resolvePackageUploadCommandMode,
} from "@deploy-management/shared";
import { ApplicationsService } from "../applications/applications.service";
import { CodeReposService } from "../code-repos/code-repos.service";
import { createStableId } from "../common/ids";
import { PipelinesRepository } from "./pipelines.repository";
import type { CreatePipelineDto, UpdatePipelineDto } from "./dto/create-pipeline.dto";

@Injectable()
export class PipelinesService {
  constructor(
    @Inject(PipelinesRepository) private readonly repo: PipelinesRepository,
    @Inject(ApplicationsService) private readonly applications: ApplicationsService,
    @Inject(CodeReposService) private readonly codeRepos: CodeReposService,
  ) {}

  list(): PipelineDefinition[] {
    return this.repo.snapshot();
  }

  get(id: string): PipelineDefinition {
    const pipeline = this.repo.snapshot().find((item) => item.id === id);
    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${id} not found`);
    }
    return pipeline;
  }

  async create(request: CreatePipelineDto): Promise<PipelineDefinition> {
    const application = this.findApplication(request.applicationId) ?? createDraftApplication(request);
    const realRepository = this.findRepository(request.repositoryId);
    const repository = realRepository ?? createDraftRepository(request, request.repositoryUrl);
    if (realRepository) {
      this.codeRepos.assertReference(realRepository, request.refType, request.refName);
    }
    const sourcePolicy = normalizeSourcePolicy(request.sourcePolicy, repository.defaultBranch);
    assertRefAllowedByPolicy(request.refType, request.refName, sourcePolicy);
    const buildConfig = normalizeBuildConfig(request.buildConfig);
    const imageArtifact = buildConfig.packageMode === "container_image"
      ? normalizeImageArtifact(
          request.imageArtifact,
          application.id,
          repository.name,
          request.serviceConnections?.[1],
        )
      : undefined;
    const packageUpload = buildConfig.packageMode === "container_image"
      ? undefined
      : normalizePackageUpload(request.packageUpload, application.id, repository.name);
    const stages = this.normalizeStages(ensureArtifactUploadStage(request.stages, {
      packageMode: buildConfig.packageMode,
      imageArtifact,
      packageUpload,
    }));

    const pipeline: PipelineDefinition = {
      id: createStableId("pipe"),
      name: request.name.trim() || `${application.id}-${request.targetEnvironment}-release`,
      applicationId: application.id,
      repositoryId: repository.id,
      repository: request.repositoryUrl?.trim() || repository.url,
      defaultBranch: request.refType === "branch" ? request.refName : repository.defaultBranch,
      defaultRefType: request.refType,
      defaultRef: request.refName,
      sourcePolicy,
      targetEnvironment: request.targetEnvironment,
      strategy: request.strategy,
      canaryPercent: request.canaryPercent,
      requiresApproval: request.requiresApproval,
      stages,
      triggers: request.triggers.length > 0 ? request.triggers : ["manual"],
      owner: request.owner.trim() || application.owner,
      variables: request.variables ?? defaultVariables(request.targetEnvironment),
      runtimeVariables: request.runtimeVariables ?? [],
      caches: request.caches ?? defaultCaches(repository.name),
      serviceConnections: request.serviceConnections ?? defaultServiceConnections(repository.provider),
      buildConfig,
      imageArtifact,
      packageUpload,
    };

    await this.repo.prepend(pipeline);
    return pipeline;
  }

  async update(id: string, request: UpdatePipelineDto): Promise<PipelineDefinition> {
    const current = this.get(id);
    const repositoryId = request.repositoryId ?? current.repositoryId;
    const realRepository = this.findRepository(repositoryId);
    const repository = realRepository ?? createDraftRepositoryFromPipeline(current, repositoryId, request);
    const refType = request.refType ?? current.defaultRefType;
    const refName =
      request.refName ??
      (repositoryId === current.repositoryId
        ? current.defaultRef
        : refType === "branch"
          ? repository.defaultBranch
          : repository.tags[0]);
    if (!refName) {
      throw new NotFoundException(`Repository ${repository.id} has no default ${refType}`);
    }
    if (realRepository) {
      this.codeRepos.assertReference(realRepository, refType, refName);
    }
    const sourcePolicy = normalizeSourcePolicy(request.sourcePolicy ?? current.sourcePolicy, repository.defaultBranch);
    assertRefAllowedByPolicy(refType, refName, sourcePolicy);
    const buildConfig = normalizeBuildConfig(request.buildConfig ?? current.buildConfig);
    const imageArtifact = buildConfig.packageMode === "container_image"
      ? normalizeImageArtifact(
          request.imageArtifact ?? current.imageArtifact,
          current.applicationId,
          repository.name,
          request.serviceConnections?.[1] ?? current.serviceConnections?.[1],
        )
      : undefined;
    const packageUpload = buildConfig.packageMode === "container_image"
      ? undefined
      : normalizePackageUpload(
          request.packageUpload ?? current.packageUpload,
          current.applicationId,
          repository.name,
        );

    const patch: Partial<PipelineDefinition> = {
      name: request.name?.trim() || current.name,
      repositoryId: repository.id,
      repository: request.repositoryUrl?.trim() || repository.url || current.repository,
      defaultRefType: refType,
      defaultRef: refName,
      defaultBranch: refType === "branch" ? refName : repository.defaultBranch,
      sourcePolicy,
      targetEnvironment: request.targetEnvironment ?? current.targetEnvironment,
      strategy: request.strategy ?? current.strategy,
      canaryPercent: request.canaryPercent ?? current.canaryPercent,
      requiresApproval: request.requiresApproval ?? current.requiresApproval,
      stages: this.normalizeStages(ensureArtifactUploadStage(request.stages ?? current.stages, {
        packageMode: buildConfig.packageMode,
        imageArtifact,
        packageUpload,
      })),
      triggers: request.triggers ? normalizeTriggers(request.triggers) : current.triggers,
      owner: request.owner?.trim() || current.owner,
      variables: request.variables ?? current.variables ?? defaultVariables(current.targetEnvironment),
      runtimeVariables: request.runtimeVariables ?? current.runtimeVariables ?? [],
      caches: request.caches ?? current.caches ?? defaultCaches(repository.name),
      serviceConnections: request.serviceConnections ?? current.serviceConnections ?? defaultServiceConnections(repository.provider),
      buildConfig,
      imageArtifact,
      packageUpload,
    };

    return this.repo.update(id, patch);
  }

  async delete(id: string): Promise<{ id: string }> {
    this.get(id);
    await this.repo.delete(id);
    return { id };
  }

  normalizeStages(stages: LifecycleStageKey[]): LifecycleStageKey[] {
    const allKeys = new Set<LifecycleStageKey>(LIFECYCLE_STAGES.map((stage) => stage.key));
    const configured = stages.length > 0 ? stages : LIFECYCLE_STAGES.map((stage) => stage.key);
    const deduped = configured.filter(
      (stage, index) => allKeys.has(stage) && configured.indexOf(stage) === index,
    );
    const withSource = deduped.includes("source") ? deduped : (["source", ...deduped] as LifecycleStageKey[]);
    const needsEnv = withSource.some((stage) => ["package", "upload", "deploy", "canary", "promote"].includes(stage));
    if (!needsEnv || withSource.includes("env")) return withSource;
    const buildIndex = withSource.indexOf("build");
    const insertAt = buildIndex >= 0 ? buildIndex + 1 : Math.min(2, withSource.length);
    return [...withSource.slice(0, insertAt), "env", ...withSource.slice(insertAt)];
  }

  private findApplication(id: string): Application | undefined {
    return this.applications.list().find((application) => application.id === id);
  }

  private findRepository(id: string): SourceRepository | undefined {
    return this.codeRepos.list().find((repository) => repository.id === id);
  }
}

function createDraftApplication(request: Pick<CreatePipelineDto, "applicationId" | "repositoryId" | "repositoryUrl" | "owner" | "targetEnvironment">): Application {
  return {
    id: request.applicationId,
    name: request.applicationId,
    owner: request.owner.trim() || "未配置",
    repositoryId: request.repositoryId,
    repository: request.repositoryUrl?.trim() || "",
    defaultBranch: "main",
    language: "Node.js",
    serviceType: "web",
    environments: [request.targetEnvironment],
  };
}

function createDraftRepository(
  request: Pick<CreatePipelineDto, "repositoryId" | "repositoryUrl" | "refType" | "refName" | "owner">,
  repositoryUrl?: string,
): SourceRepository {
  const url = repositoryUrl?.trim() || request.repositoryUrl?.trim() || "";
  const fallbackRef = request.refName || "main";
  const defaultBranch = request.refType === "branch" ? fallbackRef : "main";
  return {
    id: request.repositoryId,
    name: repositoryNameFrom(url, request.repositoryId),
    provider: providerFrom(url),
    url,
    defaultBranch,
    branches: unique([defaultBranch, request.refType === "branch" ? fallbackRef : undefined]),
    tags: unique([request.refType === "tag" ? fallbackRef : undefined]),
    recentCommits: [],
    owner: request.owner.trim() || "未配置",
  };
}

function createDraftRepositoryFromPipeline(
  pipeline: PipelineDefinition,
  repositoryId: string,
  request: Pick<UpdatePipelineDto, "repositoryUrl" | "refType" | "refName">,
): SourceRepository {
  const refType = request.refType ?? pipeline.defaultRefType;
  const refName = request.refName ?? pipeline.defaultRef;
  const url = request.repositoryUrl?.trim() || pipeline.repository;
  const defaultBranch = refType === "branch" ? refName : pipeline.defaultBranch || "main";
  return {
    id: repositoryId,
    name: repositoryNameFrom(url, repositoryId),
    provider: providerFrom(url),
    url,
    defaultBranch,
    branches: unique([defaultBranch, pipeline.defaultBranch, refType === "branch" ? refName : undefined]),
    tags: unique([refType === "tag" ? refName : undefined]),
    recentCommits: [],
    owner: pipeline.owner || "未配置",
  };
}

function normalizeTriggers(triggers: string[]): string[] {
  const trimmed = triggers.map((trigger) => trigger.trim()).filter(Boolean);
  return trimmed.length > 0 ? Array.from(new Set(trimmed)) : ["manual"];
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function repositoryNameFrom(url: string, fallback: string): string {
  const normalizedFallback = fallback.trim() || "repository";
  if (!url.trim()) return normalizedFallback;
  const path = url.replace(/\.git$/i, "").split(/[/:]/).filter(Boolean);
  return path[path.length - 1] || normalizedFallback;
}

function providerFrom(url: string): SourceRepository["provider"] {
  if (url.includes("github.com")) return "github";
  if (url.includes("gitlab")) return "gitlab";
  if (url.includes("gitcode")) return "gitcode";
  if (url.includes("gitea")) return "gitea";
  return "codeup";
}

function normalizeSourcePolicy(
  sourcePolicy: PipelineSourcePolicy | undefined,
  defaultBranch: string,
): PipelineSourcePolicy {
  return {
    allowedBranchPatterns: normalizePatternList(sourcePolicy?.allowedBranchPatterns, [defaultBranch, "release/*"]),
    allowedTagPatterns: normalizePatternList(sourcePolicy?.allowedTagPatterns, ["v*", "release-*"]),
    allowRuntimeBranch: sourcePolicy?.allowRuntimeBranch ?? true,
    allowRuntimeTag: sourcePolicy?.allowRuntimeTag ?? true,
    allowRuntimeCommit: sourcePolicy?.allowRuntimeCommit ?? true,
  };
}

function normalizePatternList(input: string[] | undefined, fallback: string[]): string[] {
  const normalized = Array.from(new Set((input ?? fallback).map((item) => item.trim()).filter(Boolean)));
  return normalized.length > 0 ? normalized : fallback;
}

function assertRefAllowedByPolicy(
  refType: PipelineDefinition["defaultRefType"],
  refName: string,
  sourcePolicy: PipelineSourcePolicy,
): void {
  const patterns = refType === "branch" ? sourcePolicy.allowedBranchPatterns : sourcePolicy.allowedTagPatterns;
  if (!matchesAnyPattern(refName, patterns)) {
    throw new BadRequestException(`${refType} ${refName} is not allowed by source policy`);
  }
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function defaultVariables(environment: PipelineDefinition["targetEnvironment"]): GlobalParam[] {
  return [
    {
      key: "NODE_ENV",
      value: environment === "prod" ? "production" : environment,
      description: "构建时运行环境标识，不应放入密钥。",
      injectionTiming: "build" as const,
      targetStages: ["test", "build", "package"],
    },
    {
      key: "IMAGE_TAG",
      value: "${run.id}-${commit.short}",
      description: "构建产物版本，会写入镜像和制品元数据。",
      injectionTiming: "build" as const,
      targetStages: ["build", "upload", "deploy"],
    },
    {
      key: "DEPLOY_NAMESPACE",
      value: environment === "prod" ? "app-prod" : `app-${environment}`,
      description: "部署时注入到 manifest，不进入镜像。",
      injectionTiming: "deploy" as const,
      targetStages: ["deploy", "canary", "promote"],
    },
  ];
}

function defaultCaches(repositoryName: string) {
  return [
    {
      key: `${repositoryName}-pnpm-store`,
      path: "node_modules/.pnpm-store",
      restoreKeys: [`${repositoryName}-`, "node-"],
      enabled: true,
    },
  ];
}

function defaultServiceConnections(provider: SourceRepository["provider"]) {
  const registryServiceConnections = Object.values(IMAGE_REGISTRY_PRESETS).map((preset) => preset.defaults.serviceConnection);
  return [`${provider}-readonly`, ...registryServiceConnections, "ack-deploy"];
}

function normalizeImageArtifact(
  input: ImageArtifactConfig | undefined,
  applicationId: string,
  repositoryName: string,
  serviceConnection?: string,
): ImageArtifactConfig {
  const base = defaultImageArtifactConfig({
    applicationId,
    name: repositoryName,
    serviceConnections: serviceConnection ? ["", serviceConnection] : undefined,
  });
  return {
    registryProvider: input?.registryProvider ?? base.registryProvider,
    region: input?.region?.trim() || base.region,
    registryUrl: input?.registryUrl?.trim() || base.registryUrl,
    internalRegistryUrl: input?.internalRegistryUrl?.trim() || base.internalRegistryUrl,
    useInternalRegistry: input?.useInternalRegistry ?? base.useInternalRegistry,
    namespace: input?.namespace?.trim() || base.namespace,
    imageName: input?.imageName?.trim() || base.imageName || repositoryName,
    tagTemplate: input?.tagTemplate?.trim() || base.tagTemplate,
    serviceConnection: input?.serviceConnection?.trim() || serviceConnection || base.serviceConnection,
    privateRegistry: input?.privateRegistry ?? base.privateRegistry,
    registryUsername: input?.registryUsername?.trim() || base.registryUsername,
    dockerConfigSecret: input?.dockerConfigSecret?.trim() || base.dockerConfigSecret,
    dockerfilePath: input?.dockerfilePath?.trim() || base.dockerfilePath,
    contextPath: input?.contextPath?.trim() || base.contextPath,
  };
}

function normalizeBuildConfig(input: PipelineBuildConfig | undefined): PipelineBuildConfig {
  const script = input?.packageBuildScript?.trim() || DEFAULT_PIPELINE_BUILD_CONFIG.packageBuildScript;
  const command = input?.packageBuildCommand?.trim();
  const commandMode = resolvePackageBuildCommandMode({
    packageBuildCommandMode: input?.packageBuildCommandMode,
    packageBuildCommand: command,
  });
  const outputPaths = Array.from(
    new Set(
      (input?.packageOutputPaths?.length ? input.packageOutputPaths : DEFAULT_PIPELINE_BUILD_CONFIG.packageOutputPaths)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
  return {
    packageMode: input?.packageMode ?? DEFAULT_PIPELINE_BUILD_CONFIG.packageMode,
    runtime: input?.runtime ?? DEFAULT_PIPELINE_BUILD_CONFIG.runtime,
    contextPath: input?.contextPath?.trim() || DEFAULT_PIPELINE_BUILD_CONFIG.contextPath,
    packageBuildCommandMode: commandMode,
    packageBuildScript: script,
    ...(command ? { packageBuildCommand: command } : {}),
    packageOutputPaths: outputPaths.length > 0 ? outputPaths : DEFAULT_PIPELINE_BUILD_CONFIG.packageOutputPaths,
  };
}

function normalizePackageUpload(
  input: PackageUploadConfig | undefined,
  applicationId: string,
  repositoryName: string,
): PackageUploadConfig {
  const targetPathTemplate =
    input?.targetPathTemplate?.trim() ||
    DEFAULT_PACKAGE_UPLOAD_CONFIG.targetPathTemplate;
  const command = input?.customUploadCommand?.trim();
  const commandMode = resolvePackageUploadCommandMode({
    provider: input?.provider ?? DEFAULT_PACKAGE_UPLOAD_CONFIG.provider,
    customUploadCommandMode: input?.customUploadCommandMode,
    customUploadCommand: command,
  });
  return {
    provider: input?.provider ?? DEFAULT_PACKAGE_UPLOAD_CONFIG.provider,
    customUploadCommandMode: commandMode,
    endpoint: input?.endpoint?.trim() || DEFAULT_PACKAGE_UPLOAD_CONFIG.endpoint,
    publicBaseUrl: input?.publicBaseUrl?.trim() || input?.accessDomain?.trim(),
    accessDomain: input?.accessDomain?.trim() || input?.publicBaseUrl?.trim(),
    targetPathTemplate,
    serviceConnection: input?.serviceConnection?.trim() || DEFAULT_PACKAGE_UPLOAD_CONFIG.serviceConnection,
    ...(command ? { customUploadCommand: command } : {}),
  };
}
