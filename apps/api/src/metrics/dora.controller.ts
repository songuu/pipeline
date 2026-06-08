import { Controller, Get, Inject, Query } from "@nestjs/common";
import type { ApiResponse, DoraMetrics, DoraQuery } from "@deploy-management/shared";
import { ok } from "../common/api-response";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireRoles } from "../security/roles.decorator";
import { doraQuerySchema, type DoraQueryDto } from "./dto/dora-query.dto";
import { DoraService } from "./dora.service";

const toQuery = (dto: DoraQueryDto): DoraQuery => ({
  windowDays: dto.window,
  ...(dto.environment ? { environment: dto.environment } : {}),
  ...(dto.applicationId ? { applicationId: dto.applicationId } : {}),
});

@RequireRoles("viewer")
@Controller()
export class DoraController {
  constructor(@Inject(DoraService) private readonly service: DoraService) {}

  @Get("api/metrics/dora")
  legacyDora(@Query(new ZodValidationPipe(doraQuerySchema)) query: DoraQueryDto): DoraMetrics {
    return this.service.compute(toQuery(query));
  }

  @Get("oapi/v1/flow/metrics/dora")
  yunxiaoDora(@Query(new ZodValidationPipe(doraQuerySchema)) query: DoraQueryDto): ApiResponse<DoraMetrics> {
    return ok(this.service.compute(toQuery(query)));
  }
}
