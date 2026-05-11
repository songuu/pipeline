import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Application } from "@deploy-management/shared";
import { ApplicationsRepository } from "./applications.repository";

@Injectable()
export class ApplicationsService {
  constructor(@Inject(ApplicationsRepository) private readonly repo: ApplicationsRepository) {}

  list(): Application[] {
    return this.repo.snapshot();
  }

  get(id: string): Application {
    const application = this.repo.snapshot().find((item) => item.id === id);
    if (!application) {
      throw new NotFoundException(`Application ${id} not found`);
    }
    return application;
  }
}
