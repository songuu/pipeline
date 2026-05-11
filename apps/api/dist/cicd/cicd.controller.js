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
exports.CicdController = void 0;
const common_1 = require("@nestjs/common");
const cicd_service_1 = require("./cicd.service");
let CicdController = class CicdController {
    cicdService;
    constructor(cicdService) {
        this.cicdService = cicdService;
    }
    getSnapshot() {
        return this.cicdService.getSnapshot();
    }
    getLifecycle() {
        return this.cicdService.getLifecycle();
    }
    getApplications() {
        return this.cicdService.getApplications();
    }
    getRepositories() {
        return this.cicdService.getRepositories();
    }
    getPipelines() {
        return this.cicdService.getPipelines();
    }
    createPipeline(body) {
        return this.cicdService.createPipeline(body);
    }
    getRuns() {
        return this.cicdService.getRuns();
    }
    getRun(runId) {
        return this.cicdService.getRun(runId);
    }
    getRunLogs(runId) {
        return this.cicdService.getRunLogs(runId);
    }
    triggerPipeline(pipelineId, body) {
        return this.cicdService.triggerPipeline(pipelineId, body);
    }
    cancelRun(runId) {
        return this.cicdService.cancelRun(runId);
    }
    promoteRun(runId) {
        return this.cicdService.promoteRun(runId);
    }
    decideApproval(approvalId, decision, body) {
        return this.cicdService.decideApproval(approvalId, decision, body.actor ?? "RO");
    }
};
exports.CicdController = CicdController;
__decorate([
    (0, common_1.Get)("snapshot"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CicdController.prototype, "getSnapshot", null);
__decorate([
    (0, common_1.Get)("lifecycle"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CicdController.prototype, "getLifecycle", null);
__decorate([
    (0, common_1.Get)("applications"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CicdController.prototype, "getApplications", null);
__decorate([
    (0, common_1.Get)("repositories"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CicdController.prototype, "getRepositories", null);
__decorate([
    (0, common_1.Get)("pipelines"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CicdController.prototype, "getPipelines", null);
__decorate([
    (0, common_1.Post)("pipelines"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CicdController.prototype, "createPipeline", null);
__decorate([
    (0, common_1.Get)("runs"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CicdController.prototype, "getRuns", null);
__decorate([
    (0, common_1.Get)("runs/:runId"),
    __param(0, (0, common_1.Param)("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CicdController.prototype, "getRun", null);
__decorate([
    (0, common_1.Get)("runs/:runId/logs"),
    __param(0, (0, common_1.Param)("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CicdController.prototype, "getRunLogs", null);
__decorate([
    (0, common_1.Post)("pipelines/:pipelineId/trigger"),
    __param(0, (0, common_1.Param)("pipelineId")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], CicdController.prototype, "triggerPipeline", null);
__decorate([
    (0, common_1.Post)("runs/:runId/cancel"),
    __param(0, (0, common_1.Param)("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CicdController.prototype, "cancelRun", null);
__decorate([
    (0, common_1.Post)("runs/:runId/promote"),
    __param(0, (0, common_1.Param)("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CicdController.prototype, "promoteRun", null);
__decorate([
    (0, common_1.Post)("approvals/:approvalId/:decision"),
    __param(0, (0, common_1.Param)("approvalId")),
    __param(1, (0, common_1.Param)("decision")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], CicdController.prototype, "decideApproval", null);
exports.CicdController = CicdController = __decorate([
    (0, common_1.Controller)("api"),
    __metadata("design:paramtypes", [cicd_service_1.CicdService])
], CicdController);
//# sourceMappingURL=cicd.controller.js.map