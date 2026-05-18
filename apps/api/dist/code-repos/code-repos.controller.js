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
exports.CodeReposController = void 0;
const common_1 = require("@nestjs/common");
const api_response_1 = require("../common/api-response");
const zod_validation_pipe_1 = require("../common/zod-validation.pipe");
const roles_decorator_1 = require("../security/roles.decorator");
const code_repos_service_1 = require("./code-repos.service");
const remote_repository_dto_1 = require("./dto/remote-repository.dto");
let CodeReposController = class CodeReposController {
    service;
    constructor(service) {
        this.service = service;
    }
    legacyList() {
        return this.service.list();
    }
    resolve(body) {
        return this.service.resolveRemote(body);
    }
    refs(body) {
        return this.service.listRemoteRefs(body);
    }
    list() {
        const items = this.service.list();
        return (0, api_response_1.ok)(items, { total: items.length });
    }
    get(id) {
        return (0, api_response_1.ok)(this.service.get(id));
    }
};
exports.CodeReposController = CodeReposController;
__decorate([
    (0, common_1.Get)("api/repositories"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Array)
], CodeReposController.prototype, "legacyList", null);
__decorate([
    (0, common_1.Post)("api/repositories/resolve"),
    (0, roles_decorator_1.RequireRoles)("member"),
    __param(0, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(remote_repository_dto_1.resolveRepositorySchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CodeReposController.prototype, "resolve", null);
__decorate([
    (0, common_1.Post)("api/repositories/refs"),
    (0, roles_decorator_1.RequireRoles)("member"),
    __param(0, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(remote_repository_dto_1.remoteRepositoryRefsSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CodeReposController.prototype, "refs", null);
__decorate([
    (0, common_1.Get)("oapi/v1/flow/repositories"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], CodeReposController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("oapi/v1/flow/repositories/:id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Object)
], CodeReposController.prototype, "get", null);
exports.CodeReposController = CodeReposController = __decorate([
    (0, roles_decorator_1.RequireRoles)("viewer"),
    (0, common_1.Controller)(),
    __param(0, (0, common_1.Inject)(code_repos_service_1.CodeReposService)),
    __metadata("design:paramtypes", [code_repos_service_1.CodeReposService])
], CodeReposController);
//# sourceMappingURL=code-repos.controller.js.map