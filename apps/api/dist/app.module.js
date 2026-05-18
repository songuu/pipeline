"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const applications_module_1 = require("./applications/applications.module");
const approvals_module_1 = require("./approvals/approvals.module");
const artifacts_module_1 = require("./artifacts/artifacts.module");
const audit_module_1 = require("./audit/audit.module");
const code_repos_module_1 = require("./code-repos/code-repos.module");
const environments_module_1 = require("./environments/environments.module");
const executors_module_1 = require("./executors/executors.module");
const kubernetes_module_1 = require("./kubernetes/kubernetes.module");
const lifecycle_module_1 = require("./lifecycle/lifecycle.module");
const pipelines_module_1 = require("./pipelines/pipelines.module");
const releases_module_1 = require("./releases/releases.module");
const runners_module_1 = require("./runners/runners.module");
const runs_module_1 = require("./runs/runs.module");
const snapshot_module_1 = require("./snapshot/snapshot.module");
const storage_module_1 = require("./storage/storage.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            executors_module_1.ExecutorsModule,
            kubernetes_module_1.KubernetesModule,
            lifecycle_module_1.LifecycleModule,
            applications_module_1.ApplicationsModule,
            approvals_module_1.ApprovalsModule,
            artifacts_module_1.ArtifactsModule,
            audit_module_1.AuditModule,
            code_repos_module_1.CodeReposModule,
            environments_module_1.EnvironmentsModule,
            pipelines_module_1.PipelinesModule,
            releases_module_1.ReleasesModule,
            runners_module_1.RunnersModule,
            runs_module_1.RunsModule,
            snapshot_module_1.SnapshotModule,
            storage_module_1.StorageModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map