import { Module } from "@nestjs/common";
import { SecretResolverService } from "../security/secret-resolver.service";
import { NOTIFICATION_CHANNELS, type NotificationChannel } from "./notification-channel.interface";
import { NotificationService } from "./notification.service";
import { DingtalkNotifier } from "./providers/dingtalk.notifier";
import { WebhookNotifier } from "./providers/webhook.notifier";
import { WecomNotifier } from "./providers/wecom.notifier";

@Module({
  providers: [
    // 无状态 env 读取，本地提供避免 import SecurityModule（其含全局 guard），降低耦合、杜绝循环依赖。
    SecretResolverService,
    NotificationService,
    DingtalkNotifier,
    WecomNotifier,
    WebhookNotifier,
    {
      provide: NOTIFICATION_CHANNELS,
      useFactory: (
        dingtalk: DingtalkNotifier,
        wecom: WecomNotifier,
        webhook: WebhookNotifier,
      ): NotificationChannel[] => [dingtalk, wecom, webhook],
      inject: [DingtalkNotifier, WecomNotifier, WebhookNotifier],
    },
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
