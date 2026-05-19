import { Injectable } from "@nestjs/common";
import { InMemoryRepository } from "../common/in-memory.repository";
import type { PipelineGraphLayoutRecord } from "./dto/graph-layout.dto";

@Injectable()
export class PipelineLayoutsRepository extends InMemoryRepository<PipelineGraphLayoutRecord> {
  constructor() {
    super([], "pipeline-graph-layouts");
  }

  async findByPipelineActor(
    pipelineId: string,
    actor: string,
  ): Promise<PipelineGraphLayoutRecord | null> {
    const items = await this.list();
    return items.find((item) => item.pipeline_id === pipelineId && item.actor === actor) ?? null;
  }

  async upsert(record: PipelineGraphLayoutRecord): Promise<PipelineGraphLayoutRecord> {
    const existing = await this.findByPipelineActor(record.pipeline_id, record.actor);
    if (existing) {
      const next: PipelineGraphLayoutRecord = {
        ...existing,
        payload: record.payload,
        version: existing.version + 1,
        updated_at: record.updated_at,
      };
      return this.update(existing.id, next);
    }
    return this.create(record);
  }
}
