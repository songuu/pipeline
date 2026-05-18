import { Injectable } from "@nestjs/common";
import type { ReleaseExecution } from "@deploy-management/shared";
import { InMemoryRepository } from "../common/in-memory.repository";

@Injectable()
export class ReleaseExecutionsRepository extends InMemoryRepository<ReleaseExecution> {
  constructor() {
    super([], "release-executions");
  }
}
