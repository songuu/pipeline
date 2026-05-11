import { Injectable } from "@nestjs/common";
import type { RunnerPool } from "@deploy-management/shared";
import { InMemoryRepository } from "../common/in-memory.repository";
import { SEED_RUNNER_POOLS } from "../common/seed-data";

@Injectable()
export class RunnersRepository extends InMemoryRepository<RunnerPool> {
  constructor() {
    super(SEED_RUNNER_POOLS);
  }
}
