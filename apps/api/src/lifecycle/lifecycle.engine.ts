import { Inject, Injectable } from "@nestjs/common";
import {
  DEFAULT_PIPELINE_BUILD_CONFIG,
  getLifecycleStage,
  type GlobalParam,
  type JobStatus,
  type LifecycleStageKey,
  type PipelineDefinition,
  type PipelineSource,
  type PipelineRun,
  type PipelineStageRun,
  type RunHandle,
  type RunEvent,
  type RunStatus,
  type SourceRepositoryProvider,
  type StageStatus,
  type StartRunInput,
  type TriggerRunRequest,
  resolveImageArtifact,
} from "@deploy-management/shared";
// LifecycleEngine 不再持有 simulated 行为；真实运行只走 ExecutorAdapter（local-docker / tekton）。
// 历史的 simulateUntilGate 在 controller 与 dev seed 都不再调用，已于 sprint-1 清理。
import { EXECUTOR_ADAPTER, type ExecutorAdapter } from "./executor-adapter";
import { STAGE_DURATIONS, buildStageLogs } from "../executors/stage-templates";

const IMAGE_PARAM_KEYS = new Set([
  "REGISTRY_PROVIDER",
  "IMAGE_REGISTRY",
  "IMAGE_REPOSITORY",
  "IMAGE_NAME",
  "IMAGE_NAMESPACE",
  "IMAGE_TAG",
  "IMAGE_REF",
  "DOCKERFILE_PATH",
  "BUILD_CONTEXT",
  "BUILD_RUNTIME",
  "REGISTRY_SERVICE_CONNECTION",
  "REGISTRY_USERNAME",
  "REGISTRY_DOCKER_SECRET",
  "PACKAGE_BUILD_SCRIPT",
  "PACKAGE_OUTPUT_PATHS",
]);

/**
 * LifecycleEngine 不再持有模拟逻辑；它负责：
 *   1. 根据 PipelineDefinition + TriggerRunRequest 构造一个不可变 PipelineRun
 *   2. 把"是否已经走到审批门"这种业务半态推进到正确状态
 *   3. 把执行操作委托给 ExecutorAdapter（只发出意图）
 *
 * 状态机仍然是面向用户视角（PipelineRunStatus），与 Yunxiao 的 JobStatus 由
 * shared 中的 toYunxiaoRunStatus 统一映射。
 */
@Injectable()
export class LifecycleEngine {
  constructor(
    @Inject(EXECUTOR_ADAPTER) private readonly executor: ExecutorAdapter,
  ) {}

  createRun(input: {
    pipeline: PipelineDefinition;
    applicationName: string;
    request: TriggerRunRequest;
    runId: string;
    resolvedCommit: string;
  }): PipelineRun {
    const now = new Date().toISOString();
    const refType = input.request.refType ?? input.pipeline.defaultRefType;
    const refName = input.request.refName ?? input.pipeline.defaultRef;
    const branch = refType === "branch" ? refName : input.pipeline.defaultBranch;
    const tag = refType === "tag" ? refName : undefined;
    const commit = input.resolvedCommit;
    const environment = input.request.environment ?? input.pipeline.targetEnvironment;
    const canaryPercent = input.request.canaryPercent ?? input.pipeline.canaryPercent;
    const stages = input.pipeline.stages.map((key) => this.createStage(key, "pending"));

    return {
      id: input.runId,
      pipelineId: input.pipeline.id,
      pipelineName: input.pipeline.name,
      applicationId: input.pipeline.applicationId,
      applicationName: input.applicationName,
      actor: input.request.actor ?? "RO",
      repositoryId: input.pipeline.repositoryId,
      repository: input.pipeline.repository,
      refType,
      refName,
      branch,
      tag,
      commit,
      environment,
      status: "queued",
      progress: 0,
      canaryPercent,
      createdAt: now,
      updatedAt: now,
      definitionSnapshot: { ...input.pipeline, targetEnvironment: environment, canaryPercent },
      stages,
    };
  }

  async startExecutor(run: PipelineRun): Promise<RunHandle> {
    const handle = await this.executor.start(this.toStartRunInput(run));
    run.executor = handle;
    run.stages.forEach((stage) => {
      stage.metadata = {
        ...stage.metadata,
        executorBackend: handle.backend,
      };
    });
    run.updatedAt = new Date().toISOString();
    return handle;
  }

  async executorStatus(handle: RunHandle): Promise<RunStatus> {
    return this.executor.status(handle);
  }

  executorEvents(handle: RunHandle): AsyncIterable<RunEvent> {
    return this.executor.events(handle);
  }

  async cancelExecutor(handle: RunHandle): Promise<void> {
    await this.executor.cancel(handle);
  }

