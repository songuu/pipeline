import { Controller, Get, Inject } from "@nestjs/common";
import type { ApiResponse, Artifact } from "@deploy-management/shared";
import { ok } from "../common/api-response";
import { ArtifactsService } from "./artifacts.service";

@Controller()
export class ArtifactsController {
  constructor(@Inject(ArtifactsService) private readonly service: ArtifactsService) {}

  @Get("api/artifacts")
  legacyList(): Artifact[] {
    return this.service.list();
  }

  @Get("oapi/v1/flow/artifacts")
  list(): ApiResponse<Artifact[]> {
    const items = this.service.list();
    return ok(items, { total: items.length });
  }
}
