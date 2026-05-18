import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  DEFAULT_PIPELINE_BUILD_CONFIG,
  type Application,
  type ApprovalRequest,
  type ApprovalStatus,
  type GitReferenceType,
  type PipelineDefinition,
  type PipelineRun,
  type RunHandle,
  type StoredRunEvent,
  type SourceRepository,
  type StartPipelineRunParams,
  type TriggerRunRequest,
  ensureRegistryUploadStage,
  resolveImageArtifact,
} from "@deploy-management/shared";
import { ApplicationsService } from "../applications/applications.service";
import { ApprovalsService } from "../approvals/approvals.service";
import { ArtifactsService } from "../artifacts/artifacts.service";
import { AuditService } from "../audit/audit.service";
import { createStableId } from "../common/ids";
import { CodeReposService } from "../code-repos/code-repos.service";
import { LifecycleEngine } from "../lifecycle/lifecycle.engine";
import { PipelinesService } from "../pipelines/pipelines.service";
import { RunEventsRepository } from "./run-events.repository";
import { RunsRepository } from "./runs.repository";
import type { TriggerRunDto } from "./dto/trigger-run.dto";

@Injectable()
export class RunsService {
  private readonly liveTimers = new Map<string, Array<ReturnType<typeof setTimeout>>>();
  private readonly runHandles = new Map<string, RunHandle>();

