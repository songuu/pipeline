import { Controller, Get, Inject } from "@nestjs/common";
import type { ApiResponse, DeploymentEnvironment } from "@deploy-management/shared";
import { ok } from "../common/api-response";
import { EnvironmentsService } from "./environments.service";

@Controller()
export class EnvironmentsController {
  constructor(@Inject(EnvironmentsService) private readonly service: EnvironmentsService) {}

  @Get("api/environments")
  legacyList(): DeploymentEnvironment[] {
    return this.service.list();
  }

  @Get("oapi/v1/flow/environments")
  list(): ApiResponse<DeploymentEnvironment[]> {
    const items = this.service.list();
    return ok(items, { total: items.length });
  }
}
