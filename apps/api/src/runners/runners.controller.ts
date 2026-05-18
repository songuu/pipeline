import { Controller, Get, Inject } from "@nestjs/common";
import type { ApiResponse, RunnerPool } from "@deploy-management/shared";
import { ok } from "../common/api-response";
import { RequireRoles } from "../security/roles.decorator";
import { RunnersService } from "./runners.service";

@RequireRoles("viewer")
@Controller()
export class RunnersController {
  constructor(@Inject(RunnersService) private readonly service: RunnersService) {}

  @Get("api/runners")
  legacyList(): RunnerPool[] {
    return this.service.list();
  }

  @Get("oapi/v1/flow/runnerPools")
  list(): ApiResponse<RunnerPool[]> {
    const items = this.service.list();
    return ok(items, { total: items.length });
  }
}
