import { Inject, Injectable } from "@nestjs/common";
import {
  getLifecycleStage,
  type LifecycleStageKey,
  type PipelineDefinition,
  type PipelineRun,
  type PipelineStageRun,
  type StageStatus,
  type TriggerRunRequest,
} from "@deploy-management/shared";
import { EXECUTOR_ADAPTER, type ExecutorAdapter } from "./executor-adapter";
import { STAGE_DURATIONS, buildStageLogs } from "../executors/stage-templates";

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
    runNumber: number;
  }): PipelineRun {
    const now = new Date().toISOString();
    const refType = input.request.refType ?? input.pipeline.defaultRefType;
    const refName = input.request.refName ?? input.pipeline.defaultRef;
    const branch = refType === "branch" ? refName : input.pipeline.defaultBranch;
    const tag = refType === "tag" ? refName : undefined;
    const commit = input.request.commitSha ?? this.createCommit();
    const environment = input.request.environment ?? input.pipeline.targetEnvironment;
    const canaryPercent = input.request.canaryPercent ?? input.pipeline.canaryPercent;
    const stages = input.pipeline.stages.map((key) => this.createStage(key, "pending"));

    return {
      id: `run-${input.runNumber}`,
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

  /**
   * 把 run 推进到第一个不可自动跨越的门（审批 / 失败 / 完成）。
   * SimulatedExecutor 下这一步是同步完成的；TektonBridgeExecutor 下这一步只发起意图。
   * 当前 in-memory 路径仍然按 simulated 行为推进，确保 UI 立即可看到完整时间线。
   */
  simulateUntilGate(run: PipelineRun, failureStage?: LifecycleStageKey): PipelineRun {
    const gateIndex = run.stages.findIndex((stage) => stage.key === "approval");
    const stopIndex = gateIndex === -1 ? run.stages.length : gateIndex;

    run.status = "running";
    let blockedByFailure = false;
    run.stages.forEach((stage, index) => {
      if (blockedByFailure) {
        stage.status = "skipped";
        stage.logs = [`${stage.title} 已跳过，因为前序阶段失败。`];
        return;
      }

      if (failureStage && stage.key === failureStage) {
        this.finishStage(stage, "failed", run);
        run.status = "failed";
        run.progress = this.calculateProgress(run);
        blockedByFailure = true;
        return;
      }

      if (index < stopIndex) {
        this.finishStage(stage, "success", run);
      }
    });

    if (blockedByFailure) {
      run.updatedAt = new Date().toISOString();
      return run;
    }

    const approvalStage = run.stages[gateIndex];
    if (approvalStage && run.definitionSnapshot.requiresApproval) {
      approvalStage.status = "waiting";
      approvalStage.startedAt = new Date().toISOString();
      approvalStage.logs = [
        "生产环境命中审批门禁。",
        `灰度比例 ${run.canaryPercent}% 已完成，等待 owner 与 SRE 审批后继续全量。`,
      ];
      run.status = "waiting_approval";
      run.progress = this.calculateProgress(run);
      run.updatedAt = new Date().toISOString();
      return run;
    }

    this.completePromotion(run);
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

  private createCommit(): string {
    return Math.random().toString(16).slice(2, 9);
  }

  private buildRunningLogs(stage: PipelineStageRun, run: PipelineRun): string[] {
    const [firstLine] = buildStageLogs(stage.key, run, "success");
    return [`${stage.title} 已进入执行队列，正在申请运行资源。`, firstLine].filter(Boolean);
  }
}
