import { Injectable } from "@nestjs/common";
import type { Artifact } from "@deploy-management/shared";
import { InMemoryRepository } from "../common/in-memory.repository";

@Injectable()
export class ArtifactsRepository extends InMemoryRepository<Artifact> {
  constructor() {
    super([], "artifacts");
  }
}