  syncExecutorStatus(run: PipelineRun, status: RunStatus): PipelineRun {
    const executorStages = new Map(
      status.stages.map((stage) => [stage.name as LifecycleStageKey, stage]),
    );
    let waitingForApproval = false;

    run.stages.forEach((stage) => {
      const executorStage = executorStages.get(stage.key);
      if (!executorStage) return;

      const nextStatus = this.toStageStatus(stage.key, executorStage.status, run.definitionSnapshot.requiresApproval);
      if (nextStatus === "running") {
        this.syncRunningStage(stage, run, executorStage, status);
        return;
      }
      if (nextStatus === "success" || nextStatus === "failed") {
        this.syncFinishedStage(stage, run, executorStage, nextStatus);
        return;
      }
      if (nextStatus === "waiting") {
        waitingForApproval = true;
        this.waitForApproval(run);
        return;
      }
      if (nextStatus === "skipped") {
        stage.status = "skipped";
        stage.logs = stage.logs.length ? stage.logs : [`${stage.title} 已由执行器跳过。`];
        stage.metadata = {
          ...stage.metadata,
          executorStatus: executorStage.status,
        };
      }
    });

    if (status.status === "SUCCESS") {
      run.status = "success";
      run.progress = 100;
    } else if (status.status === "FAIL") {
      run.status = "failed";
      run.progress = this.calculateProgress(run);
    } else if (status.status === "CANCELED") {
      run.status = "canceled";
      run.progress = this.calculateProgress(run);
    } else if (waitingForApproval) {
      run.status = "waiting_approval";
      run.progress = this.calculateProgress(run);
    } else if (run.stages.some((stage) => stage.status === "running" || stage.status === "success")) {
      run.status = "running";
      run.progress = this.calculateProgress(run);
    } else {
      run.status = "queued";
      run.progress = this.calculateProgress(run);
    }

    if (status.finishedAt) {
      run.updatedAt = status.finishedAt;
    } else {
      run.updatedAt = new Date().toISOString();
    }
    return run;
  }

  completePromotion(run: PipelineRun): PipelineRun {
    run.stages.forEach((stage) => {
      if (stage.status === "pending" || stage.status === "waiting" || stage.status === "running") {
        this.finishStage(stage, "success", run);
      }
    });
    run.status = "success";
    run.progress = 100;
    run.updatedAt = new Date().toISOString();
    return run;
  }

  startStage(stage: PipelineStageRun, run: PipelineRun): PipelineRun {
    const now = new Date().toISOString();
    stage.status = "running";
    stage.startedAt = stage.startedAt ?? now;
    stage.finishedAt = undefined;
    stage.durationMs = undefined;
    stage.logs = this.buildRunningLogs(stage, run);
    stage.metadata = {
      ...stage.metadata,
      status: "running",
    };
    run.status = "running";
    run.progress = this.calculateProgress(run);
    run.updatedAt = now;
    return run;
  }

  appendStageLog(stage: PipelineStageRun, run: PipelineRun, line: string): PipelineRun {
    if (!stage.logs.includes(line)) {
      stage.logs = [...stage.logs, line];
    }
    run.updatedAt = new Date().toISOString();
    return run;
  }

  succeedStage(stage: PipelineStageRun, run: PipelineRun, extraLogs: string[] = []): PipelineRun {
    this.finishStage(stage, "success", run, extraLogs);
    return run;
  }

  failStage(stage: PipelineStageRun, run: PipelineRun, extraLogs: string[] = []): PipelineRun {
    this.finishStage(stage, "failed", run, extraLogs);
    run.status = "failed";
    run.progress = this.calculateProgress(run);
    run.updatedAt = new Date().toISOString();
    return run;
  }

  waitForApproval(run: PipelineRun): PipelineRun {
    const approvalStage = run.stages.find((stage) => stage.key === "approval");
    if (!approvalStage) return run;
    approvalStage.status = "waiting";
    approvalStage.startedAt = approvalStage.startedAt ?? new Date().toISOString();
    approvalStage.logs = [
      "生产环境命中审批门禁。",
      `灰度比例 ${run.canaryPercent}% 已完成，等待 owner 与 SRE 审批后继续全量。`,
    ];
    approvalStage.metadata = {
      ...approvalStage.metadata,
      status: "waiting",
    };
    run.status = "waiting_approval";
    run.progress = this.calculateProgress(run);
    run.updatedAt = new Date().toISOString();
    return run;
  }

  markApproval(run: PipelineRun, approved: boolean, actor: string): PipelineRun {
    const approvalStage = run.stages.find((stage) => stage.key === "approval");
    if (!approvalStage) return run;

    if (!approved) {
      this.finishStage(approvalStage, "failed", run, [`${actor} 驳回生产发布。`]);
      const promote = run.stages.find((stage) => stage.key === "promote");
      if (promote) {
        promote.status = "skipped";
        promote.logs = ["审批驳回，跳过全量发布。"];
      }
      run.status = "failed";
      run.progress = this.calculateProgress(run);
      run.updatedAt = new Date().toISOString();
      return run;
    }

    this.finishStage(approvalStage, "success", run, [`${actor} 审批通过，继续执行全量发布。`]);
    this.completePromotion(run);
    return run;
  }

