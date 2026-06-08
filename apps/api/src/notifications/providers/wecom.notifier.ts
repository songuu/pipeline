import { Injectable } from "@nestjs/common";
import type { NotificationChannelKind, NotificationMessage, NotificationResult } from "@deploy-management/shared";
import { SecretResolverService } from "../../security/secret-resolver.service";
import type { NotificationChannel } from "../notification-channel.interface";
import { getErrorMessage, postJson } from "../notification-http";

const WEBHOOK_ENV = "WECOM_NOTIFY_WEBHOOK";

@Injectable()
export class WecomNotifier implements NotificationChannel {
  readonly kind: NotificationChannelKind = "wecom";

  constructor(private readonly secrets: SecretResolverService) {}

  isConfigured(): boolean {
    return Boolean(this.secrets.optional(WEBHOOK_ENV));
  }

  async send(message: NotificationMessage): Promise<NotificationResult> {
    const url = this.secrets.optional(WEBHOOK_ENV);
    if (!url) {
      return { channel: this.kind, status: "skipped", detail: `${WEBHOOK_ENV} 未配置` };
    }

    const body = { msgtype: "markdown", markdown: { content: renderMarkdown(message) } };

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

function renderMarkdown(message: NotificationMessage): string {
  const lines = [`**${message.title}**`, message.text];
  const { applicationName, environment, actor } = message.context;
  const meta = [
    applicationName ? `应用：${applicationName}` : null,
    environment ? `环境：${environment}` : null,
    actor ? `操作人：${actor}` : null,
  ].filter(Boolean);
  if (meta.length > 0) lines.push(`> ${meta.join(" · ")}`);
  if (message.link) lines.push(`[查看详情](${message.link})`);
  return lines.join("\n");
}
