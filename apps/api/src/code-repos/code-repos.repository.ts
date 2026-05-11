import { Injectable } from "@nestjs/common";
import type { SourceRepository } from "@deploy-management/shared";
import { InMemoryRepository } from "../common/in-memory.repository";
import { SEED_REPOSITORIES } from "../common/seed-data";

@Injectable()
export class CodeReposRepository extends InMemoryRepository<SourceRepository> {
  constructor() {
    super(SEED_REPOSITORIES);
  }
}
