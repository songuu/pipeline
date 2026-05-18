import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type { ApiResponse, DeploymentEnvironment, DeploymentTarget, EnvironmentLock } from "@deploy-management/shared";
import { ok } from "../common/api-response";
import { EnvironmentsService, type CreateDeploymentTargetInput, type DeploymentTargetPreflightResult } from "./environments.service";

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

  @Get("api/deployment-targets")
  legacyListTargets(): DeploymentTarget[] {
    return this.service.listDeploymentTargets();
  }

  @Post("api/deployment-targets")
  legacyCreateTarget(@Body() body: CreateDeploymentTargetInput): Promise<DeploymentTarget> {
    return this.service.createDeploymentTarget(body);
  }

  @Get("api/environment-locks")
  legacyListLocks(): EnvironmentLock[] {
    return this.service.listEnvironmentLocks();
  }

  @Post("api/deployment-targets/:targetId/preflight")
  legacyPreflightTarget(@Param("targetId") targetId: string): DeploymentTargetPreflightResult {
    return this.service.preflightDeploymentTarget(this.service.getDeploymentTarget(targetId));
  }

  @Get("oapi/v1/flow/deployment-targets")
  listTargets(): ApiResponse<DeploymentTarget[]> {
    const items = this.service.listDeploymentTargets();
    return ok(items, { total: items.length });
  }

  @Post("oapi/v1/flow/deployment-targets")
  async createTarget(@Body() body: CreateDeploymentTargetInput): Promise<ApiResponse<DeploymentTarget>> {
    return ok(await this.service.createDeploymentTarget(body));
  }

  @Get("oapi/v1/flow/environment-locks")
  listLocks(): ApiResponse<EnvironmentLock[]> {
    const items = this.service.listEnvironmentLocks();
    return ok(items, { total: items.length });
  }

  @Post("oapi/v1/flow/deployment-targets/:targetId/preflight")
  preflightTarget(@Param("targetId") targetId: string): ApiResponse<DeploymentTargetPreflightResult> {
    return ok(this.service.preflightDeploymentTarget(this.service.getDeploymentTarget(targetId)));
  }
}
