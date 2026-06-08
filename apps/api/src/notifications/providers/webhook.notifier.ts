import { Injectable } from "@nestjs/common";
import type { NotificationChannelKind, NotificationMessage, NotificationResult } from "@deploy-management/shared";
import { SecretResolverService } from "../../security/secret-resolver.service";
import type { NotificationChannel } from "../notification-channel.interface";
import { getErrorMessage, postJson } from "../notification-http";
import { hmacHex } from "../signing";

const URL_ENV = "WEBHOOK_NOTIFY_URL";
const SECRET_ENV = "WEBHOOK_NOTIFY_SECRET";

@Injectable()
export class WebhookNotifier implements NotificationChannel {
  readonly kind: NotificationChannelKind = "webhook";

  constructor(private readonly secrets: SecretResolverService) {}

  isConfigured(): boolean {
    return Boolean(this.secrets.optional(URL_ENV));
  }

  async send(message: NotificationMessage): Promise<NotificationResult> {
    const url = this.secrets.optional(URL_ENV);
    if (!url) {
      return { channel: this.kind, status: "skipped", detail: `${URL_ENV} 未配置` };
    }

    // 通用 webhook：直接转发结构化消息，便于下游自定义消费。
    const body = {
      event: message.event,
      title: message.title,
      text: message.text,
      link: message.link,
      context: message.context,
    };
    const secret = this.secrets.optional(SECRET_ENV);
    const headers: Record<string, string> = secret
      ? { "X-Signature": `sha256=${hmacHex(secret, JSON.stringify(body))}` }
      : {};

    try {
      const response = await postJson(url, body, undefined, headers);
      if (response.ok) {
        return { channel: this.kind, status: "sent" };
      }
      return { channel: this.kind, status: "failed", detail: `http=${response.status}` };
    } catch (error) {
      return { channel: this.kind, status: "failed", detail: getErrorMessage(error) };
    }
  }
}
