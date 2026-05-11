import { Injectable } from "@nestjs/common";
import type { Application } from "@deploy-management/shared";
import { InMemoryRepository } from "../common/in-memory.repository";
import { SEED_APPLICATIONS } from "../common/seed-data";

@Injectable()
export class ApplicationsRepository extends InMemoryRepository<Application> {
  constructor() {
    super(SEED_APPLICATIONS);
  }
}
