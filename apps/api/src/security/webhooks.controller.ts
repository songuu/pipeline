import { Body, Controller, Headers, Inject, Param, Post, Req } from "@nestjs/common";
import type { ApiResponse, PipelineRun } from "@deploy-management/shared";
import { ok } from "../common/api-response";
import { RunsService } from "../runs/runs.service";
import { WebhookSecurityService } from "./webhook-security.service";
import type { HeaderBag } from "./security.types";

type RawBodyRequest = {
  rawBody?: Buffer;
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
};

interface WebhookTriggerResult {
  status: "triggered" | "duplicate";
  deliveryId: string;
  run?: PipelineRun;
  runId?: string;
}

@Controller()
export class WebhooksController {
  constructor(
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(WebhookSecurityService) private readonly webhooks: WebhookSecurityService,
  ) {}

  @Post("api/webhooks/:provider/pipelines/:pipelineId")
  async legacyTrigger(
    @Param("provider") provider: string,
    @Param("pipelineId") pipelineId: string,
    @Headers() headers: HeaderBag,
    @Body() body: unknown,
    @Req() request: RawBodyRequest,
  ): Promise<WebhookTriggerResult> {
    return this.trigger(provider, pipelineId, headers, body, request);
  }

  @Post("oapi/v1/flow/webhooks/:provider/pipelines/:pipelineId")
  async triggerOpenApi(
    @Param("provider") provider: string,
    @Param("pipelineId") pipelineId: string,
    @Headers() headers: HeaderBag,
    @Body() body: unknown,
    @Req() request: RawBodyRequest,
  ): Promise<ApiResponse<WebhookTriggerResult>> {
    return ok(await this.trigger(provider, pipelineId, headers, body, request));
  }

  private async trigger(
    provider: string,
    pipelineId: string,
    headers: HeaderBag,
    body: unknown,
    request: RawBodyRequest,
  ): Promise<WebhookTriggerResult> {
    const verified = await this.webhooks.verifyAndAccept({
      provider,
      pipelineId,
      headers,
      body,
      rawBody: request.rawBody,
      sourceIp: request.ip ?? request.socket?.remoteAddress,
    });

    if (verified.duplicate) {
      return {
        status: "duplicate",
        deliveryId: verified.record.deliveryId,
        runId: verified.record.runId,
      };
    }

    try {
      const run = await this.runs.trigger(pipelineId, verified.trigger);
      await this.webhooks.markCompleted(verified.record.id, run.id);
      return {
        status: "triggered",
        deliveryId: verified.record.deliveryId,
        run,
        runId: run.id,
      };
    } catch (error) {
      await this.webhooks.markFailed(verified.record.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}
