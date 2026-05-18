import { Injectable } from "@nestjs/common";
import type { ReleaseDeployment } from "@deploy-management/shared";
import { InMemoryRepository } from "../common/in-memory.repository";

@Injectable()
export class ReleasesRepository extends InMemoryRepository<ReleaseDeployment> {
  constructor() {
    super([], "releases");
  }
}
