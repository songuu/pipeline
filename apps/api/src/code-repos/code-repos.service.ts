import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { GitReferenceType, SourceRepository } from "@deploy-management/shared";
import { CodeReposRepository } from "./code-repos.repository";

@Injectable()
export class CodeReposService {
  constructor(@Inject(CodeReposRepository) private readonly repo: CodeReposRepository) {}

  list(): SourceRepository[] {
    return this.repo.snapshot();
  }

  get(id: string): SourceRepository {
    const repository = this.repo.snapshot().find((item) => item.id === id);
    if (!repository) {
      throw new NotFoundException(`Repository ${id} not found`);
    }
    return repository;
  }

  assertReference(repository: SourceRepository, refType: GitReferenceType, refName: string): void {
    const refs = refType === "branch" ? repository.branches : repository.tags;
    if (!refs.includes(refName)) {
      throw new BadRequestException(`${repository.name} does not contain ${refType} ${refName}`);
    }
  }
}
