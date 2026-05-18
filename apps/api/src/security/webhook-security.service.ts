import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { TriggerRunDto } from "../runs/dto/trigger-run.dto";
import { createStableId } from "../common/ids";
import { SecretResolverService } from "./secret-resolver.service";
import { WebhookDeliveriesRepository } from "./webhook-deliveries.repository";
import type { HeaderBag, WebhookDeliveryRecord } from "./security.types";

type WebhookProvider = WebhookDeliveryRecord["provider"];

export interface VerifiedWebhookDelivery {
  record: WebhookDeliveryRecord;
  duplicate: boolean;
  trigger: TriggerRunDto;
}

@Injectable()
export class WebhookSecurityService {
  constructor(
    @Inject(WebhookDeliveriesRepository) private readonly deliveries: WebhookDeliveriesRepository,
    @Inject(SecretResolverService) private readonly secrets: SecretResolverService,
  ) {}

  async verifyAndAccept(input: {
    provider: string;
    pipelineId: string;
    headers: HeaderBag;
    rawBody?: Buffer;
    body: unknown;
    sourceIp?: string;
  }): Promise<VerifiedWebhookDelivery> {
    const provider = normalizeProvider(input.provider);
    const rawBody = input.rawBody ?? Buffer.from(JSON.stringify(input.body ?? {}));
    const secret = this.webhookSecret(provider, input.pipelineId);
    if (!secret) {
      throw new BadRequestException(
        `缺少 ${provider} webhook secret：请配置 ${provider.toUpperCase()}_WEBHOOK_SECRET、WEBHOOK_SECRET 或 PIPELINE_WEBHOOK_SECRET_${sanitizeEnvSuffix(input.pipelineId)}`,
      );
    }

    verifyWebhookSignature(provider, input.headers, rawBody, secret);

    const deliveryId = deliveryIdFromHeaders(provider, input.headers, rawBody);
    const existing = this.deliveries
      .snapshot()
      .find((item) => item.provider === provider && item.pipelineId === input.pipelineId && item.deliveryId === deliveryId);
    const trigger = triggerFromWebhookPayload(provider, input.body);

    if (existing) {
      return {
        record: {
          ...existing,
          status: "duplicate",
        },
        duplicate: true,
        trigger,
      };
    }

    const now = new Date();
    const record: WebhookDeliveryRecord = {
      id: createStableId("webhook"),
      provider,
      pipelineId: input.pipelineId,
      deliveryId,
      event: headerValue(input.headers, eventHeader(provider)) ?? "push",
      status: "accepted",
      actor: trigger.actor ?? `${provider}-webhook`,
      sourceIp: input.sourceIp,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await this.deliveries.prepend(record);
    return { record, duplicate: false, trigger };
  }

  async markCompleted(deliveryId: string, runId: string): Promise<WebhookDeliveryRecord> {
    return this.deliveries.update(deliveryId, {
      status: "completed",
      runId,
    });
  }

  async markFailed(deliveryId: string, reason: string): Promise<WebhookDeliveryRecord> {
    return this.deliveries.update(deliveryId, {
      status: "failed",
      reason,
    });
  }

  private webhookSecret(provider: WebhookProvider, pipelineId: string): string | undefined {
    return this.secrets.first([
      `PIPELINE_WEBHOOK_SECRET_${sanitizeEnvSuffix(pipelineId)}`,
      `${provider.toUpperCase()}_WEBHOOK_SECRET`,
      "WEBHOOK_SECRET",
    ]);
  }
}

export function verifyWebhookSignature(provider: WebhookProvider, headers: HeaderBag, rawBody: Buffer, secret: string): void {
  if (provider === "github") {
    const signature = headerValue(headers, "x-hub-signature-256");
    if (!signature) throw new BadRequestException("GitHub webhook 缺少 X-Hub-Signature-256");
    const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    if (!constantTimeEqual(signature, expected)) throw new BadRequestException("GitHub webhook 签名校验失败");
    return;
  }

  if (provider === "gitlab") {
    const token = headerValue(headers, "x-gitlab-token");
    if (!token || !constantTimeEqual(token, secret)) throw new BadRequestException("GitLab webhook token 校验失败");
    return;
  }

  if (provider === "gitcode") {
    const signature = headerValue(headers, "x-gitcode-signature-256") ?? headerValue(headers, "x-gitee-signature");
    if (signature) {
      const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
      if (!constantTimeEqual(signature, expected)) throw new BadRequestException("GitCode webhook 签名校验失败");
      return;
    }
    const token = headerValue(headers, "x-gitcode-token") ?? headerValue(headers, "x-gitee-token") ?? headerValue(headers, "x-webhook-token");
    if (!token || !constantTimeEqual(token, secret)) throw new BadRequestException("GitCode webhook token 校验失败");
    return;
  }

  const token = headerValue(headers, "x-webhook-token");
  if (!token || !constantTimeEqual(token, secret)) throw new BadRequestException("Generic webhook token 校验失败");
}

export function triggerFromWebhookPayload(provider: WebhookProvider, body: unknown): TriggerRunDto {
  const payload = isRecord(body) ? body : {};
  const ref = stringFrom(payload.ref);
  const refInfo = refFromPayload(ref);
  const commitSha =
    normalizeCommitSha(stringFrom(payload.after)) ??
    normalizeCommitSha(stringFrom(payload.checkout_sha)) ??
    normalizeCommitSha(stringFrom(payload.commit_id));
  const actor =
    nestedString(payload, ["sender", "login"]) ??
    nestedString(payload, ["user", "username"]) ??
    stringFrom(payload.user_username) ??
    stringFrom(payload.user_name) ??
    `${provider}-webhook`;

  return {
    refType: refInfo.refType,
    refName: refInfo.refName,
    commitSha,
    actor,
  };
}

export function deliveryIdFromHeaders(provider: WebhookProvider, headers: HeaderBag, rawBody: Buffer): string {
  const header =
    headerValue(headers, "x-github-delivery") ??
    headerValue(headers, "x-gitlab-event-uuid") ??
    headerValue(headers, "x-gitlab-delivery") ??
    headerValue(headers, "x-gitcode-delivery") ??
    headerValue(headers, "x-gitee-delivery") ??
    headerValue(headers, "x-request-id");
  if (header) return header;
  return `${provider}-${createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`;
}

function normalizeProvider(value: string): WebhookProvider {
  if (value === "github" || value === "gitlab" || value === "gitcode" || value === "generic") return value;
  throw new BadRequestException(`不支持的 webhook provider: ${value}`);
}

function eventHeader(provider: WebhookProvider): string {
  if (provider === "github") return "x-github-event";
  if (provider === "gitlab") return "x-gitlab-event";
  if (provider === "gitcode") return "x-gitcode-event";
  return "x-webhook-event";
}

function refFromPayload(ref: string | undefined): Pick<TriggerRunDto, "refType" | "refName"> {
  if (!ref) return {};
  if (ref.startsWith("refs/heads/")) return { refType: "branch", refName: ref.slice("refs/heads/".length) };
  if (ref.startsWith("refs/tags/")) return { refType: "tag", refName: ref.slice("refs/tags/".length) };
  return { refType: "branch", refName: ref };
}

function normalizeCommitSha(value: string | undefined): string | undefined {
  if (!value || value === "0000000000000000000000000000000000000000") return undefined;
  return /^[a-f0-9]{7,40}$/i.test(value) ? value : undefined;
}

function nestedString(record: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = record;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return stringFrom(current);
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function headerValue(headers: HeaderBag, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeEnvSuffix(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
