import { Injectable } from "@nestjs/common";
import {
  toYunxiaoJobStatus,
  type LifecycleStageKey,
  type RunEvent,
  type RunHandle,
  type RunStatus,
  type StageInstance,
  type StartRunInput,
} from "@deploy-management/shared";
import { ExecutorAdapter } from "../lifecycle/executor-adapter";
import { STAGE_DURATIONS } from "./stage-templates";

interface SimulatedRunRecord {
  runId: string;
  input: StartRunInput;
  stages: StageInstance[];
  startedAt: string;
  finishedAt?: string;
  canceled: boolean;
  events: RunEvent[];
}

/**
 * 内存版执行器。把"模拟推进 stage"作为唯一职责，
 * 业务面（pipeline run 的状态机、审批门控）由 RunsService 协调。
 *
 * 这是 ExecutorAdapter 的默认实现，无外部依赖。
 */
@Injectable()
export class SimulatedExecutor implements ExecutorAdapter {
  readonly backend: RunHandle["backend"] = "simulated";

  private readonly records = new Map<string, SimulatedRunRecord>();

  async start(input: StartRunInput): Promise<RunHandle> {
    const stages = this.materializeStages(input.stages);
    const record: SimulatedRunRecord = {
      runId: input.pipelineRunId,
      input,
      stages,
      startedAt: new Date().toISOString(),
      canceled: false,
      events: [
        {
          runId: input.pipelineRunId,
          type: "status",
          timestamp: new Date().toISOString(),
          payload: { status: "RUNNING" },
        },
      ],
    };
    this.records.set(input.pipelineRunId, record);
    return { runId: input.pipelineRunId, backend: this.backend };
  }

  async status(handle: RunHandle): Promise<RunStatus> {
    const record = this.requireRecord(handle.runId);
    return {
      runId: record.runId,
      status: this.derivedStatus(record),
      stages: record.stages,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
    };
  }

  async cancel(handle: RunHandle): Promise<void> {
    const record = this.records.get(handle.runId);
    if (!record) return;
    record.canceled = true;
    record.finishedAt = new Date().toISOString();
    record.stages = record.stages.map((stage) =>
      ["INIT", "QUEUED", "RUNNING"].includes(stage.status)
        ? { ...stage, status: "CANCELED" }
        : stage,
    );
    record.events.push({
      runId: record.runId,
      type: "status",
      timestamp: record.finishedAt,
      payload: { status: "CANCELED" },
    });
  }

  async *events(handle: RunHandle): AsyncIterable<RunEvent> {
    const record = this.requireRecord(handle.runId);
    for (const event of record.events) {
      yield event;
    }
  }

  /** 控制面专用：标记 stage 完成 / 失败，对外保持 ExecutorAdapter 接口。 */
  finishStage(runId: string, stageKey: LifecycleStageKey, status: "SUCCESS" | "FAIL"): void {
    const record = this.requireRecord(runId);
    record.stages = record.stages.map((stage) =>
      stage.name === stageKey
        ? {
            ...stage,
            status,
            jobs: stage.jobs.map((job) => ({
              ...job,
              status,
              durationMs: STAGE_DURATIONS[stageKey],
              finishedAt: new Date().toISOString(),
            })),
          }
        : stage,
    );
    record.events.push({
      runId,
      type: "stage",
      timestamp: new Date().toISOString(),
      payload: { stageKey, status },
    });
  }

  markRunFinished(runId: string, status: "SUCCESS" | "FAIL"): void {
    const record = this.records.get(runId);
    if (!record) return;
    record.finishedAt = new Date().toISOString();
    record.events.push({
      runId,
      type: "status",
      timestamp: record.finishedAt,
      payload: { status },
    });
  }

  /** Test/dev helper: clear all simulated run state. */
  reset(): void {
    this.records.clear();
  }

  private materializeStages(keys: LifecycleStageKey[]): StageInstance[] {
    return keys.map((key, index) => ({
      index,
      name: key,
      status: toYunxiaoJobStatus("pending"),
      jobs: [
        {
          id: `${key}-job`,
          name: key,
          taskRef: key,
          status: toYunxiaoJobStatus("pending"),
          steps: [],
        },
      ],
    }));
  }

  private requireRecord(runId: string): SimulatedRunRecord {
    const record = this.records.get(runId);
    if (!record) {
      throw new Error(`Simulated run ${runId} not found`);
    }
    return record;
  }

  private derivedStatus(record: SimulatedRunRecord): RunStatus["status"] {
    if (record.canceled) return "CANCELED";
    const allSuccess = record.stages.every((stage) => stage.status === "SUCCESS" || stage.status === "SKIPPED");
    if (allSuccess) return "SUCCESS";
    const anyFail = record.stages.some((stage) => stage.status === "FAIL");
    if (anyFail) return "FAIL";
    const anyRunning = record.stages.some((stage) => stage.status === "RUNNING");
    if (anyRunning) return "RUNNING";
    return "QUEUED";
  }
}
