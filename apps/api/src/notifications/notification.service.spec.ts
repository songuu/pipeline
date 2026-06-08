import { describe, expect, it } from "vitest";
import type { ApprovalRequest, NotificationChannelKind, NotificationMessage, NotificationResult } from "@deploy-management/shared";
import type { NotificationChannel } from "./notification-channel.interface";
import { NotificationService } from "./notification.service";
import { buildApprovalRequestedMessage, buildReleaseFailureMessage } from "./notification-messages";

const message: NotificationMessage = {
  event: "deploy_failed",
  title: "上线失败",
  text: "构建超时",
  context: {},
};

class FakeChannel implements NotificationChannel {
  constructor(
    readonly kind: NotificationChannelKind,
    private readonly configured: boolean,
    private readonly behavior: "sent" | "throw" = "sent",
  ) {}
  isConfigured(): boolean {
    return this.configured;
  }
  async send(): Promise<NotificationResult> {
    if (this.behavior === "throw") throw new Error("boom");
    return { channel: this.kind, status: "sent" };
  }
}

describe("NotificationService.dispatch", () => {
  it("未配置渠道记为 skipped，不调用 send", async () => {
    const service = new NotificationService([new FakeChannel("dingtalk", false)]);
    const summary = await service.dispatch(message);
    expect(summary).toMatchObject({ event: "deploy_failed", sent: 0, failed: 0, skipped: 1 });
  });

  it("多渠道 fan-out，已配置的并行投递", async () => {
    const service = new NotificationService([
      new FakeChannel("dingtalk", true),
      new FakeChannel("wecom", true),
      new FakeChannel("webhook", false),
    ]);
    const summary = await service.dispatch(message);
    expect(summary).toMatchObject({ sent: 2, failed: 0, skipped: 1 });
  });

  it("单渠道抛错被隔离为 failed，不影响其它渠道，且不向外抛", async () => {
    const service = new NotificationService([
      new FakeChannel("dingtalk", true, "throw"),
      new FakeChannel("wecom", true, "sent"),
    ]);
    const summary = await service.dispatch(message);
    expect(summary).toMatchObject({ sent: 1, failed: 1, skipped: 0 });
    const failed = summary.results.find((result) => result.status === "failed");
    expect(failed).toMatchObject({ channel: "dingtalk", detail: "boom" });
  });

  it("全部未配置 → noop summary（全 skipped）", async () => {
    const service = new NotificationService([new FakeChannel("dingtalk", false), new FakeChannel("wecom", false)]);
    const summary = await service.dispatch(message);
    expect(summary.skipped).toBe(2);
    expect(summary.sent + summary.failed).toBe(0);
  });

  it("无渠道注册也不崩", async () => {
    const summary = await new NotificationService([]).dispatch(message);
    expect(summary.results).toEqual([]);
  });
});

describe("message builders", () => {
  it("buildApprovalRequestedMessage 取审批上下文", () => {
    const approval: ApprovalRequest = {
      id: "a1",
      runId: "run-9",
      title: "demo prod 灰度 20% 后全量发布",
      requester: "RO",
      environment: "prod",
      status: "pending",
      createdAt: "2026-06-08T00:00:00.000Z",
    };
    const built = buildApprovalRequestedMessage(approval);
    expect(built.event).toBe("approval_requested");
    expect(built.context).toMatchObject({ runId: "run-9", environment: "prod", actor: "RO" });
  });

  it("buildReleaseFailureMessage 区分 deploy_failed / rolled_back", () => {
    const release = { id: "r1", runId: "run-1", applicationId: "app", applicationName: "demo", environment: "prod", actor: "RO" } as Parameters<typeof buildReleaseFailureMessage>[0];
    expect(buildReleaseFailureMessage(release, "deploy_failed", "x").title).toContain("上线失败");
    expect(buildReleaseFailureMessage(release, "release_rolled_back", "x").title).toContain("发布已回滚");
  });
});
