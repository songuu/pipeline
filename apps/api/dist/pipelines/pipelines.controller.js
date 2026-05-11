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
exports.PipelinesController = void 0;
const common_1 = require("@nestjs/common");
const api_response_1 = require("../common/api-response");
const zod_validation_pipe_1 = require("../common/zod-validation.pipe");
const audit_service_1 = require("../audit/audit.service");
const pipelines_service_1 = require("./pipelines.service");
const create_pipeline_dto_1 = require("./dto/create-pipeline.dto");
let PipelinesController = class PipelinesController {
    service;
    audit;
    constructor(service, audit) {
        this.service = service;
        this.audit = audit;
    }
    legacyList() {
        return this.service.list();
    }
    async legacyCreate(body) {
        const pipeline = await this.service.create(body);
        await this.audit.record(body.owner || "RO", "create_pipeline", pipeline.id);
        return pipeline;
    }
    async legacyUpdate(id, body) {
        const pipeline = await this.service.update(id, body);
        await this.audit.record(body.owner || "RO", "update_pipeline", pipeline.id);
        return pipeline;
    }
    async legacyDelete(id) {
        const deleted = await this.service.delete(id);
        await this.audit.record("RO", "delete_pipeline", id);
        return deleted;
    }
    list() {
        const items = this.service.list();
        return (0, api_response_1.ok)(items, { total: items.length });
    }
    get(id) {
        return (0, api_response_1.ok)(this.service.get(id));
    }
    async create(body) {
        const pipeline = await this.service.create(body);
        await this.audit.record(body.owner || "RO", "create_pipeline", pipeline.id);
        return (0, api_response_1.ok)(pipeline);
    }
    async update(id, body) {
        const pipeline = await this.service.update(id, body);
        await this.audit.record(body.owner || "RO", "update_pipeline", pipeline.id);
        return (0, api_response_1.ok)(pipeline);
    }
    async delete(id) {
        const deleted = await this.service.delete(id);
        await this.audit.record("RO", "delete_pipeline", id);
        return (0, api_response_1.ok)(deleted);
    }
};
exports.PipelinesController = PipelinesController;
__decorate([
    (0, common_1.Get)("api/pipelines"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Array)
], PipelinesController.prototype, "legacyList", null);
__decorate([
    (0, common_1.Post)("api/pipelines"),
    __param(0, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(create_pipeline_dto_1.createPipelineSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PipelinesController.prototype, "legacyCreate", null);
__decorate([
    (0, common_1.Put)("api/pipelines/:id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(create_pipeline_dto_1.updatePipelineSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PipelinesController.prototype, "legacyUpdate", null);
__decorate([
    (0, common_1.Delete)("api/pipelines/:id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PipelinesController.prototype, "legacyDelete", null);
__decorate([
    (0, common_1.Get)("oapi/v1/flow/pipelines"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], PipelinesController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("oapi/v1/flow/pipelines/:id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Object)
], PipelinesController.prototype, "get", null);
__decorate([
    (0, common_1.Post)("oapi/v1/flow/pipelines"),
    __param(0, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(create_pipeline_dto_1.createPipelineSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PipelinesController.prototype, "create", null);
__decorate([
    (0, common_1.Put)("oapi/v1/flow/pipelines/:id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(create_pipeline_dto_1.updatePipelineSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PipelinesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)("oapi/v1/flow/pipelines/:id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PipelinesController.prototype, "delete", null);
exports.PipelinesController = PipelinesController = __decorate([
    (0, common_1.Controller)(),
    __param(0, (0, common_1.Inject)(pipelines_service_1.PipelinesService)),
    __param(1, (0, common_1.Inject)(audit_service_1.AuditService)),
    __metadata("design:paramtypes", [pipelines_service_1.PipelinesService,
        audit_service_1.AuditService])
], PipelinesController);
//# sourceMappingURL=pipelines.controller.js.map