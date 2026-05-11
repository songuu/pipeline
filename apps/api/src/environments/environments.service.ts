import { Inject, Injectable } from "@nestjs/common";
import type { DeploymentEnvironment } from "@deploy-management/shared";
import { EnvironmentsRepository } from "./environments.repository";

@Injectable()
export class EnvironmentsService {
  constructor(@Inject(EnvironmentsRepository) private readonly repo: EnvironmentsRepository) {}

  list(): DeploymentEnvironment[] {
    return this.repo.snapshot();
  }
}
