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
exports.RunsController = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const shared_1 = require("@deploy-management/shared");
const api_response_1 = require("../common/api-response");
const zod_validation_pipe_1 = require("../common/zod-validation.pipe");
const pipelines_service_1 = require("../pipelines/pipelines.service");
const roles_decorator_1 = require("../security/roles.decorator");
const runs_service_1 = require("./runs.service");
const trigger_run_dto_1 = require("./dto/trigger-run.dto");
let RunsController = class RunsController {
    runs;
    pipelines;
    constructor(runs, pipelines) {
        this.runs = runs;
        this.pipelines = pipelines;
    }
    legacyList() {
        return this.runs.list();
    }
    legacyGet(runId) {
        return this.runs.get(runId);
    }
    legacyLogs(runId) {
        return this.runs.getLogs(runId);
    }
    legacyEvents(runId) {
        return this.runs.getEvents(runId);
    }
    streamEvents(runId) {
        this.runs.get(runId);
        return new rxjs_1.Observable((subscriber) => {
            let cursor = 0;
            const publish = () => {
                const events = this.runs.getEvents(runId);
                for (const event of events.slice(cursor)) {
                    subscriber.next({ data: event });
                }
                cursor = events.length;
            };
            publish();
            const interval = setInterval(publish, 1_000);
            return () => clearInterval(interval);
        });
    }
    legacyTrigger(pipelineId, body, principal) {
        return this.runs.trigger(pipelineId, { ...body, actor: body.actor ?? principal.actor });
    }
    legacyCancel(runId) {
        return this.runs.cancel(runId);
    }
    legacyPromote(runId) {
        return this.runs.promote(runId);
    }
    legacyDecideApproval(approvalId, decision, body, principal) {
        return this.runs.decideApproval(approvalId, decision, body.actor ?? principal.actor);
    }
    // -------------------------------------------------------------------------
    // Yunxiao 风格 OpenAPI
    // -------------------------------------------------------------------------
    list() {
        const items = this.runs.list().map((run) => (0, shared_1.toPipelineRunInstance)(run));
        return (0, api_response_1.ok)(items, { total: items.length });
    }
    get(pipelineRunId) {
        const run = this.runs.get(pipelineRunId);
        return (0, api_response_1.ok)((0, shared_1.toPipelineRunInstance)(run));
    }
    listForPipeline(pipelineId) {
        const items = this.runs
            .list()
            .filter((run) => run.pipelineId === pipelineId)
            .map((run) => (0, shared_1.toPipelineRunInstance)(run));
        return (0, api_response_1.ok)(items, { total: items.length });
    }
    async startRun(pipelineId, params, principal) {
        const pipeline = this.pipelines.get(pipelineId);
        const trigger = this.runs.toTriggerRequest(pipeline, params, principal.actor);
        const run = await this.runs.trigger(pipelineId, trigger);
        return (0, api_response_1.ok)((0, shared_1.toPipelineRunInstance)(run));
    }
    async cancelRun(pipelineRunId) {
        const run = await this.runs.cancel(pipelineRunId);
        return (0, api_response_1.ok)((0, shared_1.toPipelineRunInstance)(run));
    }
    async promoteRun(pipelineRunId) {
        const run = await this.runs.promote(pipelineRunId);
        return (0, api_response_1.ok)((0, shared_1.toPipelineRunInstance)(run));
    }
    async decideApproval(approvalId, decision, body, principal) {
        const { run } = await this.runs.decideApproval(approvalId, decision, body.actor ?? principal.actor);
        return (0, api_response_1.ok)((0, shared_1.toPipelineRunInstance)(run));
    }
};
exports.RunsController = RunsController;
__decorate([
    (0, common_1.Get)("api/runs"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Array)
], RunsController.prototype, "legacyList", null);
__decorate([
    (0, common_1.Get)("api/runs/:runId"),
    __param(0, (0, common_1.Param)("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Object)
], RunsController.prototype, "legacyGet", null);
__decorate([
    (0, common_1.Get)("api/runs/:runId/logs"),
    __param(0, (0, common_1.Param)("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Array)
], RunsController.prototype, "legacyLogs", null);
__decorate([
    (0, common_1.Get)("api/runs/:runId/events"),
    __param(0, (0, common_1.Param)("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Array)
], RunsController.prototype, "legacyEvents", null);
__decorate([
    (0, common_1.Sse)("api/runs/:runId/events/stream"),
    __param(0, (0, common_1.Param)("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", rxjs_1.Observable)
], RunsController.prototype, "streamEvents", null);
__decorate([
    (0, common_1.Post)("api/pipelines/:pipelineId/trigger"),
    (0, roles_decorator_1.RequireRoles)("member"),
    __param(0, (0, common_1.Param)("pipelineId")),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(trigger_run_dto_1.triggerRunSchema))),
    __param(2, (0, roles_decorator_1.CurrentPrincipal)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], RunsController.prototype, "legacyTrigger", null);
__decorate([
    (0, common_1.Post)("api/runs/:runId/cancel"),
    (0, roles_decorator_1.RequireRoles)("member"),
    __param(0, (0, common_1.Param)("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RunsController.prototype, "legacyCancel", null);
__decorate([
    (0, common_1.Post)("api/runs/:runId/promote"),
    (0, roles_decorator_1.RequireRoles)("member"),
    __param(0, (0, common_1.Param)("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RunsController.prototype, "legacyPromote", null);
__decorate([
    (0, common_1.Post)("api/approvals/:approvalId/:decision"),
    (0, roles_decorator_1.RequireRoles)("member"),
    __param(0, (0, common_1.Param)("approvalId")),
    __param(1, (0, common_1.Param)("decision", new zod_validation_pipe_1.ZodValidationPipe(trigger_run_dto_1.approvalDecisionParamSchema))),
    __param(2, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(trigger_run_dto_1.approvalDecisionSchema))),
    __param(3, (0, roles_decorator_1.CurrentPrincipal)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], RunsController.prototype, "legacyDecideApproval", null);
__decorate([
    (0, common_1.Get)("oapi/v1/flow/pipelineRuns"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], RunsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("oapi/v1/flow/pipelineRuns/:pipelineRunId"),
    __param(0, (0, common_1.Param)("pipelineRunId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Object)
], RunsController.prototype, "get", null);
__decorate([
    (0, common_1.Get)("oapi/v1/flow/pipelines/:pipelineId/runs"),
    __param(0, (0, common_1.Param)("pipelineId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Object)
], RunsController.prototype, "listForPipeline", null);
__decorate([
    (0, common_1.Post)("oapi/v1/flow/pipelines/:pipelineId/runs"),
    (0, roles_decorator_1.RequireRoles)("member"),
    __param(0, (0, common_1.Param)("pipelineId")),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(trigger_run_dto_1.startPipelineRunSchema))),
    __param(2, (0, roles_decorator_1.CurrentPrincipal)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], RunsController.prototype, "startRun", null);
__decorate([
    (0, common_1.Post)("oapi/v1/flow/pipelineRuns/:pipelineRunId/cancel"),
    (0, roles_decorator_1.RequireRoles)("member"),
    __param(0, (0, common_1.Param)("pipelineRunId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RunsController.prototype, "cancelRun", null);
__decorate([
    (0, common_1.Post)("oapi/v1/flow/pipelineRuns/:pipelineRunId/promote"),
    (0, roles_decorator_1.RequireRoles)("member"),
    __param(0, (0, common_1.Param)("pipelineRunId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RunsController.prototype, "promoteRun", null);
__decorate([
    (0, common_1.Post)("oapi/v1/flow/approvals/:approvalId/:decision"),
    (0, roles_decorator_1.RequireRoles)("member"),
    __param(0, (0, common_1.Param)("approvalId")),
    __param(1, (0, common_1.Param)("decision", new zod_validation_pipe_1.ZodValidationPipe(trigger_run_dto_1.approvalDecisionParamSchema))),
    __param(2, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(trigger_run_dto_1.approvalDecisionSchema))),
    __param(3, (0, roles_decorator_1.CurrentPrincipal)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], RunsController.prototype, "decideApproval", null);
exports.RunsController = RunsController = __decorate([
    (0, roles_decorator_1.RequireRoles)("viewer"),
    (0, common_1.Controller)(),
    __param(0, (0, common_1.Inject)(runs_service_1.RunsService)),
    __param(1, (0, common_1.Inject)(pipelines_service_1.PipelinesService)),
    __metadata("design:paramtypes", [runs_service_1.RunsService,
        pipelines_service_1.PipelinesService])
], RunsController);
//# sourceMappingURL=runs.controller.js.map