  cancel(run: PipelineRun): PipelineRun {
    run.status = "canceled";
    run.stages.forEach((stage) => {
      if (stage.status === "pending" || stage.status === "running" || stage.status === "waiting") {
        stage.status = "skipped";
        stage.logs = [...stage.logs, "运行已取消。"];
      }
    });
    run.updatedAt = new Date().toISOString();
    return run;
  }

  /** Returns the executor backend tag (used in audit logs / UI badges). */
  get backendTag(): string {
    return this.executor.backend;
  }

  private createStage(key: LifecycleStageKey, status: StageStatus): PipelineStageRun {
    const spec = getLifecycleStage(key);
    return {
      id: `stage-${key}`,
      key,
      title: spec.title,
      status,
      logs: [],
      metadata: {
        adapter: spec.adapter,
        required: spec.required,
      },
    };
  }

  private toStartRunInput(run: PipelineRun): StartRunInput {
    const image = resolveImageArtifact(run.definitionSnapshot, run);
    const buildConfig = run.definitionSnapshot.buildConfig ?? DEFAULT_PIPELINE_BUILD_CONFIG;
    const variables: GlobalParam[] = [
      { key: "ENVIRONMENT", value: run.environment },
      { key: "CANARY_PERCENT", value: String(run.canaryPercent) },
      { key: "COMMIT", value: run.commit },
      { key: "REF_TYPE", value: run.refType },
      { key: "REF_NAME", value: run.refName },
      ...(run.definitionSnapshot.variables ?? []).filter((param) => !IMAGE_PARAM_KEYS.has(param.key)),
      ...(run.definitionSnapshot.runtimeVariables ?? []).map((param) => ({
        ...param,
        key: `runtime.${param.key}`,
        injectionTiming: param.injectionTiming ?? "runtime",
      })),
      { key: "REGISTRY_PROVIDER", value: image.registryProvider ?? "custom" },
      { key: "IMAGE_REGISTRY", value: image.registryUrl },
      { key: "IMAGE_REPOSITORY", value: image.repository },
      { key: "IMAGE_NAME", value: image.imageName },
      { key: "IMAGE_NAMESPACE", value: image.namespace },
      { key: "IMAGE_TAG", value: image.tag },
      { key: "IMAGE_REF", value: image.imageRef },
      { key: "DOCKERFILE_PATH", value: image.dockerfilePath },
      { key: "BUILD_CONTEXT", value: image.contextPath },
      { key: "BUILD_RUNTIME", value: buildConfig.runtime ?? "node" },
      { key: "REGISTRY_SERVICE_CONNECTION", value: image.serviceConnection },
      { key: "REGISTRY_USERNAME", value: image.registryUsername ?? "" },
      { key: "REGISTRY_DOCKER_SECRET", value: image.dockerConfigSecret ?? "" },
      { key: "PACKAGE_BUILD_SCRIPT", value: buildConfig.packageBuildScript },
      { key: "PACKAGE_OUTPUT_PATHS", value: buildConfig.packageOutputPaths.join(",") },
    ];
    const source: PipelineSource = {
      id: run.repositoryId,
      type: providerFromUrl(run.repository),
      endpoint: run.repository,
      branch: run.refType === "branch" ? run.refName : run.branch,
      tag: run.refType === "tag" ? run.refName : run.tag,
      cloneDepth: 1,
    };

    return {
      pipelineRunId: run.id,
      pipelineName: run.pipelineName,
      applicationId: run.applicationId,
      environment: run.environment,
      stages: run.stages.map((stage) => stage.key),
      sources: [source],
      globalParams: variables,
      canaryPercent: run.canaryPercent,
      requiresApproval: run.definitionSnapshot.requiresApproval,
    };
  }

  private toStageStatus(
    stageKey: LifecycleStageKey,
    status: JobStatus,
    requiresApproval: boolean,
  ): StageStatus {
    if (status === "RUNNING") return "running";
    if (status === "SUCCESS") return "success";
    if (status === "FAIL") return "failed";
    if (status === "SKIPPED") return "skipped";
    if (status === "CANCELED") return "skipped";
    if (status === "QUEUED" && stageKey === "approval" && requiresApproval) return "waiting";
    return "pending";
  }

