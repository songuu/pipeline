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
exports.EnvironmentsController = void 0;
const common_1 = require("@nestjs/common");
const api_response_1 = require("../common/api-response");
const roles_decorator_1 = require("../security/roles.decorator");
const environments_service_1 = require("./environments.service");
let EnvironmentsController = class EnvironmentsController {
    service;
    constructor(service) {
        this.service = service;
    }
    legacyList() {
        return this.service.list();
    }
    list() {
        const items = this.service.list();
        return (0, api_response_1.ok)(items, { total: items.length });
    }
    legacyListTargets() {
        return this.service.listDeploymentTargets();
    }
    legacyCreateTarget(body) {
        return this.service.createDeploymentTarget(body);
    }
    legacyListLocks() {
        return this.service.listEnvironmentLocks();
    }
    legacyPreflightTarget(targetId) {
        return this.service.preflightDeploymentTarget(this.service.getDeploymentTarget(targetId));
    }
    listTargets() {
        const items = this.service.listDeploymentTargets();
        return (0, api_response_1.ok)(items, { total: items.length });
    }
    async createTarget(body) {
        return (0, api_response_1.ok)(await this.service.createDeploymentTarget(body));
    }
    listLocks() {
        const items = this.service.listEnvironmentLocks();
        return (0, api_response_1.ok)(items, { total: items.length });
    }
    preflightTarget(targetId) {
        return (0, api_response_1.ok)(this.service.preflightDeploymentTarget(this.service.getDeploymentTarget(targetId)));
    }
};
exports.EnvironmentsController = EnvironmentsController;
__decorate([
    (0, common_1.Get)("api/environments"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Array)
], EnvironmentsController.prototype, "legacyList", null);
__decorate([
    (0, common_1.Get)("oapi/v1/flow/environments"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], EnvironmentsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("api/deployment-targets"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Array)
], EnvironmentsController.prototype, "legacyListTargets", null);
__decorate([
    (0, common_1.Post)("api/deployment-targets"),
    (0, roles_decorator_1.RequireRoles)("member"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], EnvironmentsController.prototype, "legacyCreateTarget", null);
__decorate([
    (0, common_1.Get)("api/environment-locks"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Array)
], EnvironmentsController.prototype, "legacyListLocks", null);
__decorate([
    (0, common_1.Post)("api/deployment-targets/:targetId/preflight"),
    (0, roles_decorator_1.RequireRoles)("member"),
    __param(0, (0, common_1.Param)("targetId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Object)
], EnvironmentsController.prototype, "legacyPreflightTarget", null);
__decorate([
    (0, common_1.Get)("oapi/v1/flow/deployment-targets"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], EnvironmentsController.prototype, "listTargets", null);
__decorate([
    (0, common_1.Post)("oapi/v1/flow/deployment-targets"),
    (0, roles_decorator_1.RequireRoles)("member"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], EnvironmentsController.prototype, "createTarget", null);
__decorate([
    (0, common_1.Get)("oapi/v1/flow/environment-locks"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], EnvironmentsController.prototype, "listLocks", null);
__decorate([
    (0, common_1.Post)("oapi/v1/flow/deployment-targets/:targetId/preflight"),
    (0, roles_decorator_1.RequireRoles)("member"),
    __param(0, (0, common_1.Param)("targetId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Object)
], EnvironmentsController.prototype, "preflightTarget", null);
exports.EnvironmentsController = EnvironmentsController = __decorate([
    (0, roles_decorator_1.RequireRoles)("viewer"),
    (0, common_1.Controller)(),
    __param(0, (0, common_1.Inject)(environments_service_1.EnvironmentsService)),
    __metadata("design:paramtypes", [environments_service_1.EnvironmentsService])
], EnvironmentsController);
//# sourceMappingURL=environments.controller.js.map