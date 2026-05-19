import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PipelineLayoutsRepository } from "./pipeline-layouts.repository";
import type {
  PipelineGraphLayoutPayload,
  PipelineGraphLayoutRecord,
} from "./dto/graph-layout.dto";

@Injectable()
export class PipelineLayoutsService {
  constructor(
    @Inject(PipelineLayoutsRepository) private readonly repository: PipelineLayoutsRepository,
  ) {}

  private ensureSupabaseEnabled(): void {
    if (process.env.DEPLOYMENT_STORAGE !== "supabase") {
      throw new ServiceUnavailableException(
        "pipeline-graph-layouts 仅在 DEPLOYMENT_STORAGE=supabase 模式启用",
      );
    }
  }

  async getLayout(pipelineId: string, actor: string): Promise<PipelineGraphLayoutRecord> {
    this.ensureSupabaseEnabled();
    const record = await this.repository.findByPipelineActor(pipelineId, actor);
    if (!record) {
      throw new NotFoundException(`no layout for pipeline=${pipelineId} actor=${actor}`);
    }
    return record;
  }

  async upsertLayout(
    pipelineId: string,
    actor: string,
    payload: PipelineGraphLayoutPayload,
  ): Promise<PipelineGraphLayoutRecord> {
    this.ensureSupabaseEnabled();
    const now = new Date().toISOString();
    const candidate: PipelineGraphLayoutRecord = {
      id: randomUUID(),
      pipeline_id: pipelineId,
      actor,
      payload,
      version: 1,
      created_at: now,
      updated_at: now,
    };
    return this.repository.upsert(candidate);
  }
}
