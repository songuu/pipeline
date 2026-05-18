import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type { ApiResponse, ReleaseDeployment, ReleaseEvent, ReleaseExecution, ReleasePlan } from "@deploy-management/shared";
import { ok } from "../common/api-response";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentPrincipal, RequireRoles } from "../security/roles.decorator";
import type { ControlPlanePrincipal } from "../security/security.types";
import { canaryActionSchema, deployArtifactSchema, type CanaryActionDto, type DeployArtifactDto } from "./dto/deploy-artifact.dto";
import { ReleasesService } from "./releases.service";

@RequireRoles("viewer")
@Controller()
export class ReleasesController {
  constructor(@Inject(ReleasesService) private readonly service: ReleasesService) {}

  @Get("api/releases")
  legacyList(): ReleaseDeployment[] {
    return this.service.list();
  }

  @Get("api/release-plans")
  legacyListReleasePlans(): ReleasePlan[] {
    return this.service.listReleasePlans();
  }

  @Get("api/release-executions")
  legacyListReleaseExecutions(): ReleaseExecution[] {
    return this.service.listReleaseExecutions();
  }

  @Get("api/release-events")
  legacyListReleaseEvents(): ReleaseEvent[] {
    return this.service.listReleaseEvents();
  }

  @Get("api/releases/:releaseId/events")
  legacyListReleaseEventsForRelease(@Param("releaseId") releaseId: string): ReleaseEvent[] {
    return this.service.listReleaseEventsForRelease(releaseId);
  }

  @Post("api/artifacts/:artifactId/deploy")
  @RequireRoles("member")
  legacyDeployArtifact(
    @Param("artifactId") artifactId: string,
    @Body(new ZodValidationPipe(deployArtifactSchema)) body: DeployArtifactDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ReleaseDeployment> {
    return this.service.deployArtifact(artifactId, { ...body, actor: body.actor ?? principal.actor });
  }

  @Post("api/releases/:releaseId/canary/advance")
  @RequireRoles("member")
  legacyAdvanceCanary(
    @Param("releaseId") releaseId: string,
    @Body(new ZodValidationPipe(canaryActionSchema)) body: CanaryActionDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ReleaseDeployment> {
    return this.service.advanceCanary(releaseId, { ...body, actor: body.actor ?? principal.actor });
  }

  @Post("api/releases/:releaseId/canary/pause")
  @RequireRoles("member")
  legacyPauseCanary(
    @Param("releaseId") releaseId: string,
    @Body(new ZodValidationPipe(canaryActionSchema)) body: CanaryActionDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ReleaseDeployment> {
    return this.service.pauseCanary(releaseId, { ...body, actor: body.actor ?? principal.actor });
  }

  @Post("api/releases/:releaseId/canary/resume")
  @RequireRoles("member")
  legacyResumeCanary(
    @Param("releaseId") releaseId: string,
    @Body(new ZodValidationPipe(canaryActionSchema)) body: CanaryActionDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ReleaseDeployment> {
    return this.service.resumeCanary(releaseId, { ...body, actor: body.actor ?? principal.actor });
  }

  @Post("api/releases/:releaseId/canary/promote")
  @RequireRoles("member")
  legacyPromoteCanary(
    @Param("releaseId") releaseId: string,
    @Body(new ZodValidationPipe(canaryActionSchema)) body: CanaryActionDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ReleaseDeployment> {
    return this.service.promoteCanary(releaseId, { ...body, actor: body.actor ?? principal.actor });
  }

  @Post("api/releases/:releaseId/rollback")
  @RequireRoles("member")
  legacyRollbackRelease(
    @Param("releaseId") releaseId: string,
    @Body(new ZodValidationPipe(canaryActionSchema)) body: CanaryActionDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ReleaseDeployment> {
    return this.service.rollbackRelease(releaseId, { ...body, actor: body.actor ?? principal.actor });
  }

  @Get("oapi/v1/flow/releases")
  list(): ApiResponse<ReleaseDeployment[]> {
    const items = this.service.list();
    return ok(items, { total: items.length });
  }

  @Get("oapi/v1/flow/release-plans")
  listReleasePlans(): ApiResponse<ReleasePlan[]> {
    const items = this.service.listReleasePlans();
    return ok(items, { total: items.length });
  }

  @Get("oapi/v1/flow/release-executions")
  listReleaseExecutions(): ApiResponse<ReleaseExecution[]> {
    const items = this.service.listReleaseExecutions();
    return ok(items, { total: items.length });
  }

  @Get("oapi/v1/flow/release-events")
  listReleaseEvents(): ApiResponse<ReleaseEvent[]> {
    const items = this.service.listReleaseEvents();
    return ok(items, { total: items.length });
  }

  @Get("oapi/v1/flow/releases/:releaseId/events")
  listReleaseEventsForRelease(@Param("releaseId") releaseId: string): ApiResponse<ReleaseEvent[]> {
    const items = this.service.listReleaseEventsForRelease(releaseId);
    return ok(items, { total: items.length });
  }

  @Post("oapi/v1/flow/artifacts/:artifactId/deploy")
  @RequireRoles("member")
  async deployArtifact(
    @Param("artifactId") artifactId: string,
    @Body(new ZodValidationPipe(deployArtifactSchema)) body: DeployArtifactDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ApiResponse<ReleaseDeployment>> {
    return ok(await this.service.deployArtifact(artifactId, { ...body, actor: body.actor ?? principal.actor }));
  }

  @Post("oapi/v1/flow/releases/:releaseId/canary/advance")
  @RequireRoles("member")
  async advanceCanary(
    @Param("releaseId") releaseId: string,
    @Body(new ZodValidationPipe(canaryActionSchema)) body: CanaryActionDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ApiResponse<ReleaseDeployment>> {
    return ok(await this.service.advanceCanary(releaseId, { ...body, actor: body.actor ?? principal.actor }));
  }

  @Post("oapi/v1/flow/releases/:releaseId/canary/pause")
  @RequireRoles("member")
  async pauseCanary(
    @Param("releaseId") releaseId: string,
    @Body(new ZodValidationPipe(canaryActionSchema)) body: CanaryActionDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ApiResponse<ReleaseDeployment>> {
    return ok(await this.service.pauseCanary(releaseId, { ...body, actor: body.actor ?? principal.actor }));
  }

  @Post("oapi/v1/flow/releases/:releaseId/canary/resume")
  @RequireRoles("member")
  async resumeCanary(
    @Param("releaseId") releaseId: string,
    @Body(new ZodValidationPipe(canaryActionSchema)) body: CanaryActionDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ApiResponse<ReleaseDeployment>> {
    return ok(await this.service.resumeCanary(releaseId, { ...body, actor: body.actor ?? principal.actor }));
  }

  @Post("oapi/v1/flow/releases/:releaseId/canary/promote")
  @RequireRoles("member")
  async promoteCanary(
    @Param("releaseId") releaseId: string,
    @Body(new ZodValidationPipe(canaryActionSchema)) body: CanaryActionDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ApiResponse<ReleaseDeployment>> {
    return ok(await this.service.promoteCanary(releaseId, { ...body, actor: body.actor ?? principal.actor }));
  }

  @Post("oapi/v1/flow/releases/:releaseId/rollback")
  @RequireRoles("member")
  async rollbackRelease(
    @Param("releaseId") releaseId: string,
    @Body(new ZodValidationPipe(canaryActionSchema)) body: CanaryActionDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ApiResponse<ReleaseDeployment>> {
    return ok(await this.service.rollbackRelease(releaseId, { ...body, actor: body.actor ?? principal.actor }));
  }
}
