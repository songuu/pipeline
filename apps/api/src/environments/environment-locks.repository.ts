import { Injectable } from "@nestjs/common";
import type { EnvironmentLock } from "@deploy-management/shared";
import { InMemoryRepository } from "../common/in-memory.repository";

@Injectable()
export class EnvironmentLocksRepository extends InMemoryRepository<EnvironmentLock> {
  constructor() {
    super([], "environment-locks");
  }
}
