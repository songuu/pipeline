import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ApprovalRequest, ApprovalStatus, PipelineRun } from "@deploy-management/shared";
import { ApprovalsRepository } from "./approvals.repository";

@Injectable()
export class ApprovalsService {
  constructor(@Inject(ApprovalsRepository) private readonly repo: ApprovalsRepository) {}

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
      id: `approval-${this.repo.snapshot().length + 1}`,
      runId: run.id,
      title: `${run.applicationName} ${run.environment} 灰度 ${run.canaryPercent}% 后全量发布`,
      requester: run.actor,
      environment: run.environment,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await this.repo.prepend(approval);
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
