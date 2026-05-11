"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApprovalsService = void 0;
const common_1 = require("@nestjs/common");
const approvals_repository_1 = require("./approvals.repository");
let ApprovalsService = class ApprovalsService {
    repo;
    constructor(repo) {
        this.repo = repo;
    }
    list() {
        return this.repo.snapshot();
    }
    get(id) {
        const approval = this.repo.snapshot().find((item) => item.id === id);
        if (!approval) {
            throw new common_1.NotFoundException(`Approval ${id} not found`);
        }
        return approval;
    }
    async createForRun(run) {
        const approval = {
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
    async decide(approvalId, decision, actor) {
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
    pendingForRun(runId) {
        return this.repo.snapshot().find((item) => item.runId === runId && item.status === "pending");
    }
};
exports.ApprovalsService = ApprovalsService;
exports.ApprovalsService = ApprovalsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(approvals_repository_1.ApprovalsRepository)),
    __metadata("design:paramtypes", [approvals_repository_1.ApprovalsRepository])
], ApprovalsService);
//# sourceMappingURL=approvals.service.js.map