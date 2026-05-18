import { Body, Controller, Get, Inject, MessageEvent, Param, Post, Sse } from "@nestjs/common";
import { Observable } from "rxjs";
import {
  toPipelineRunInstance,
  type ApiResponse,
  type PipelineRun,
  type PipelineRunInstance,
  type StoredRunEvent,
} from "@deploy-management/shared";
import { ok } from "../common/api-response";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PipelinesService } from "../pipelines/pipelines.service";
import { CurrentPrincipal, RequireRoles } from "../security/roles.decorator";
import type { ControlPlanePrincipal } from "../security/security.types";
import { RunsService } from "./runs.service";
import {
  approvalDecisionParamSchema,
  approvalDecisionSchema,
  startPipelineRunSchema,
  triggerRunSchema,
  type ApprovalDecisionDto,
  type ApprovalDecisionParam,
  type StartPipelineRunDto,
  type TriggerRunDto,
} from "./dto/trigger-run.dto";

@RequireRoles("viewer")
@Controller()
export class RunsController {
  constructor(
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(PipelinesService) private readonly pipelines: PipelinesService,
  ) {}

  @Get("api/runs")
  legacyList(): PipelineRun[] {
    return this.runs.list();
  }

  @Get("api/runs/:runId")
  legacyGet(@Param("runId") runId: string): PipelineRun {
    return this.runs.get(runId);
  }

  @Get("api/runs/:runId/logs")
  legacyLogs(@Param("runId") runId: string): string[] {
    return this.runs.getLogs(runId);
  }

  @Get("api/runs/:runId/events")
  legacyEvents(@Param("runId") runId: string): StoredRunEvent[] {
    return this.runs.getEvents(runId);
  }

  @Sse("api/runs/:runId/events/stream")
  streamEvents(@Param("runId") runId: string): Observable<MessageEvent> {
    this.runs.get(runId);
    return new Observable<MessageEvent>((subscriber) => {
      let cursor = 0;
      const publish = (): void => {
        const events = this.runs.getEvents(runId);
        for (const event of events.slice(cursor)) {
          subscriber.next({ data: event });
        }
        cursor = events.length;
      };
      publish();
      const interval = setInterval(publish, 1_000);
      return () => clearInterval(interval);
    });
  }

  @Post("api/pipelines/:pipelineId/trigger")
  @RequireRoles("member")
  legacyTrigger(
    @Param("pipelineId") pipelineId: string,
    @Body(new ZodValidationPipe(triggerRunSchema)) body: TriggerRunDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<PipelineRun> {
    return this.runs.trigger(pipelineId, { ...body, actor: body.actor ?? principal.actor });
  }

  @Post("api/runs/:runId/cancel")
  @RequireRoles("member")
  legacyCancel(@Param("runId") runId: string): Promise<PipelineRun> {
    return this.runs.cancel(runId);
  }

  @Post("api/runs/:runId/promote")
  @RequireRoles("member")
  legacyPromote(@Param("runId") runId: string): Promise<PipelineRun> {
    return this.runs.promote(runId);
  }

  @Post("api/approvals/:approvalId/:decision")
  @RequireRoles("member")
  legacyDecideApproval(
    @Param("approvalId") approvalId: string,
    @Param("decision", new ZodValidationPipe(approvalDecisionParamSchema)) decision: ApprovalDecisionParam,
    @Body(new ZodValidationPipe(approvalDecisionSchema)) body: ApprovalDecisionDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<{ approval: unknown; run: PipelineRun }> {
    return this.runs.decideApproval(approvalId, decision, body.actor ?? principal.actor);
  }

  // -------------------------------------------------------------------------
  // Yunxiao 风格 OpenAPI
  // -------------------------------------------------------------------------

  @Get("oapi/v1/flow/pipelineRuns")
  list(): ApiResponse<PipelineRunInstance[]> {
    const items = this.runs.list().map((run) => toPipelineRunInstance(run));
    return ok(items, { total: items.length });
  }

  @Get("oapi/v1/flow/pipelineRuns/:pipelineRunId")
  get(@Param("pipelineRunId") pipelineRunId: string): ApiResponse<PipelineRunInstance> {
    const run = this.runs.get(pipelineRunId);
    return ok(toPipelineRunInstance(run));
  }

  @Get("oapi/v1/flow/pipelines/:pipelineId/runs")
  listForPipeline(@Param("pipelineId") pipelineId: string): ApiResponse<PipelineRunInstance[]> {
    const items = this.runs
      .list()
      .filter((run) => run.pipelineId === pipelineId)
      .map((run) => toPipelineRunInstance(run));
    return ok(items, { total: items.length });
  }

  @Post("oapi/v1/flow/pipelines/:pipelineId/runs")
  @RequireRoles("member")
  async startRun(
    @Param("pipelineId") pipelineId: string,
    @Body(new ZodValidationPipe(startPipelineRunSchema)) params: StartPipelineRunDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ApiResponse<PipelineRunInstance>> {
    const pipeline = this.pipelines.get(pipelineId);
    const trigger = this.runs.toTriggerRequest(pipeline, params, principal.actor);
    const run = await this.runs.trigger(pipelineId, trigger);
    return ok(toPipelineRunInstance(run));
  }

  @Post("oapi/v1/flow/pipelineRuns/:pipelineRunId/cancel")
  @RequireRoles("member")
  async cancelRun(
    @Param("pipelineRunId") pipelineRunId: string,
  ): Promise<ApiResponse<PipelineRunInstance>> {
    const run = await this.runs.cancel(pipelineRunId);
    return ok(toPipelineRunInstance(run));
  }

  @Post("oapi/v1/flow/pipelineRuns/:pipelineRunId/promote")
  @RequireRoles("member")
  async promoteRun(
    @Param("pipelineRunId") pipelineRunId: string,
  ): Promise<ApiResponse<PipelineRunInstance>> {
    const run = await this.runs.promote(pipelineRunId);
    return ok(toPipelineRunInstance(run));
  }

  @Post("oapi/v1/flow/approvals/:approvalId/:decision")
  @RequireRoles("member")
  async decideApproval(
    @Param("approvalId") approvalId: string,
    @Param("decision", new ZodValidationPipe(approvalDecisionParamSchema)) decision: ApprovalDecisionParam,
    @Body(new ZodValidationPipe(approvalDecisionSchema)) body: ApprovalDecisionDto,
    @CurrentPrincipal() principal: ControlPlanePrincipal,
  ): Promise<ApiResponse<PipelineRunInstance>> {
    const { run } = await this.runs.decideApproval(approvalId, decision, body.actor ?? principal.actor);
    return ok(toPipelineRunInstance(run));
  }
}
