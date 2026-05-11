import { Inject, Injectable } from "@nestjs/common";
import type { RunnerPool } from "@deploy-management/shared";
import { RunnersRepository } from "./runners.repository";

@Injectable()
export class RunnersService {
  constructor(@Inject(RunnersRepository) private readonly repo: RunnersRepository) {}

  list(): RunnerPool[] {
    return this.repo.snapshot();
  }
}
