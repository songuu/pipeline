// ----------------------------------------------------------------------------
// 2. 云效 (Aliyun Yunxiao Flow) 对齐
// 参考: https://help.aliyun.com/zh/yunxiao/developer-reference/
// ----------------------------------------------------------------------------

import type { LifecycleStageKey, PipelineRun, PipelineRunStatus, SourceRepository, StageStatus, VariableInjectionTiming } from "../platform";

// 云效 triggerMode 编码: 1 manual, 2 scheduled, 3 code commit, 5 pipeline, 6 webhook
// 字符串化便于跨语言传输
export type TriggerMode = "manual" | "scheduled" | "code_commit" | "webhook" | "pipeline" | "openapi";

export type JobStatus = "INIT" | "QUEUED" | "RUNNING" | "SUCCESS" | "FAIL" | "SKIPPED" | "CANCELED";

export interface PipelineSource {
  id: string;
  type: SourceRepository["provider"];
  endpoint: string;
  branch?: string;
  tag?: string;
  cloneDepth?: number;
  credentialId?: string;
  webhookUrl?: string;
}

export interface GlobalParam {
  key: string;
  value: string;
  encrypted?: boolean;
  description?: string;
  injectionTiming?: VariableInjectionTiming;
  targetStages?: LifecycleStageKey[];
}

export interface StepInstance {
  id: string;
  name: string;
  image?: string;
  command?: string[];
  status: JobStatus;
  exitCode?: number;
  logsRef?: string;
}

export interface JobInstance {
  id: string;
  name: string;
  taskRef: string;
  status: JobStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  steps: StepInstance[];
  result?: Record<string, string>;
  logsRef?: string;
}

export interface StageInstance {
  index: number;
  name: string;
  status: JobStatus;
  jobs: JobInstance[];
}

export interface PipelineRunInstance {
  pipelineRunId: string;
  pipelineId: string;
  pipelineName: string;
  status: JobStatus;
  triggerMode: TriggerMode;
  creatorAccountId: string;
  modifierAccountId?: string;
  createTime: string;
  updateTime: string;
  sources: PipelineSource[];
  stages: StageInstance[];
  globalParams: GlobalParam[];
}

// Yunxiao StartPipelineRun 触发参数（params 字段对齐）
export interface StartPipelineRunParams {
  branchModeBranchs?: string[];
  envs?: Record<string, string>;
  runningBranchs?: Record<string, string>;
  runningTags?: Record<string, string>;
  comment?: string;
}
// ----------------------------------------------------------------------------
// 7. Yunxiao ↔ 平台模型映射工具
// ----------------------------------------------------------------------------

const STAGE_STATUS_TO_JOB: Record<StageStatus, JobStatus> = {
  pending: "INIT",
  running: "RUNNING",
  success: "SUCCESS",
  failed: "FAIL",
  waiting: "QUEUED",
  skipped: "SKIPPED",
};

const RUN_STATUS_TO_JOB: Record<PipelineRunStatus, JobStatus> = {
  queued: "QUEUED",
  running: "RUNNING",
  waiting_approval: "QUEUED",
  success: "SUCCESS",
  failed: "FAIL",
  canceled: "CANCELED",
};

export const toYunxiaoJobStatus = (status: StageStatus): JobStatus => STAGE_STATUS_TO_JOB[status];

export const toYunxiaoRunStatus = (status: PipelineRunStatus): JobStatus => RUN_STATUS_TO_JOB[status];

export const toPipelineRunInstance = (run: PipelineRun): PipelineRunInstance => ({
  pipelineRunId: run.id,
  pipelineId: run.pipelineId,
  pipelineName: run.pipelineName,
  status: toYunxiaoRunStatus(run.status),
  triggerMode: "manual",
  creatorAccountId: run.actor,
  createTime: run.createdAt,
  updateTime: run.updatedAt,
  sources: [
    {
      id: run.repositoryId,
      type: "codeup",
      endpoint: run.repository,
      branch: run.refType === "branch" ? run.refName : run.branch,
      tag: run.refType === "tag" ? run.refName : run.tag,
    },
  ],
  stages: run.stages.map((stage, index) => ({
    index,
    name: stage.title,
    status: toYunxiaoJobStatus(stage.status),
    jobs: [
      {
        id: stage.id,
        name: stage.title,
        taskRef: stage.metadata.adapter ? String(stage.metadata.adapter) : stage.key,
        status: toYunxiaoJobStatus(stage.status),
        startedAt: stage.startedAt,
        finishedAt: stage.finishedAt,
        durationMs: stage.durationMs,
        steps: stage.logs.map((line, stepIndex) => ({
          id: `${stage.id}-step-${stepIndex}`,
          name: line.split(" ").slice(0, 3).join(" "),
          status: toYunxiaoJobStatus(stage.status),
        })),
      },
    ],
  })),
  globalParams: [
    { key: "ENVIRONMENT", value: run.environment },
    { key: "CANARY_PERCENT", value: String(run.canaryPercent) },
    { key: "COMMIT", value: run.commit },
    ...(run.definitionSnapshot.variables ?? []),
    ...(run.definitionSnapshot.runtimeVariables ?? []).map((param) => ({ ...param, key: `runtime.${param.key}` })),
  ],
});
