import { Body, Controller, Delete, Get, Inject, Param, Post, Put } from "@nestjs/common";
import type { ApiResponse, PipelineDefinition } from "@deploy-management/shared";
import { ok } from "../common/api-response";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuditService } from "../audit/audit.service";
import { CurrentPrincipal, RequireRoles } from "../security/roles.decorator";
import type { ControlPlanePrincipal } from "../security/security.types";
import { PipelinesService } from "./pipelines.service";
import {
  createPipelineSchema,
  updatePipelineSchema,
  type CreatePipelineDto,
  type UpdatePipelineDto,
} from "./dto/create-pipeline.dto";

@RequireRoles("viewer")
@Controller()
export class PipelinesController {
  constructor(
    @Inject(PipelinesService) private readonly service: PipelinesService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get("api/pipelines")
  legacyList(): PipelineDefinition[] {
    return this.service.list();
  }

  @Post("api/pipelines")
  @RequireRoles("member")
  async legacyCreate(
    @Body(new ZodValidationPipe(createPipelineSchema)) body: CreatePipelineDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<PipelineDefinition> {
    const pipeline = await this.service.create(body);
    await this.audit.record(body.owner || principal.actor, "create_pipeline", pipeline.id);
    return pipeline;
  }

  @Put("api/pipelines/:id")
  @RequireRoles("member")
  async legacyUpdate(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePipelineSchema)) body: UpdatePipelineDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<PipelineDefinition> {
    const pipeline = await this.service.update(id, body);
    await this.audit.record(body.owner || principal.actor, "update_pipeline", pipeline.id);
    return pipeline;
  }

  @Delete("api/pipelines/:id")
  @RequireRoles("admin")
  async legacyDelete(
    @Param("id") id: string,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<{ id: string }> {
    const deleted = await this.service.delete(id);
    await this.audit.record(principal.actor, "delete_pipeline", id);
    return deleted;
  }

  @Get("oapi/v1/flow/pipelines")
  list(): ApiResponse<PipelineDefinition[]> {
    const items = this.service.list();
    return ok(items, { total: items.length });
  }

  @Get("oapi/v1/flow/pipelines/:id")
  get(@Param("id") id: string): ApiResponse<PipelineDefinition> {
    return ok(this.service.get(id));
  }

  @Post("oapi/v1/flow/pipelines")
  @RequireRoles("member")
  async create(
    @Body(new ZodValidationPipe(createPipelineSchema)) body: CreatePipelineDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ApiResponse<PipelineDefinition>> {
    const pipeline = await this.service.create(body);
    await this.audit.record(body.owner || principal.actor, "create_pipeline", pipeline.id);
    return ok(pipeline);
  }

  @Put("oapi/v1/flow/pipelines/:id")
  @RequireRoles("member")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePipelineSchema)) body: UpdatePipelineDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ApiResponse<PipelineDefinition>> {
    const pipeline = await this.service.update(id, body);
    await this.audit.record(body.owner || principal.actor, "update_pipeline", pipeline.id);
    return ok(pipeline);
  }

  @Delete("oapi/v1/flow/pipelines/:id")
  @RequireRoles("admin")
  async delete(
    @Param("id") id: string,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ApiResponse<{ id: string }>> {
    const deleted = await this.service.delete(id);
    await this.audit.record(principal.actor, "delete_pipeline", id);
    return ok(deleted);
  }
}
