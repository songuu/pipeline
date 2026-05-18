import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import type {
  TektonBridgeCapabilities,
  TektonPreflightReport,
  TektonPreflightRequest,
  TektonTaskRunDetail,
  TektonTaskRunLogs,
} from "@deploy-management/shared";
import { RequireRoles } from "../security/roles.decorator";
import { KubernetesService } from "./kubernetes.service";

@RequireRoles("viewer")
@Controller()
export class KubernetesController {
  constructor(@Inject(KubernetesService) private readonly kubernetes: KubernetesService) {}

  @Get("api/kubernetes/capabilities")
  capabilities(): Promise<TektonBridgeCapabilities> {
    return this.kubernetes.capabilities();
  }

  @Get("api/tekton/capabilities")
  tektonCapabilities(): Promise<TektonBridgeCapabilities> {
    return this.kubernetes.capabilities();
  }

  @Post("api/kubernetes/preflight")
  @RequireRoles("member")
  preflight(@Body() request: TektonPreflightRequest): Promise<TektonPreflightReport> {
    return this.kubernetes.preflight(request ?? {});
  }

  @Post("api/tekton/preflight")
  @RequireRoles("member")
  tektonPreflight(@Body() request: TektonPreflightRequest): Promise<TektonPreflightReport> {
    return this.kubernetes.preflight(request ?? {});
  }

  @Get("api/tekton/runs/:runId/taskruns/:taskRunName")
  taskRunDetail(
    @Param("runId") runId: string,
    @Param("taskRunName") taskRunName: string,
  ): Promise<TektonTaskRunDetail> {
    return this.kubernetes.taskRunDetail(runId, taskRunName);
  }

  @Get("api/tekton/runs/:runId/taskruns/:taskRunName/logs")
  taskRunLogs(
    @Param("runId") runId: string,
    @Param("taskRunName") taskRunName: string,
    @Query("step") stepName?: string,
  ): Promise<TektonTaskRunLogs> {
    return this.kubernetes.taskRunLogs(runId, taskRunName, stepName);
  }
}
