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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CicdService = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@deploy-management/shared");
const lifecycle_engine_1 = require("./lifecycle-engine");
let CicdService = class CicdService {
    lifecycleEngine;
    runSequence = 23844;
    pipelineSequence = 4;
    repositories = [
        {
            id: "repo-mall-api",
            name: "mall-api",
            provider: "codeup",
            url: "https://codeup.aliyun.com/company/mall-api.git",
            defaultBranch: "main",
            branches: ["main", "develop", "release/2026.05", "hotfix/cart-timeout"],
            tags: ["v2026.05.08", "v2026.05.01", "v2026.04.28"],
            owner: "后端交付组",
        },
        {
            id: "repo-admin-web",
            name: "admin-web",
            provider: "codeup",
            url: "https://codeup.aliyun.com/company/admin-web.git",
            defaultBranch: "release/2026.05",
            branches: ["main", "develop", "release/2026.05", "feature/new-dashboard"],
            tags: ["web-2026.05.08", "web-2026.05.02"],
            owner: "前端平台组",
        },
        {
            id: "repo-payment",
            name: "payment",
            provider: "codeup",
            url: "https://codeup.aliyun.com/company/payment.git",
            defaultBranch: "main",
            branches: ["main", "develop", "hotfix/risk-gate", "release/2026.05"],
            tags: ["pay-2026.05.08", "pay-2026.04.30"],
            owner: "交易稳定性组",
        },
        {
            id: "repo-ops-agent",
            name: "ops-agent",
            provider: "gitlab",
            url: "https://gitlab.internal/platform/ops-agent.git",
            defaultBranch: "develop",
            branches: ["develop", "main", "feature/windows-runner"],
            tags: ["agent-1.8.0", "agent-1.7.4"],
            owner: "基础设施组",
        },
    ];
    applications = [
        {
            id: "mall-api",
            name: "商城 API",
            owner: "后端交付组",
            repositoryId: "repo-mall-api",
            repository: "https://codeup.aliyun.com/company/mall-api.git",
            defaultBranch: "main",
            language: "Node.js / Nest",
            serviceType: "Backend Service",
            environments: ["dev", "test", "staging", "prod"],
        },
        {
            id: "admin-web",
            name: "运营后台",
            owner: "前端平台组",
            repositoryId: "repo-admin-web",
            repository: "https://codeup.aliyun.com/company/admin-web.git",
            defaultBranch: "release/2026.05",
            language: "Next.js",
            serviceType: "Frontend App",
            environments: ["dev", "test", "staging", "prod"],
        },
        {
            id: "payment",
            name: "支付服务",
            owner: "交易稳定性组",
            repositoryId: "repo-payment",
            repository: "https://codeup.aliyun.com/company/payment.git",
            defaultBranch: "main",
            language: "Java / Spring Boot",
            serviceType: "Critical Service",
            environments: ["test", "staging", "prod"],
        },
    ];
    pipelines = [
        {
            id: "pipe-mall-prod",
            name: "mall-api-prod-release",
            applicationId: "mall-api",
            repositoryId: "repo-mall-api",
            repository: "https://codeup.aliyun.com/company/mall-api.git",
            defaultBranch: "main",
            defaultRefType: "branch",
            defaultRef: "main",
            targetEnvironment: "prod",
            strategy: "canary",
            canaryPercent: 20,
            requiresApproval: true,
            stages: ["source", "test", "build", "package", "upload", "deploy", "canary", "approval", "promote"],
            triggers: ["push main", "manual", "release tag"],
            owner: "后端交付组",
        },
        {
            id: "pipe-admin-staging",
            name: "admin-web-staging",
            applicationId: "admin-web",
            repositoryId: "repo-admin-web",
            repository: "https://codeup.aliyun.com/company/admin-web.git",
            defaultBranch: "release/2026.05",
            defaultRefType: "branch",
            defaultRef: "release/2026.05",
            targetEnvironment: "staging",
            strategy: "rolling",
            canaryPercent: 100,
            requiresApproval: false,
            stages: ["source", "test", "build", "package", "upload", "deploy", "promote"],
            triggers: ["merge request", "manual"],
            owner: "前端平台组",
        },
        {
            id: "pipe-payment-prod",
            name: "payment-risk-gate",
            applicationId: "payment",
            repositoryId: "repo-payment",
            repository: "https://codeup.aliyun.com/company/payment.git",
            defaultBranch: "hotfix/risk-gate",
            defaultRefType: "branch",
            defaultRef: "hotfix/risk-gate",
            targetEnvironment: "prod",
            strategy: "canary",
            canaryPercent: 10,
            requiresApproval: true,
            stages: ["source", "test", "build", "package", "upload", "deploy", "canary", "approval", "promote"],
            triggers: ["manual", "change window"],
            owner: "交易稳定性组",
        },
    ];
    environments = [
        {
            id: "dev",
            name: "开发环境",
            cluster: "ack-dev-shanghai",
            protection: "自动部署",
            currentVersion: "2026.05.08-dev.12",
            status: "healthy",
            activeRuns: 3,
        },
        {
            id: "test",
            name: "测试环境",
            cluster: "ack-test-hangzhou",
            protection: "质量门禁",
            currentVersion: "2026.05.08-test.04",
            status: "warning",
            activeRuns: 1,
        },
        {
            id: "staging",
            name: "预发环境",
            cluster: "ack-staging-shanghai",
            protection: "冒烟通过",
            currentVersion: "2026.05.07-rc.3",
            status: "healthy",
            activeRuns: 2,
        },
        {
            id: "prod",
            name: "生产环境",
            cluster: "ack-prod-shanghai",
            protection: "审批 + 变更窗口 + 灰度观测",
            currentVersion: "2026.05.06-prod.9",
            status: "locked",
            activeRuns: 1,
        },
    ];
    runnerPools = [
        { id: "runner-k8s", name: "k8s-linux-large", type: "kubernetes", online: 18, total: 24, queue: 6, cpuUsage: 72, memoryUsage: 64 },
        { id: "runner-win", name: "self-hosted-windows", type: "windows", online: 5, total: 8, queue: 2, cpuUsage: 48, memoryUsage: 55 },
        { id: "runner-secure", name: "vm-secure-build", type: "vm", online: 7, total: 10, queue: 1, cpuUsage: 38, memoryUsage: 42 },
    ];
    runs = [];
    approvals = [];
    artifacts = [];
    auditEvents = [];
    constructor(lifecycleEngine) {
        this.lifecycleEngine = lifecycleEngine;
        this.seedRuns();
    }
    getSnapshot() {
        const successRuns = this.runs.filter((run) => run.status === "success").length;
        const finishedRuns = this.runs.filter((run) => ["success", "failed", "canceled"].includes(run.status)).length || 1;
        return {
            overview: {
                applications: this.applications.length,
                pipelines: this.pipelines.length,
                runningRuns: this.runs.filter((run) => run.status === "running").length,
                waitingApprovals: this.approvals.filter((approval) => approval.status === "pending").length,
                successRate: Math.round((successRuns / finishedRuns) * 1000) / 10,
                activeEnvironments: this.environments.filter((environment) => environment.activeRuns > 0).length,
            },
            applications: this.applications,
            repositories: this.repositories,
            pipelines: this.pipelines,
            runs: this.runs,
            approvals: this.approvals,
            environments: this.environments,
            runnerPools: this.runnerPools,
            artifacts: this.artifacts,
            auditEvents: this.auditEvents,
        };
    }
    getLifecycle() {
        return shared_1.LIFECYCLE_STAGES;
    }
    getApplications() {
        return this.applications;
    }
    getRepositories() {
        return this.repositories;
    }
    getPipelines() {
        return this.pipelines;
    }
    createPipeline(request) {
        const application = this.getApplication(request.applicationId);
        const repository = this.getRepository(request.repositoryId);
        this.assertRepositoryReference(repository, request.refType, request.refName);
        const stages = this.normalizeStages(request.stages);
        const pipeline = {
            id: `pipe-custom-${this.pipelineSequence++}`,
            name: request.name.trim() || `${application.id}-${request.targetEnvironment}-release`,
            applicationId: application.id,
            repositoryId: repository.id,
            repository: repository.url,
            defaultBranch: request.refType === "branch" ? request.refName : repository.defaultBranch,
            defaultRefType: request.refType,
            defaultRef: request.refName,
            targetEnvironment: request.targetEnvironment,
            strategy: request.strategy,
            canaryPercent: request.canaryPercent,
            requiresApproval: request.requiresApproval,
            stages,
            triggers: request.triggers.length > 0 ? request.triggers : ["manual"],
            owner: request.owner.trim() || application.owner,
        };
        this.pipelines = [pipeline, ...this.pipelines];
        this.addAudit(request.owner || "RO", "create_pipeline", pipeline.id);
        return pipeline;
    }
    getRuns() {
        return this.runs;
    }
    getRun(runId) {
        const run = this.runs.find((item) => item.id === runId);
        if (!run)
            throw new common_1.NotFoundException(`Pipeline run ${runId} not found`);
        return run;
    }
    getRunLogs(runId) {
        const run = this.getRun(runId);
        return run.stages.flatMap((stage) => stage.logs.map((line) => `[${stage.title}] ${line}`));
    }
    triggerPipeline(pipelineId, request) {
        const pipeline = this.getPipeline(pipelineId);
        const application = this.getApplication(pipeline.applicationId);
        const repository = this.getRepository(request.repositoryId ?? pipeline.repositoryId);
        const refType = request.refType ?? pipeline.defaultRefType;
        const refName = request.refName ??
            request.branch ??
            request.tag ??
            pipeline.defaultRef ??
            (refType === "branch" ? repository.defaultBranch : repository.tags[0]);
        this.assertRepositoryReference(repository, refType, refName);
        const runPipeline = {
            ...pipeline,
            repositoryId: repository.id,
            repository: repository.url,
            defaultRefType: refType,
            defaultRef: refName,
            defaultBranch: refType === "branch" ? refName : repository.defaultBranch,
            targetEnvironment: request.environment ?? pipeline.targetEnvironment,
            canaryPercent: request.canaryPercent ?? pipeline.canaryPercent,
            stages: request.stages ? this.normalizeStages(request.stages) : pipeline.stages,
        };
        const run = this.lifecycleEngine.createRun({
            pipeline: runPipeline,
            applicationName: application.name,
            request: {
                ...request,
                repositoryId: repository.id,
                refType,
                refName,
                branch: refType === "branch" ? refName : repository.defaultBranch,
                tag: refType === "tag" ? refName : undefined,
            },
            runNumber: this.runSequence++,
        });
        this.lifecycleEngine.simulateUntilGate(run);
        this.runs = [run, ...this.runs];
        this.createArtifactFromRun(run);
        if (run.status === "waiting_approval") {
            this.createApproval(run);
        }
        this.addAudit(run.actor, "trigger_pipeline", `${runPipeline.name}/${run.id}/${refType}:${refName}`);
        return run;
    }
    cancelRun(runId) {
        const run = this.getRun(runId);
        this.lifecycleEngine.cancel(run);
        this.addAudit(run.actor, "cancel_run", run.id);
        return run;
    }
    promoteRun(runId) {
        const run = this.getRun(runId);
        this.lifecycleEngine.completePromotion(run);
        this.createArtifactFromRun(run, "provenance");
        this.addAudit("system", "promote_run", run.id);
        return run;
    }
    decideApproval(approvalId, decision, actor) {
        const approval = this.approvals.find((item) => item.id === approvalId);
        if (!approval)
            throw new common_1.NotFoundException(`Approval ${approvalId} not found`);
        if (!["approved", "rejected"].includes(decision)) {
            return approval;
        }
        approval.status = decision;
        approval.decidedAt = new Date().toISOString();
        approval.decidedBy = actor;
        const run = this.getRun(approval.runId);
        this.lifecycleEngine.markApproval(run, decision === "approved", actor);
        if (decision === "approved") {
            this.createArtifactFromRun(run, "provenance");
        }
        this.addAudit(actor, `approval_${decision}`, approval.runId);
        return { approval, run };
    }
    seedRuns() {
        const mallRun = this.triggerPipeline("pipe-mall-prod", { actor: "RO", refType: "branch", refName: "main", canaryPercent: 20 });
        const approval = this.approvals.find((item) => item.runId === mallRun.id);
        if (approval) {
            this.decideApproval(approval.id, "approved", "SRE-王林");
        }
        this.triggerPipeline("pipe-admin-staging", { actor: "林青", branch: "release/2026.05" });
        const paymentRun = this.triggerPipeline("pipe-payment-prod", {
            actor: "陈澄",
            refType: "branch",
            refName: "hotfix/risk-gate",
            canaryPercent: 10,
        });
        paymentRun.updatedAt = new Date().toISOString();
        const failed = this.lifecycleEngine.createRun({
            pipeline: this.getPipeline("pipe-admin-staging"),
            applicationName: "运营后台",
            request: { actor: "系统", branch: "develop", environment: "test" },
            runNumber: this.runSequence++,
        });
        this.lifecycleEngine.simulateUntilGate(failed, "build");
        this.runs = [failed, ...this.runs];
        this.addAudit("system", "nightly_pipeline_failed", failed.id);
    }
    createApproval(run) {
        const approval = {
            id: `approval-${this.approvals.length + 1}`,
            runId: run.id,
            title: `${run.applicationName} ${run.environment} 灰度 ${run.canaryPercent}% 后全量发布`,
            requester: run.actor,
            environment: run.environment,
            status: "pending",
            createdAt: new Date().toISOString(),
        };
        this.approvals = [approval, ...this.approvals];
    }
    createArtifactFromRun(run, type = "image") {
        if (run.status === "failed" || run.status === "canceled")
            return;
        const exists = this.artifacts.some((artifact) => artifact.runId === run.id && artifact.type === type);
        if (exists)
            return;
        const artifact = {
            id: `artifact-${this.artifacts.length + 1}`,
            runId: run.id,
            name: type === "provenance"
                ? `attestation/${run.applicationId}/${run.id}.intoto.jsonl`
                : `registry.internal/${run.applicationId}`,
            version: `${run.environment}-${run.id}`,
            type,
            digest: `sha256:${run.commit}${run.id.replace("run-", "")}`,
            size: type === "provenance" ? "18 KB" : "218 MB",
            signed: run.status === "success" || type === "provenance",
            uploadedAt: new Date().toISOString(),
        };
        this.artifacts = [artifact, ...this.artifacts];
    }
    addAudit(actor, action, target) {
        this.auditEvents = [
            {
                id: `audit-${this.auditEvents.length + 1}`,
                actor,
                action,
                target,
                createdAt: new Date().toISOString(),
            },
            ...this.auditEvents,
        ];
    }
    getPipeline(pipelineId) {
        const pipeline = this.pipelines.find((item) => item.id === pipelineId);
        if (!pipeline)
            throw new common_1.NotFoundException(`Pipeline ${pipelineId} not found`);
        return pipeline;
    }
    getApplication(applicationId) {
        const application = this.applications.find((item) => item.id === applicationId);
        if (!application)
            throw new common_1.NotFoundException(`Application ${applicationId} not found`);
        return application;
    }
    getRepository(repositoryId) {
        const repository = this.repositories.find((item) => item.id === repositoryId);
        if (!repository)
            throw new common_1.NotFoundException(`Repository ${repositoryId} not found`);
        return repository;
    }
    assertRepositoryReference(repository, refType, refName) {
        const refs = refType === "branch" ? repository.branches : repository.tags;
        if (!refs.includes(refName)) {
            throw new common_1.BadRequestException(`${repository.name} does not contain ${refType} ${refName}`);
        }
    }
    normalizeStages(stages) {
        const configured = stages.length > 0 ? stages : shared_1.LIFECYCLE_STAGES.map((stage) => stage.key);
        const validKeys = new Set(shared_1.LIFECYCLE_STAGES.map((stage) => stage.key));
        const deduped = configured.filter((stage, index) => validKeys.has(stage) && configured.indexOf(stage) === index);
        const sourceFirst = deduped.includes("source") ? deduped : ["source", ...deduped];
        return sourceFirst;
    }
};
exports.CicdService = CicdService;
exports.CicdService = CicdService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [lifecycle_engine_1.LifecycleEngine])
], CicdService);
//# sourceMappingURL=cicd.service.js.map