"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunsModule = void 0;
const common_1 = require("@nestjs/common");
const applications_module_1 = require("../applications/applications.module");
const approvals_module_1 = require("../approvals/approvals.module");
const artifacts_module_1 = require("../artifacts/artifacts.module");
const audit_module_1 = require("../audit/audit.module");
const code_repos_module_1 = require("../code-repos/code-repos.module");
const lifecycle_module_1 = require("../lifecycle/lifecycle.module");
const pipelines_module_1 = require("../pipelines/pipelines.module");
const runs_controller_1 = require("./runs.controller");
const runs_repository_1 = require("./runs.repository");
const runs_service_1 = require("./runs.service");
// Seed lifecycle is owned by RunsService.onModuleInit (provider-level), not the
// module class. Module-class constructor DI is unreliable under tsx/esbuild
// because decorator metadata is not emitted for non-provider classes.
let RunsModule = class RunsModule {
};
exports.RunsModule = RunsModule;
exports.RunsModule = RunsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            applications_module_1.ApplicationsModule,
            approvals_module_1.ApprovalsModule,
            artifacts_module_1.ArtifactsModule,
            audit_module_1.AuditModule,
            code_repos_module_1.CodeReposModule,
            lifecycle_module_1.LifecycleModule,
            pipelines_module_1.PipelinesModule,
        ],
        controllers: [runs_controller_1.RunsController],
        providers: [runs_service_1.RunsService, runs_repository_1.RunsRepository],
        exports: [runs_service_1.RunsService, runs_repository_1.RunsRepository],
    })
], RunsModule);
//# sourceMappingURL=runs.module.js.map