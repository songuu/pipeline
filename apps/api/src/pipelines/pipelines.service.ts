import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  LIFECYCLE_STAGES,
  type LifecycleStageKey,
  type PipelineDefinition,
  type PipelineSourcePolicy,
} from "@deploy-management/shared";
import { ApplicationsService } from "../applications/applications.service";
import { CodeReposService } from "../code-repos/code-repos.service";
import { PipelinesRepository } from "./pipelines.repository";
import type { CreatePipelineDto, UpdatePipelineDto } from "./dto/create-pipeline.dto";

@Injectable()
export class PipelinesService {
  private sequence = 4;

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
    const application = this.applications.get(request.applicationId);
    const repository = this.codeRepos.get(request.repositoryId);
    this.codeRepos.assertReference(repository, request.refType, request.refName);
    const sourcePolicy = normalizeSourcePolicy(request.sourcePolicy, repository.defaultBranch);
    assertRefAllowedByPolicy(request.refType, request.refName, sourcePolicy);
    const stages = this.normalizeStages(request.stages);

    const pipeline: PipelineDefinition = {
      id: `pipe-custom-${this.sequence++}`,
      name: request.name.trim() || `${application.id}-${request.targetEnvironment}-release`,
      applicationId: application.id,
      repositoryId: repository.id,
      repository: repository.url,
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
      serviceConnections: request.serviceConnections ?? ["codeup-readonly", "acr-push", "ack-deploy"],
    };

    await this.repo.prepend(pipeline);
    return pipeline;
  }

  async update(id: string, request: UpdatePipelineDto): Promise<PipelineDefinition> {
    const current = this.get(id);
    const repositoryId = request.repositoryId ?? current.repositoryId;
    const repository = this.codeRepos.get(repositoryId);
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
    this.codeRepos.assertReference(repository, refType, refName);
    const sourcePolicy = normalizeSourcePolicy(request.sourcePolicy ?? current.sourcePolicy, repository.defaultBranch);
    assertRefAllowedByPolicy(refType, refName, sourcePolicy);

    const patch: Partial<PipelineDefinition> = {
      name: request.name?.trim() || current.name,
      repositoryId: repository.id,
      repository: repository.url,
      defaultRefType: refType,
      defaultRef: refName,
      defaultBranch: refType === "branch" ? refName : repository.defaultBranch,
      sourcePolicy,
      targetEnvironment: request.targetEnvironment ?? current.targetEnvironment,
      strategy: request.strategy ?? current.strategy,
      canaryPercent: request.canaryPercent ?? current.canaryPercent,
      requiresApproval: request.requiresApproval ?? current.requiresApproval,
      stages: request.stages ? this.normalizeStages(request.stages) : current.stages,
      triggers: request.triggers ? normalizeTriggers(request.triggers) : current.triggers,
      owner: request.owner?.trim() || current.owner,
      variables: request.variables ?? current.variables ?? defaultVariables(current.targetEnvironment),
      runtimeVariables: request.runtimeVariables ?? current.runtimeVariables ?? [],
      caches: request.caches ?? current.caches ?? defaultCaches(repository.name),
      serviceConnections: request.serviceConnections ?? current.serviceConnections ?? ["codeup-readonly", "acr-push", "ack-deploy"],
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
}

function normalizeTriggers(triggers: string[]): string[] {
  const trimmed = triggers.map((trigger) => trigger.trim()).filter(Boolean);
  return trimmed.length > 0 ? Array.from(new Set(trimmed)) : ["manual"];
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

function defaultVariables(environment: PipelineDefinition["targetEnvironment"]) {
  return [
    { key: "NODE_ENV", value: environment === "prod" ? "production" : environment, description: "运行环境" },
    { key: "IMAGE_TAG", value: "${run.id}-${commit.short}", description: "镜像版本" },
    { key: "DEPLOY_NAMESPACE", value: environment === "prod" ? "mall-prod" : `mall-${environment}`, description: "Kubernetes namespace" },
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
