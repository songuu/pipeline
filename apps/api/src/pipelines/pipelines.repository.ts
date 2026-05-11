import { Injectable } from "@nestjs/common";
import type { PipelineDefinition } from "@deploy-management/shared";
import { InMemoryRepository } from "../common/in-memory.repository";
import { SEED_PIPELINES } from "../common/seed-data";

@Injectable()
export class PipelinesRepository extends InMemoryRepository<PipelineDefinition> {
  constructor() {
    super(SEED_PIPELINES);
  }
}
