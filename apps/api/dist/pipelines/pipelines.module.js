"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelinesModule = void 0;
const common_1 = require("@nestjs/common");
const applications_module_1 = require("../applications/applications.module");
const code_repos_module_1 = require("../code-repos/code-repos.module");
const audit_module_1 = require("../audit/audit.module");
const pipelines_controller_1 = require("./pipelines.controller");
const pipelines_repository_1 = require("./pipelines.repository");
const pipelines_service_1 = require("./pipelines.service");
let PipelinesModule = class PipelinesModule {
};
exports.PipelinesModule = PipelinesModule;
exports.PipelinesModule = PipelinesModule = __decorate([
    (0, common_1.Module)({
        imports: [applications_module_1.ApplicationsModule, code_repos_module_1.CodeReposModule, audit_module_1.AuditModule],
        controllers: [pipelines_controller_1.PipelinesController],
        providers: [pipelines_service_1.PipelinesService, pipelines_repository_1.PipelinesRepository],
        exports: [pipelines_service_1.PipelinesService, pipelines_repository_1.PipelinesRepository],
    })
], PipelinesModule);
//# sourceMappingURL=pipelines.module.js.map