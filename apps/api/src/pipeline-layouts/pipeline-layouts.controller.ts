import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  UnauthorizedException,
} from "@nestjs/common";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentPrincipal, RequireRoles } from "../security/roles.decorator";
import type { ControlPlanePrincipal } from "../security/security.types";
import {
  actorQuerySchema,
  pipelineGraphLayoutPayloadSchema,
  pipelineIdParamSchema,
  type PipelineGraphLayoutPayload,
  type PipelineGraphLayoutRecord,
} from "./dto/graph-layout.dto";
import { PipelineLayoutsService } from "./pipeline-layouts.service";

@RequireRoles("viewer")
@Controller()
export class PipelineLayoutsController {
  constructor(
    @Inject(PipelineLayoutsService) private readonly service: PipelineLayoutsService,
  ) {}

  @Get("api/pipelines/:pipelineId/graph-layout")
  async getLayout(
    @Param("pipelineId") pipelineIdParam: string,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<PipelineGraphLayoutRecord> {
    const pipelineId = this.parsePipelineId(pipelineIdParam);
    const actor = this.resolveActorFromPrincipal(principal);
    return this.service.getLayout(pipelineId, actor);
  }

  @RequireRoles("member")
  @Put("api/pipelines/:pipelineId/graph-layout")
  async putLayout(
    @Param("pipelineId") pipelineIdParam: string,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
    @Body(new ZodValidationPipe(pipelineGraphLayoutPayloadSchema))
    payload: PipelineGraphLayoutPayload,
  ): Promise<PipelineGraphLayoutRecord> {
    const pipelineId = this.parsePipelineId(pipelineIdParam);
    const actor = this.resolveActorFromPrincipal(principal);
    return this.service.upsertLayout(pipelineId, actor, payload);
  }

  private parsePipelineId(value: string): string {
    const result = pipelineIdParamSchema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(
        `pipelineId 校验失败: ${result.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    return result.data;
  }

  /**
   * actor 必须来自已认证的 principal，**不接受** query 参数或 body。
   * 否则任何已登录用户可读 / 写他人的 layout (P1 安全审计 2026-05-19 修复)。
   *
   * 生产环境额外拒绝未认证 principal 兜底 (避免 dev fallback "RO" 漏到生产共享 actor)。
   */
  private resolveActorFromPrincipal(principal: ControlPlanePrincipal): string {
    if (!principal?.actor) {
      throw new UnauthorizedException("缺少已认证 principal，无法解析 actor");
    }
    if (process.env.NODE_ENV === "production" && principal.authenticated === false) {
      throw new UnauthorizedException(
        "生产环境拒绝未认证 principal fallback，请配置真实身份认证后重试",
      );
    }
    const result = actorQuerySchema.safeParse(principal.actor);
    if (!result.success) {
      throw new BadRequestException(
        `principal.actor 校验失败: ${result.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    return result.data;
  }
}
