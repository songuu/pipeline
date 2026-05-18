import { Injectable } from "@nestjs/common";
import type { EnvironmentType, ReleaseEvent, ReleaseEventType } from "@deploy-management/shared";
import { createStableId } from "../common/ids";
import { InMemoryRepository } from "../common/in-memory.repository";

export type AppendReleaseEventInput = {
  releaseId: string;
  releasePlanId?: string;
  releaseExecutionId?: string;
  artifactId?: string;
  runId?: string;
  applicationId: string;
  environment: EnvironmentType;
  type: ReleaseEventType;
  message: string;
  actor: string;
  payload?: Record<string, unknown>;
};

@Injectable()
export class ReleaseEventsRepository extends InMemoryRepository<ReleaseEvent> {
  constructor() {
    super([], "release-events");
  }

  listForRelease(releaseId: string): ReleaseEvent[] {
    return this.snapshot()
      .filter((event) => event.releaseId === releaseId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async append(input: AppendReleaseEventInput): Promise<ReleaseEvent> {
    const event: ReleaseEvent = {
      ...input,
      id: createStableId("release-event"),
      sequence: this.nextSequence(input.releaseId),
      createdAt: new Date().toISOString(),
      payload: input.payload ?? {},
    };
    await this.create(event);
    return event;
  }

  private nextSequence(releaseId: string): number {
    const last = this.listForRelease(releaseId).at(-1);
    return (last?.sequence ?? 0) + 1;
  }
}