  private syncRunningStage(
    stage: PipelineStageRun,
    run: PipelineRun,
    executorStage: RunStatus["stages"][number],
    status: RunStatus,
  ): void {
    if (stage.status !== "running") {
      this.startStage(stage, run);
    }
    const job = executorStage.jobs[0];
    stage.startedAt = job?.startedAt || stage.startedAt || status.startedAt;
    stage.metadata = {
      ...stage.metadata,
      executorStatus: executorStage.status,
      taskRef: job?.taskRef ?? stage.metadata.taskRef ?? stage.key,
    };
  }

  private syncFinishedStage(
    stage: PipelineStageRun,
    run: PipelineRun,
    executorStage: RunStatus["stages"][number],
    status: "success" | "failed",
  ): void {
    const job = executorStage.jobs[0];
    const now = new Date().toISOString();
    const finishedAt = job?.finishedAt || stage.finishedAt || now;
    const durationMs = job?.durationMs || stage.durationMs || STAGE_DURATIONS[stage.key];
    const jobResult = job?.result ?? {};
    const imageDigest = firstNonEmpty(jobResult["image-digest"], jobResult["IMAGE_DIGEST"], jobResult["digest"]);
    const imageRef = firstNonEmpty(jobResult["image-ref"], jobResult["imageRef"], jobResult["IMAGE_REF"]);
    const dockerPullCommand = firstNonEmpty(jobResult["docker-pull"], jobResult["DOCKER_PULL"]);
    const packagePath = firstNonEmpty(jobResult["package-path"], jobResult["PACKAGE_PATH"]);
    const packageDigest = firstNonEmpty(jobResult["package-digest"], jobResult["PACKAGE_DIGEST"]);
    const executorError = firstNonEmpty(jobResult["error"], jobResult["ERROR"]);
    const startedAt =
      job?.startedAt ||
      stage.startedAt ||
      new Date(new Date(finishedAt).getTime() - durationMs).toISOString();

    stage.status = status;
    stage.startedAt = startedAt;
    stage.finishedAt = finishedAt;
    stage.durationMs = durationMs;
    stage.logs = [
      ...buildStageLogs(stage.key, run, status),
      ...(executorError ? [`执行器错误: ${truncateLogValue(executorError)}`] : []),
    ];
    stage.metadata = {
      ...stage.metadata,
      durationMs,
      status,
      executorStatus: executorStage.status,
      taskRef: job?.taskRef ?? stage.metadata.taskRef ?? stage.key,
      resultKeys: Object.keys(jobResult).join(","),
      ...(imageDigest ? { imageDigest } : {}),
      ...(imageRef ? { imageRef } : {}),
      ...(dockerPullCommand ? { dockerPullCommand } : {}),
      ...(packagePath ? { packagePath } : {}),
      ...(packageDigest ? { packageDigest } : {}),
      ...(executorError ? { executorError: truncateLogValue(executorError) } : {}),
    };
  }

  private finishStage(
    stage: PipelineStageRun,
    status: "success" | "failed",
    run: PipelineRun,
    extraLogs: string[] = [],
  ): void {
    const now = new Date();
    const startedAt = new Date(now.getTime() - STAGE_DURATIONS[stage.key]);
    stage.status = status;
    stage.startedAt = startedAt.toISOString();
    stage.finishedAt = now.toISOString();
    stage.durationMs = STAGE_DURATIONS[stage.key];
    stage.logs = [...buildStageLogs(stage.key, run, status), ...extraLogs];
    stage.metadata = {
      ...stage.metadata,
      durationMs: stage.durationMs,
      status,
    };
    run.progress = this.calculateProgress(run);
    run.updatedAt = now.toISOString();
  }

  calculateProgress(run: PipelineRun): number {
    const weighted = run.stages.reduce((score, stage) => {
      if (stage.status === "success" || stage.status === "skipped") return score + 1;
      if (stage.status === "failed") return score + 0.85;
      if (stage.status === "waiting") return score + 0.65;
      if (stage.status === "running") return score + 0.45;
      return score;
    }, 0);

    return Math.round((weighted / run.stages.length) * 100);
  }

  private buildRunningLogs(stage: PipelineStageRun, run: PipelineRun): string[] {
    const [firstLine] = buildStageLogs(stage.key, run, "success");
    return [`${stage.title} 已进入执行队列，正在申请运行资源。`, firstLine].filter(Boolean);
  }
}

function providerFromUrl(value: string): SourceRepositoryProvider {
  const url = value.toLowerCase();
  if (url.includes("github.com")) return "github";
  if (url.includes("gitlab")) return "gitlab";
  if (url.includes("gitcode")) return "gitcode";
  if (url.includes("gitea")) return "gitea";
  return "codeup";
}

const firstNonEmpty = (...values: Array<string | undefined>): string | undefined =>
  values.find((value) => Boolean(value?.trim()))?.trim();

const truncateLogValue = (value: string): string => (value.length > 4_000 ? `${value.slice(0, 4_000)}...` : value);
