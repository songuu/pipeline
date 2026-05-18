import { Controller, Get, Inject, Param } from "@nestjs/common";
import type { ApiResponse, Application } from "@deploy-management/shared";
import { ok } from "../common/api-response";
import { RequireRoles } from "../security/roles.decorator";
import { ApplicationsService } from "./applications.service";

@RequireRoles("viewer")
@Controller()
export class ApplicationsController {
  constructor(@Inject(ApplicationsService) private readonly service: ApplicationsService) {}

  @Get("api/applications")
  legacyList(): Application[] {
    return this.service.list();
  }

  @Get("oapi/v1/flow/applications")
  list(): ApiResponse<Application[]> {
    const items = this.service.list();
    return ok(items, { total: items.length });
  }

  @Get("oapi/v1/flow/applications/:id")
  get(@Param("id") id: string): ApiResponse<Application> {
    return ok(this.service.get(id));
  }
}
