import { Injectable } from "@nestjs/common";
import type { DeploymentEnvironment } from "@deploy-management/shared";
import { InMemoryRepository } from "../common/in-memory.repository";
import { SEED_ENVIRONMENTS } from "../common/seed-data";

@Injectable()
export class EnvironmentsRepository extends InMemoryRepository<DeploymentEnvironment> {
  constructor() {
    super(SEED_ENVIRONMENTS);
  }
}
