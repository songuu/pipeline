import { Injectable } from "@nestjs/common";
import type { RunEvent, RunHandle, RunStatus, StoredRunEvent } from "@deploy-management/shared";
import { createStableId } from "../common/ids";
import { InMemoryRepository } from "../common/in-memory.repository";

@Injectable()
export class RunEventsRepository extends InMemoryRepository<StoredRunEvent> {
  constructor() {
    super([], "run-events");
  }

  listForRun(runId: string): StoredRunEvent[] {
    return this.snapshot()
      .filter((event) => event.runId === runId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async append(event: RunEvent, source: StoredRunEvent["source"]): Promise<StoredRunEvent> {
    const stored: StoredRunEvent = {
      ...event,
      id: createStableId("run-event"),
      sequence: this.nextSequence(event.runId),
      source,
    };
    await this.create(stored);
    return stored;
  }

  async recordStatusSnapshot(handle: RunHandle, status: RunStatus): Promise<void> {
    await this.appendIfChanged({
      runId: status.runId,
      type: "status",
      timestamp: new Date().toISOString(),
      payload: { status: status.status },
    }, handle.backend, `status:${status.status}`);

    for (const stage of status.stages) {
      await this.appendIfChanged({
        runId: status.runId,
        type: "stage",
        timestamp: new Date().toISOString(),
        payload: { stageKey: stage.name, status: stage.status, index: stage.index },
      }, handle.backend, `stage:${stage.name}:${stage.status}`);

      for (const job of stage.jobs) {
        await this.appendIfChanged({
          runId: status.runId,
          type: "job",
          timestamp: new Date().toISOString(),
          payload: { stageKey: stage.name, jobId: job.id, jobName: job.name, status: job.status },
        }, handle.backend, `job:${stage.name}:${job.id}:${job.status}`);

        for (const step of job.steps) {
          await this.appendIfChanged({
            runId: status.runId,
            type: "step",
            timestamp: new Date().toISOString(),
            payload: {
              stageKey: stage.name,
              jobId: job.id,
              stepId: step.id,
              stepName: step.name,
              status: step.status,
              exitCode: step.exitCode,
            },
          }, handle.backend, `step:${stage.name}:${job.id}:${step.id}:${step.status}:${step.exitCode ?? ""}`);
        }
      }
    }
  }

  private async appendIfChanged(event: RunEvent, source: StoredRunEvent["source"], fingerprint: string): Promise<void> {
    const events = this.listForRun(event.runId);
    const lastMatching = [...events].reverse().find((item) => item.payload.fingerprint === fingerprint);
    if (lastMatching) return;
    await this.append({
      ...event,
      payload: { ...event.payload, fingerprint },
    }, source);
  }

  private nextSequence(runId: string): number {
    const last = this.listForRun(runId).at(-1);
    return (last?.sequence ?? 0) + 1;
  }
}
