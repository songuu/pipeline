import type { NotificationChannelKind, NotificationMessage, NotificationResult } from "@deploy-management/shared";

/**
 * 单个出站通知渠道。实现负责自身配置探测与真实投递。
 * 约定：send() 自身不应向调用方抛错；不可控异常由 NotificationService 兜底隔离。
 */
export interface NotificationChannel {
  readonly kind: NotificationChannelKind;
  /** 渠道是否已配置（对应 webhook env 是否存在）。未配置 → dispatch 记为 skipped。 */
  isConfigured(): boolean;
  send(message: NotificationMessage): Promise<NotificationResult>;
}

/** 注入 token：已注册的渠道数组 */
export const NOTIFICATION_CHANNELS = Symbol("NOTIFICATION_CHANNELS");
