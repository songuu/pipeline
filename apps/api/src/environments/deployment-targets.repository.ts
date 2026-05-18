import { Injectable } from "@nestjs/common";
import type { DeploymentTarget } from "@deploy-management/shared";
import { InMemoryRepository } from "../common/in-memory.repository";

@Injectable()
export class DeploymentTargetsRepository extends InMemoryRepository<DeploymentTarget> {
  constructor() {
    super([], "deployment-targets");
  }
}
