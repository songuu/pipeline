import type { EnvironmentType } from "../platform";

/**
 * 出站通知契约（纯 TS）。通知是部署/审批事件的旁路投递，
 * 业务类型放 shared，provider 实现与边界放 apps/api。
 */

export type NotificationChannelKind = "dingtalk" | "wecom" | "webhook";

export type NotificationEventType = "approval_requested" | "deploy_failed" | "release_rolled_back";

export type NotificationContext = {
  applicationId?: string;
  applicationName?: string;
  environment?: EnvironmentType;
  runId?: string;
  releaseId?: string;
  actor?: string;
};

export type NotificationMessage = {
  event: NotificationEventType;
  title: string;
  /** markdown 正文 */
  text: string;
  link?: string;
  context: NotificationContext;
};

/** sent=已投递；failed=投递失败；skipped=渠道未配置（未激活，非错误） */
export type NotificationDeliveryStatus = "sent" | "failed" | "skipped";

export type NotificationResult = {
  channel: NotificationChannelKind;
  status: NotificationDeliveryStatus;
  detail?: string;
};

export type NotificationDispatchSummary = {
  event: NotificationEventType;
  sent: number;
  failed: number;
  skipped: number;
  results: NotificationResult[];
};