  constructor(
    @Inject(RunsRepository) private readonly repo: RunsRepository,
    @Inject(PipelinesService) private readonly pipelines: PipelinesService,
    @Inject(ApplicationsService) private readonly applications: ApplicationsService,
    @Inject(CodeReposService) private readonly codeRepos: CodeReposService,
    @Inject(LifecycleEngine) private readonly lifecycle: LifecycleEngine,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
    @Inject(ArtifactsService) private readonly artifacts: ArtifactsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RunEventsRepository) private readonly runEvents: RunEventsRepository,
  ) {}

  list(): PipelineRun[] {
    return this.repo.snapshot();
  }

  get(id: string): PipelineRun {
    const run = this.repo.snapshot().find((item) => item.id === id);
    if (!run) {
      throw new NotFoundException(`Pipeline run ${id} not found`);
    }
    return run;
  }

  getLogs(id: string): string[] {
    return this.get(id).stages.flatMap((stage) => stage.logs.map((line) => `[${stage.title}] ${line}`));
  }

  getEvents(id: string): StoredRunEvent[] {
    this.get(id);
    return this.runEvents.listForRun(id);
  }

  /**
   * Trigger a pipeline run. The platform-native shape (TriggerRunRequest) is
   * used; controllers translate Yunxiao-shaped StartPipelineRunParams to this
   * shape before calling. Runs always go through the realtime ExecutorAdapter
   * (local-docker / tekton); the legacy `instant` mode was retired in sprint-1.
   */
  async trigger(
    pipelineId: string,
    request: TriggerRunRequest,
  ): Promise<PipelineRun> {
    const pipeline = this.pipelines.get(pipelineId);
    const application = this.findApplication(pipeline.applicationId) ?? createDraftApplication(pipeline);
    const realRepository = this.findRepository(request.repositoryId ?? pipeline.repositoryId);
    const repository = realRepository ?? createDraftRepositoryFromPipeline(pipeline, request.repositoryId ?? pipeline.repositoryId, request);
    const refType = request.refType ?? pipeline.defaultRefType;
    const refName =
      request.refName ??
      request.branch ??
      request.tag ??
      pipeline.defaultRef ??
      (refType === "branch" ? repository.defaultBranch : repository.tags[0]);
    if (!refName) {
      throw new BadRequestException(`Pipeline ${pipelineId} 缺少有效的 refName`);
    }
    if (!repository.url.trim()) {
      throw new BadRequestException(`Pipeline ${pipelineId} 缺少仓库地址，请先完成流水线源配置`);
    }
    if (realRepository) {
      this.codeRepos.assertReference(realRepository, refType, refName);
    }

    const requestedStages = request.stages ? this.pipelines.normalizeStages(request.stages) : pipeline.stages;
    const runtimeStages = this.pipelines.normalizeStages(
      ensureRegistryUploadStage(requestedStages, resolveImageArtifact(pipeline)),
    );
    const runPipeline: PipelineDefinition = {
      ...pipeline,
      repositoryId: repository.id,
      repository: repository.url,
      defaultRefType: refType,
      defaultRef: refName,
      defaultBranch: refType === "branch" ? refName : repository.defaultBranch,
      targetEnvironment: request.environment ?? pipeline.targetEnvironment,
      canaryPercent: request.canaryPercent ?? pipeline.canaryPercent,
      stages: runtimeStages,
    };
    this.assertSourcePolicy(pipeline, refType, refName, request.commitSha);
    this.assertRealArtifactPrerequisites(runPipeline);
    const runId = createStableId("run");
    const resolvedCommit = await this.resolveRunCommit(
      runPipeline,
      repository,
      refType,
      refName,
      request.commitSha,
      request.repositoryAccessToken,
    );
    const { repositoryAccessToken: _repositoryAccessToken, ...safeRequest } = request;

    const run = this.lifecycle.createRun({
      pipeline: runPipeline,
      applicationName: application.name,
      request: {
        ...safeRequest,
        repositoryId: repository.id,
        refType,
        refName,
        branch: refType === "branch" ? refName : repository.defaultBranch,
        tag: refType === "tag" ? refName : undefined,
        commitSha: request.commitSha,
      },
      runId,
      resolvedCommit,
    });

    await this.repo.prepend(run);
    this.scheduleRealtimeRun(run);

    await this.audit.record(
      run.actor,
      "trigger_pipeline",
      `${runPipeline.name}/${run.id}/${refType}:${refName}`,
    );
    return run;
  }

  async cancel(runId: string): Promise<PipelineRun> {
    const run = this.get(runId);
    this.clearRunTimers(runId);
    const handle = this.runHandles.get(runId) ?? run.executor;
    if (handle) {
      await this.lifecycle.cancelExecutor(handle).catch(() => undefined);
    }
    this.lifecycle.cancel(run);
    await this.audit.record(run.actor, "cancel_run", run.id);
    return run;
  }

  async promote(runId: string): Promise<PipelineRun> {
    const run = this.get(runId);
    this.clearRunTimers(runId);
    this.lifecycle.completePromotion(run);
    await this.artifacts.upsertFromRun(run, "provenance");
    await this.audit.record("system", "promote_run", run.id);
    return run;
  }

  async decideApproval(
    approvalId: string,
    decision: ApprovalStatus,
    actor: string,
  ): Promise<{ approval: ApprovalRequest; run: PipelineRun }> {
    if (!["approved", "rejected"].includes(decision)) {
      const approval = this.approvals.get(approvalId);
      const run = this.get(approval.runId);
      return { approval, run };
    }

    const approval = await this.approvals.decide(approvalId, decision, actor);
    const run = this.get(approval.runId);
    this.lifecycle.markApproval(run, decision === "approved", actor);
    if (decision === "approved") {
      await this.artifacts.upsertFromRun(run, "provenance");
    }
    await this.audit.record(actor, `approval_${decision}`, approval.runId);
    return { approval, run };
  }

  /**
   * Translate a Yunxiao-style StartPipelineRunParams payload into a platform
   * TriggerRunRequest, picking the first matching repository / ref.
   */
  toTriggerRequest(pipeline: PipelineDefinition, params: StartPipelineRunParams, actor: string): TriggerRunRequest {
    const repository = this.findRepository(pipeline.repositoryId) ?? createDraftRepositoryFromPipeline(pipeline, pipeline.repositoryId, {});
    const branch = this.findFirstRef(repository, params.runningBranchs);
    const tag = this.findFirstRef(repository, params.runningTags);
    const refType: TriggerRunRequest["refType"] = tag ? "tag" : "branch";
    const refName = tag ?? branch ?? pipeline.defaultRef;
    return {
      repositoryId: pipeline.repositoryId,
      refType,
      refName,
      actor,
    };
  }

  private findFirstRef(repository: SourceRepository, mapping?: Record<string, string>): string | undefined {
    if (!mapping) return undefined;
    const exact = mapping[repository.url];
    if (exact) return exact;
    const first = Object.values(mapping)[0];
    return typeof first === "string" ? first : undefined;
  }

  private findApplication(id: string): Application | undefined {
    return this.applications.list().find((application) => application.id === id);
  }

  private findRepository(id: string): SourceRepository | undefined {
    return this.codeRepos.list().find((repository) => repository.id === id);
  }

  private assertSourcePolicy(
    pipeline: PipelineDefinition,
    refType: TriggerRunRequest["refType"],
    refName: string,
    commitSha?: string,
  ): void {
    const policy = pipeline.sourcePolicy;
    if (!policy) return;

    const isDefaultRef = refType === pipeline.defaultRefType && refName === pipeline.defaultRef;
    if (refType === "branch") {
      if (!isDefaultRef && !policy.allowRuntimeBranch) {
        throw new BadRequestException(`Pipeline ${pipeline.id} does not allow runtime branch selection`);
      }
      if (!matchesAnyPattern(refName, policy.allowedBranchPatterns)) {
        throw new BadRequestException(`Branch ${refName} is not allowed by source policy`);
      }
    }

    if (refType === "tag") {
      if (!isDefaultRef && !policy.allowRuntimeTag) {
        throw new BadRequestException(`Pipeline ${pipeline.id} does not allow runtime tag selection`);
      }
      if (!matchesAnyPattern(refName, policy.allowedTagPatterns)) {
        throw new BadRequestException(`Tag ${refName} is not allowed by source policy`);
      }
    }

    if (commitSha && !policy.allowRuntimeCommit) {
      throw new BadRequestException(`Pipeline ${pipeline.id} does not allow runtime commit override`);
    }
  }

  private assertRealArtifactPrerequisites(pipeline: PipelineDefinition): void {
    const stages = new Set(pipeline.stages);
    const requiresRealBuild = stages.has("build") || stages.has("upload");
    if (!requiresRealBuild) return;

    const image = resolveImageArtifact(pipeline);
    const buildConfig = pipeline.buildConfig ?? DEFAULT_PIPELINE_BUILD_CONFIG;
    const missing: string[] = [];

    const backend = this.lifecycle.backendTag;
    if (backend !== "tekton" && backend !== "local-docker") {
      missing.push(`执行器需要使用 EXECUTOR=tekton 或 EXECUTOR=local-docker，当前是 ${backend}`);
    }
    if (backend === "tekton" && process.env.TEKTON_ALLOW_SIMULATED_FALLBACK === "true") {
      missing.push("TEKTON_ALLOW_SIMULATED_FALLBACK 仍为 true，真实构建不允许降级成模拟结果");
    }
    if (!pipeline.repository.trim()) {
      missing.push("仓库地址不能为空，真实构建需要从 Git 仓库 checkout 源码");
    }
    if ((stages.has("build") || stages.has("upload")) && !stages.has("source") && !process.env.TEKTON_PIPELINE_REF) {
      missing.push("inline Pipeline 的真实打包/上传必须包含 source 阶段，用于正式拉取代码");
    }
    if (!image.registryUrl.trim()) {
      missing.push("镜像仓库地址 imageArtifact.registryUrl 不能为空");
    }
    if (!image.namespace.trim()) {
      missing.push("镜像 namespace/project 不能为空");
    }
    if (!image.imageName.trim()) {
      missing.push("镜像仓库名称 imageName 不能为空");
    }
    if (!image.tagTemplate.trim()) {
      missing.push("镜像 Tag 模板 tagTemplate 不能为空");
    }
    if (stages.has("build") || stages.has("upload")) {
      if (!buildConfig.packageBuildScript.trim()) {
        missing.push("package.json 打包脚本不能为空，请配置 buildConfig.packageBuildScript，例如 build 或 build:prod");
      }
      if (buildConfig.packageOutputPaths.length === 0) {
        missing.push("真实打包需要至少一个产物目录，例如 .next、dist、build 或 out");
      }
      if (!image.dockerfilePath.trim()) {
        missing.push("Dockerfile 路径不能为空");
      }
      if (!image.contextPath.trim()) {
        missing.push("构建上下文 contextPath 不能为空");
      }
      if (backend === "tekton" && !process.env.TEKTON_PIPELINE_REF && !process.env.TEKTON_SOURCE_PVC) {
        missing.push("缺少 TEKTON_SOURCE_PVC，inline Pipeline 需要 source-ws PVC 承载真实 checkout、package 打包产物和 Docker build 上下文");
      }
    }
    if (stages.has("upload")) {
      if (!image.serviceConnection.trim()) {
        missing.push("上传服务连接不能为空");
      }
      if (backend === "tekton" && image.privateRegistry && !image.dockerConfigSecret?.trim() && !process.env.TEKTON_DOCKER_SECRET) {
        missing.push("私有镜像仓库需要 docker-registry Secret：配置 imageArtifact.dockerConfigSecret 或 TEKTON_DOCKER_SECRET");
      }
      if (backend === "local-docker" && image.privateRegistry && !hasLocalRegistryPassword()) {
        missing.push("本机 Docker 推送私有镜像需要设置 ACR_PASSWORD、ALIYUN_ACR_PASSWORD、REGISTRY_PASSWORD 或 DOCKER_PASSWORD");
      }
    }

    if (missing.length > 0) {
      throw new BadRequestException(`真实打包/上传前置条件缺失：${missing.join("；")}`);
    }
  }

  private async resolveRunCommit(
    pipeline: PipelineDefinition,
    repository: SourceRepository,
    refType: GitReferenceType,
    refName: string,
    commitSha?: string,
    repositoryAccessToken?: string,
  ): Promise<string> {
    if (commitSha?.trim()) return commitSha.trim();
    const localCommit = refType === "branch" && refName === repository.defaultBranch
      ? repository.recentCommits[0]?.sha
      : undefined;
    if (localCommit) return localCommit;

    const requiresRealBuild = pipelineRequiresRealArtifacts(pipeline);
    if (requiresRealBuild) {
      return this.codeRepos.resolveCommit({
        url: pipeline.repository,
        provider: repository.provider,
        accessToken: repositoryAccessToken,
        refType,
        refName,
      });
    }

    return createStableId("unresolved-commit");
  }

  private scheduleRealtimeRun(run: PipelineRun): void {
    this.clearRunTimers(run.id);
    void this.startRealtimeExecutorRun(run);
  }

  private async ensureApproval(run: PipelineRun): Promise<void> {
    if (this.approvals.pendingForRun(run.id)) return;
    await this.approvals.createForRun(run);
  }

  private async startRealtimeExecutorRun(run: PipelineRun): Promise<void> {
    try {
      const handle = await this.lifecycle.startExecutor(run);
      this.runHandles.set(run.id, handle);
      void this.consumeExecutorEvents(run, handle);
      await this.syncExecutorRun(run, handle);
    } catch (error) {
      this.failExecutorRun(run, `执行器启动失败: ${describeError(error)}`);
    }
  }

  private async syncExecutorRun(run: PipelineRun, handle: RunHandle): Promise<void> {
    if (this.isTerminal(run)) return;
    try {
      const status = await this.lifecycle.executorStatus(handle);
      await this.runEvents.recordStatusSnapshot(handle, status);
      this.lifecycle.syncExecutorStatus(run, status);
      await this.upsertCompletedStageArtifacts(run);

      if (run.status === "waiting_approval") {
        await this.artifacts.upsertFromRun(run);
        await this.ensureApproval(run);
        this.clearRunTimers(run.id);
        return;
      }

      if (run.status === "success") {
        await this.artifacts.upsertFromRun(run);
        await this.artifacts.upsertFromRun(run, "provenance");
        this.clearRunTimers(run.id);
        return;
      }

      if (this.isTerminal(run)) {
        this.clearRunTimers(run.id);
        return;
      }
    } catch (error) {
      this.failExecutorRun(run, `执行器状态同步失败: ${describeError(error)}`);
      return;
    }

    this.trackTimer(
      run.id,
      setTimeout(() => {
        void this.syncExecutorRun(run, handle);
      }, 700),
    );
  }

  private async upsertCompletedStageArtifacts(run: PipelineRun): Promise<void> {
    for (const stage of run.stages) {
      if (stage.status === "success") {
        await this.artifacts.upsertFromStage(run, stage.key);
      }
    }
  }

  private async consumeExecutorEvents(run: PipelineRun, handle: RunHandle): Promise<void> {
    try {
      for await (const event of this.lifecycle.executorEvents(handle)) {
        await this.runEvents.append(event, handle.backend);
        if (this.isTerminal(run)) return;
      }
    } catch (error) {
      await this.runEvents.append({
        runId: run.id,
        type: "status",
        timestamp: new Date().toISOString(),
        payload: {
          status: "EVENT_STREAM_FAILED",
          error: describeError(error),
        },
      }, "control-plane");
    }
  }

  private failExecutorRun(run: PipelineRun, message: string): void {
    const stage =
      run.stages.find((item) => item.status === "running") ??
      run.stages.find((item) => item.status === "pending") ??
      run.stages[0];
    if (stage) {
      this.lifecycle.failStage(stage, run, [message]);
    } else {
      run.status = "failed";
      run.updatedAt = new Date().toISOString();
    }
    this.clearRunTimers(run.id);
  }

  private isTerminal(run: PipelineRun): boolean {
    return ["success", "failed", "canceled"].includes(run.status);
  }

  private trackTimer(runId: string, timer: ReturnType<typeof setTimeout>): void {
    this.liveTimers.set(runId, [...(this.liveTimers.get(runId) ?? []), timer]);
  }

  private clearRunTimers(runId: string): void {
    const timers = this.liveTimers.get(runId) ?? [];
    timers.forEach((timer) => clearTimeout(timer));
    this.liveTimers.delete(runId);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasLocalRegistryPassword(): boolean {
  return Boolean(process.env.ACR_PASSWORD || process.env.ALIYUN_ACR_PASSWORD || process.env.REGISTRY_PASSWORD || process.env.DOCKER_PASSWORD);
}

function pipelineRequiresRealArtifacts(pipeline: PipelineDefinition): boolean {
  return pipeline.stages.includes("build") || pipeline.stages.includes("upload");
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function createDraftApplication(pipeline: PipelineDefinition): Application {
  return {
    id: pipeline.applicationId,
    name: pipeline.applicationId,
    owner: pipeline.owner,
    repositoryId: pipeline.repositoryId,
    repository: pipeline.repository,
    defaultBranch: pipeline.defaultBranch,
    language: "Node.js",
    serviceType: "web",
    environments: [pipeline.targetEnvironment],
  };
}

function createDraftRepositoryFromPipeline(
  pipeline: PipelineDefinition,
  repositoryId: string,
  request: Pick<TriggerRunRequest, "refType" | "refName" | "branch" | "tag">,
): SourceRepository {
  const refType = request.refType ?? pipeline.defaultRefType;
  const refName = request.refName ?? request.branch ?? request.tag ?? pipeline.defaultRef;
  const defaultBranch = refType === "branch" ? refName : pipeline.defaultBranch || "main";
  return {
    id: repositoryId,
    name: repositoryNameFrom(pipeline.repository, repositoryId),
    provider: providerFrom(pipeline.repository),
    url: pipeline.repository,
    defaultBranch,
    branches: unique([defaultBranch, pipeline.defaultBranch, refType === "branch" ? refName : undefined]),
    tags: unique([refType === "tag" ? refName : undefined]),
    recentCommits: [],
    owner: pipeline.owner || "未配置",
  };
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
