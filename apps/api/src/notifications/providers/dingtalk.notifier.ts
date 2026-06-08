import { Injectable } from "@nestjs/common";
import type { NotificationChannelKind, NotificationMessage, NotificationResult } from "@deploy-management/shared";
import { SecretResolverService } from "../../security/secret-resolver.service";
import type { NotificationChannel } from "../notification-channel.interface";
import { getErrorMessage, postJson } from "../notification-http";
import { signDingtalk } from "../signing";

const WEBHOOK_ENV = "DINGTALK_NOTIFY_WEBHOOK";
const SECRET_ENV = "DINGTALK_NOTIFY_SECRET";

@Injectable()
export class DingtalkNotifier implements NotificationChannel {
  readonly kind: NotificationChannelKind = "dingtalk";

  constructor(private readonly secrets: SecretResolverService) {}

  isConfigured(): boolean {
    return Boolean(this.secrets.optional(WEBHOOK_ENV));
  }

  async send(message: NotificationMessage): Promise<NotificationResult> {
    const base = this.secrets.optional(WEBHOOK_ENV);
    if (!base) {
      return { channel: this.kind, status: "skipped", detail: `${WEBHOOK_ENV} 未配置` };
    }

    const secret = this.secrets.optional(SECRET_ENV);
    const url = secret ? appendSign(base, secret) : base;
    const body = {
      msgtype: "markdown",
      markdown: { title: message.title, text: renderMarkdown(message) },
    };

    try {
      const response = await postJson(url, body);
      const payload = (await response.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
      if (response.ok && payload.errcode === 0) {
        return { channel: this.kind, status: "sent" };
      }
      return {
        channel: this.kind,
        status: "failed",
        detail: `http=${response.status} errcode=${payload.errcode ?? "?"} errmsg=${payload.errmsg ?? ""}`.trim(),
      };
    } catch (error) {
      return { channel: this.kind, status: "failed", detail: getErrorMessage(error) };
    }
  }
}

function appendSign(base: string, secret: string): string {
  const { timestamp, sign } = signDingtalk(secret, Date.now());
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}timestamp=${timestamp}&sign=${sign}`;
}

function renderMarkdown(message: NotificationMessage): string {
  const lines = [`#### ${message.title}`, "", message.text];
  const { applicationName, environment, actor } = message.context;
  const meta = [
    applicationName ? `应用：${applicationName}` : null,
    environment ? `环境：${environment}` : null,
    actor ? `操作人：${actor}` : null,
  ].filter(Boolean);
  if (meta.length > 0) lines.push("", `> ${meta.join(" · ")}`);
  if (message.link) lines.push("", `[查看详情](${message.link})`);
  return lines.join("\n");
}
