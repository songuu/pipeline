import { Controller, Get, Inject } from "@nestjs/common";
import type { ApiResponse, AuditEvent } from "@deploy-management/shared";
import { ok } from "../common/api-response";
import { AuditService } from "./audit.service";

@Controller()
export class AuditController {
  constructor(@Inject(AuditService) private readonly service: AuditService) {}

  @Get("api/audit")
  legacyList(): AuditEvent[] {
    return this.service.list();
  }

  @Get("oapi/v1/flow/auditEvents")
  list(): ApiResponse<AuditEvent[]> {
    const items = this.service.list();
    return ok(items, { total: items.length });
  }
}
