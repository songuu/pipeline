import { Injectable } from "@nestjs/common";
import type { ReleasePlan } from "@deploy-management/shared";
import { InMemoryRepository } from "../common/in-memory.repository";

@Injectable()
export class ReleasePlansRepository extends InMemoryRepository<ReleasePlan> {
  constructor() {
    super([], "release-plans");
  }
}
