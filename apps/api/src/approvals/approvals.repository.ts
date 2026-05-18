import { Injectable } from "@nestjs/common";
import type { ApprovalRequest } from "@deploy-management/shared";
import { InMemoryRepository } from "../common/in-memory.repository";

@Injectable()
export class ApprovalsRepository extends InMemoryRepository<ApprovalRequest> {
  constructor() {
    super([], "approvals");
  }
}
