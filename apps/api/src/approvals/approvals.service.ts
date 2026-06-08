import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ApprovalRequest, ApprovalStatus, PipelineRun } from "@deploy-management/shared";
import { createStableId } from "../common/ids";
import { buildApprovalRequestedMessage } from "../notifications/notification-messages";
import { NotificationService } from "../notifications/notification.service";
import { ApprovalsRepository } from "./approvals.repository";

@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(ApprovalsRepository) private readonly repo: ApprovalsRepository,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  list(): ApprovalRequest[] {
    return this.repo.snapshot();
  }

  get(id: string): ApprovalRequest {
    const approval = this.repo.snapshot().find((item) => item.id === id);
    if (!approval) {
      throw new NotFoundException(`Approval ${id} not found`);
    }
    return approval;
  }

  async createForRun(run: PipelineRun): Promise<ApprovalRequest> {
    const approval: ApprovalRequest = {
      id: createStableId("approval"),
      runId: run.id,
      title: `${run.applicationName} ${run.environment} 灰度 ${run.canaryPercent}% 后全量发布`,
      requester: run.actor,
      environment: run.environment,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await this.repo.prepend(approval);
    // 旁路通知：dispatch 自身不抛错，仍兜底 catch 确保审批主流程绝不被通知拖累。
    try {
      await this.notifications.dispatch(buildApprovalRequestedMessage(approval));
    } catch {
      // 通知失败不影响审批创建结果
    }
    return approval;
  }

  async decide(approvalId: string, decision: ApprovalStatus, actor: string): Promise<ApprovalRequest> {
    if (!["approved", "rejected"].includes(decision)) {
      return this.get(approvalId);
    }
    const updated = await this.repo.update(approvalId, {
      status: decision,
      decidedAt: new Date().toISOString(),
      decidedBy: actor,
    });
    return updated;
  }

  pendingForRun(runId: string): ApprovalRequest | undefined {
    return this.repo.snapshot().find((item) => item.runId === runId && item.status === "pending");
  }
}
