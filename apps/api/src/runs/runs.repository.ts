import { Injectable } from "@nestjs/common";
import type { PipelineRun } from "@deploy-management/shared";
import { InMemoryRepository } from "../common/in-memory.repository";

@Injectable()
export class RunsRepository extends InMemoryRepository<PipelineRun> {
  constructor() {
    super([]);
  }
}
