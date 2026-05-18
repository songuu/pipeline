// ----------------------------------------------------------------------------
// 5. ExecutorAdapter 通信契约（Nest ↔ services/tekton-bridge）
// ----------------------------------------------------------------------------

import type { EnvironmentType, LifecycleStageKey } from "../platform";
import type { GlobalParam, JobStatus, PipelineSource, StageInstance } from "../yunxiao";

export interface StartRunInput {
  pipelineRunId: string;
  pipelineName: string;
  applicationId: string;
  environment: EnvironmentType;
  stages: LifecycleStageKey[];
  sources: PipelineSource[];
  globalParams: GlobalParam[];
  canaryPercent: number;
  requiresApproval: boolean;
}

export interface RunHandle {
  runId: string;
  backend: "simulated" | "tekton" | "local-docker";
}

export interface RunStatus {
  runId: string;
  status: JobStatus;
  stages: StageInstance[];
  startedAt?: string;
  finishedAt?: string;
}

export interface RunEvent {
  runId: string;
  type: "stage" | "job" | "step" | "command" | "log" | "status" | "pipelinerun" | "taskrun" | "pod" | "kubernetes-event";
  timestamp: string;
  payload: Record<string, unknown>;
}

export type StoredRunEvent = RunEvent & {
  id: string;
  sequence: number;
  source: RunHandle["backend"] | "control-plane";
};
