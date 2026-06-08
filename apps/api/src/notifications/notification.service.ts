import { Inject, Injectable } from "@nestjs/common";
import type {
  NotificationDispatchSummary,
  NotificationMessage,
  NotificationResult,
} from "@deploy-management/shared";
import { NOTIFICATION_CHANNELS, type NotificationChannel } from "./notification-channel.interface";
import { getErrorMessage } from "./notification-http";

@Injectable()
export class NotificationService {
  constructor(@Inject(NOTIFICATION_CHANNELS) private readonly channels: readonly NotificationChannel[]) {}

  /**
   * 向所有已配置渠道 fan-out 投递。通知是旁路：
   * - 未配置渠道记为 skipped；
   * - 单渠道失败被隔离为 failed，绝不向调用方抛错（不能炸主流程）。
   */
  async dispatch(message: NotificationMessage): Promise<NotificationDispatchSummary> {
    const results = await Promise.all(
      this.channels.map(async (channel): Promise<NotificationResult> => {
        if (!channel.isConfigured()) {
          return { channel: channel.kind, status: "skipped" };
        }
        try {
          return await channel.send(message);
        } catch (error) {
          return { channel: channel.kind, status: "failed", detail: getErrorMessage(error) };
        }
      }),
    );

    return summarize(message, results);
  }
}

function summarize(message: NotificationMessage, results: NotificationResult[]): NotificationDispatchSummary {
  return {
    event: message.event,
    sent: results.filter((result) => result.status === "sent").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    results,
  };
}
