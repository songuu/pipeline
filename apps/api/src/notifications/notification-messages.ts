import type { ApprovalRequest, NotificationMessage, ReleaseDeployment } from "@deploy-management/shared";

/** 控制台外链基址（用于通知里的"查看详情"），缺省不带链接。 */
function baseUrl(): string | undefined {
  return process.env.PUBLIC_BASE_URL?.trim() || undefined;
}

function withLink(path: string): string | undefined {
  const base = baseUrl();
  return base ? `${base.replace(/\/$/, "")}${path}` : undefined;
}

export function buildApprovalRequestedMessage(approval: ApprovalRequest): NotificationMessage {
  return {
    event: "approval_requested",
    title: "待审批：灰度后全量发布",
    text: approval.title,
    link: withLink(`/runs/${approval.runId}`),
    context: {
      runId: approval.runId,
      environment: approval.environment,
      actor: approval.requester,
    },
  };
}

export function buildReleaseFailureMessage(
  release: ReleaseDeployment,
  eventType: "deploy_failed" | "release_rolled_back",
  detail: string,
): NotificationMessage {
  const title = eventType === "deploy_failed" ? "上线失败" : "发布已回滚";
  return {
    event: eventType,
    title: `${title}：${release.applicationName} ${release.environment}`,
    text: detail,
    link: withLink(`/runs/${release.runId}`),
    context: {
      applicationId: release.applicationId,
      applicationName: release.applicationName,
      environment: release.environment,
      runId: release.runId,
      releaseId: release.id,
      actor: release.actor,
    },
  };
}
