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
exports.RunsService = void 0;
const common_1 = require("@nestjs/common");
const applications_service_1 = require("../applications/applications.service");
const approvals_service_1 = require("../approvals/approvals.service");
const artifacts_service_1 = require("../artifacts/artifacts.service");
const audit_service_1 = require("../audit/audit.service");
const stage_templates_1 = require("../executors/stage-templates");
const code_repos_service_1 = require("../code-repos/code-repos.service");
const lifecycle_engine_1 = require("../lifecycle/lifecycle.engine");
const pipelines_service_1 = require("../pipelines/pipelines.service");
const runs_repository_1 = require("./runs.repository");
const LIVE_STAGE_DURATIONS = {
    source: 1_100,
    test: 1_600,
    build: 1_700,
    env: 950,
    package: 1_050,
    upload: 1_050,
    deploy: 1_500,
    canary: 1_900,
    approval: 650,
    promote: 1_300,
};
let RunsService = class RunsService {
    repo;
    pipelines;
    applications;
    codeRepos;
    lifecycle;
    approvals;
    artifacts;
    audit;
    sequence = 23844;
    seeded = false;
    liveTimers = new Map();
    async onModuleInit() {
        if (this.seeded)
            return;
        this.seeded = true;
        await this.seedInitialRuns();
    }
    constructor(repo, pipelines, applications, codeRepos, lifecycle, approvals, artifacts, audit) {
        this.repo = repo;
        this.pipelines = pipelines;
        this.applications = applications;
        this.codeRepos = codeRepos;
        this.lifecycle = lifecycle;
        this.approvals = approvals;
        this.artifacts = artifacts;
        this.audit = audit;
    }
    list() {
        return this.repo.snapshot();
    }
    get(id) {
        const run = this.repo.snapshot().find((item) => item.id === id);
        if (!run) {
            throw new common_1.NotFoundException(`Pipeline run ${id} not found`);
        }
        return run;
    }
    getLogs(id) {
        return this.get(id).stages.flatMap((stage) => stage.logs.map((line) => `[${stage.title}] ${line}`));
    }
    /**
     * Trigger a pipeline run. The platform-native shape (TriggerRunRequest) is
     * used; controllers translate Yunxiao-shaped StartPipelineRunParams to this
     * shape before calling.
     */
    async trigger(pipelineId, request, options = {}) {
        const pipeline = this.pipelines.get(pipelineId);
        const application = this.applications.get(pipeline.applicationId);
        const repository = this.codeRepos.get(request.repositoryId ?? pipeline.repositoryId);
        const refType = request.refType ?? pipeline.defaultRefType;
        const refName = request.refName ??
            request.branch ??
            request.tag ??
            pipeline.defaultRef ??
            (refType === "branch" ? repository.defaultBranch : repository.tags[0]);
        if (!refName) {
            throw new common_1.BadRequestException(`Pipeline ${pipelineId} 缺少有效的 refName`);
        }
        this.codeRepos.assertReference(repository, refType, refName);
        const runPipeline = {
            ...pipeline,
            repositoryId: repository.id,
            repository: repository.url,
            defaultRefType: refType,
            defaultRef: refName,
            defaultBranch: refType === "branch" ? refName : repository.defaultBranch,
            targetEnvironment: request.environment ?? pipeline.targetEnvironment,
            canaryPercent: request.canaryPercent ?? pipeline.canaryPercent,
            stages: request.stages ? this.pipelines.normalizeStages(request.stages) : pipeline.stages,
        };
        this.assertSourcePolicy(pipeline, refType, refName, request.commitSha);
        const run = this.lifecycle.createRun({
            pipeline: runPipeline,
            applicationName: application.name,
            request: {
                ...request,
                repositoryId: repository.id,
                refType,
                refName,
                branch: refType === "branch" ? refName : repository.defaultBranch,
                tag: refType === "tag" ? refName : undefined,
                commitSha: request.commitSha,
            },
            runNumber: this.sequence++,
        });
        if (options.mode === "instant") {
            this.lifecycle.simulateUntilGate(run);
        }
        await this.repo.prepend(run);
        if (options.mode === "instant") {
            await this.artifacts.upsertFromRun(run);
        }
        else {
            this.scheduleRealtimeRun(run);
        }
        if (options.mode === "instant" && run.status === "waiting_approval") {
            await this.approvals.createForRun(run);
        }
        await this.audit.record(run.actor, "trigger_pipeline", `${runPipeline.name}/${run.id}/${refType}:${refName}`);
        return run;
    }
    async cancel(runId) {
        const run = this.get(runId);
        this.clearRunTimers(runId);
        this.lifecycle.cancel(run);
        await this.audit.record(run.actor, "cancel_run", run.id);
        return run;
    }
    async promote(runId) {
        const run = this.get(runId);
        this.clearRunTimers(runId);
        this.lifecycle.completePromotion(run);
        await this.artifacts.upsertFromRun(run, "provenance");
        await this.audit.record("system", "promote_run", run.id);
        return run;
    }
    async decideApproval(approvalId, decision, actor) {
        if (!["approved", "rejected"].includes(decision)) {
            const approval = this.approvals.get(approvalId);
            const run = this.get(approval.runId);
            return { approval, run };
        }
        const approval = await this.approvals.decide(approvalId, decision, actor);
        const run = this.get(approval.runId);
        this.lifecycle.markApproval(run, decision === "approved", actor);
        if (decision === "approved") {
            await this.artifacts.upsertFromRun(run, "provenance");
        }
        await this.audit.record(actor, `approval_${decision}`, approval.runId);
        return { approval, run };
    }
    /**
     * Translate a Yunxiao-style StartPipelineRunParams payload into a platform
     * TriggerRunRequest, picking the first matching repository / ref.
     */
    toTriggerRequest(pipeline, params, actor) {
        const repository = this.codeRepos.get(pipeline.repositoryId);
        const branch = this.findFirstRef(repository, params.runningBranchs);
        const tag = this.findFirstRef(repository, params.runningTags);
        const refType = tag ? "tag" : "branch";
        const refName = tag ?? branch ?? pipeline.defaultRef;
        return {
            repositoryId: pipeline.repositoryId,
            refType,
            refName,
            actor,
        };
    }
    findFirstRef(repository, mapping) {
        if (!mapping)
            return undefined;
        const exact = mapping[repository.url];
        if (exact)
            return exact;
        const first = Object.values(mapping)[0];
        return typeof first === "string" ? first : undefined;
    }
    assertSourcePolicy(pipeline, refType, refName, commitSha) {
        const policy = pipeline.sourcePolicy;
        if (!policy)
            return;
        const isDefaultRef = refType === pipeline.defaultRefType && refName === pipeline.defaultRef;
        if (refType === "branch") {
            if (!isDefaultRef && !policy.allowRuntimeBranch) {
                throw new common_1.BadRequestException(`Pipeline ${pipeline.id} does not allow runtime branch selection`);
            }
            if (!matchesAnyPattern(refName, policy.allowedBranchPatterns)) {
                throw new common_1.BadRequestException(`Branch ${refName} is not allowed by source policy`);
            }
        }
        if (refType === "tag") {
            if (!isDefaultRef && !policy.allowRuntimeTag) {
                throw new common_1.BadRequestException(`Pipeline ${pipeline.id} does not allow runtime tag selection`);
            }
            if (!matchesAnyPattern(refName, policy.allowedTagPatterns)) {
                throw new common_1.BadRequestException(`Tag ${refName} is not allowed by source policy`);
            }
        }
        if (commitSha && !policy.allowRuntimeCommit) {
            throw new common_1.BadRequestException(`Pipeline ${pipeline.id} does not allow runtime commit override`);
        }
    }
    /** Initial seed runs (replaces former CicdService.seedRuns). */
    async seedInitialRuns() {
        const mallRun = await this.trigger("pipe-mall-prod", {
            actor: "RO",
            refType: "branch",
            refName: "main",
            canaryPercent: 20,
        }, { mode: "instant" });
        const mallApproval = this.approvals.pendingForRun(mallRun.id);
        if (mallApproval) {
            await this.decideApproval(mallApproval.id, "approved", "SRE-王林");
        }
        await this.trigger("pipe-admin-staging", { actor: "林青", branch: "release/2026.05" }, { mode: "instant" });
        const paymentRun = await this.trigger("pipe-payment-prod", {
            actor: "陈澄",
            refType: "branch",
            refName: "hotfix/risk-gate",
            canaryPercent: 10,
        }, { mode: "instant" });
        paymentRun.updatedAt = new Date().toISOString();
        const adminPipeline = this.pipelines.get("pipe-admin-staging");
        const application = this.applications.get(adminPipeline.applicationId);
        const failed = this.lifecycle.createRun({
            pipeline: adminPipeline,
            applicationName: application.name,
            request: { actor: "系统", branch: "develop", environment: "test" },
            runNumber: this.sequence++,
        });
        this.lifecycle.simulateUntilGate(failed, "build");
        await this.repo.prepend(failed);
        await this.audit.record("system", "nightly_pipeline_failed", failed.id);
    }
    scheduleRealtimeRun(run) {
        this.clearRunTimers(run.id);
        let stageIndex = 0;
        const advance = () => {
            if (this.isTerminal(run))
                return;
            const stage = run.stages[stageIndex];
            if (!stage) {
                this.finishRealtimeRun(run);
                return;
            }
            stageIndex += 1;
            if (stage.key === "approval" && run.definitionSnapshot.requiresApproval) {
                this.lifecycle.waitForApproval(run);
                void this.artifacts.upsertFromRun(run);
                void this.ensureApproval(run);
                this.clearRunTimers(run.id);
                return;
            }
            this.lifecycle.startStage(stage, run);
            const duration = LIVE_STAGE_DURATIONS[stage.key];
            const logs = (0, stage_templates_1.buildStageLogs)(stage.key, run, "success");
            this.trackTimer(run.id, setTimeout(() => {
                if (stage.status === "running" && !this.isTerminal(run)) {
                    this.lifecycle.appendStageLog(stage, run, logs[1] ?? `${stage.title} 正在执行。`);
                }
            }, Math.max(250, Math.floor(duration * 0.45))));
            this.trackTimer(run.id, setTimeout(() => {
                if (stage.status !== "running" || this.isTerminal(run))
                    return;
                this.lifecycle.succeedStage(stage, run);
                this.trackTimer(run.id, setTimeout(advance, 260));
            }, duration));
        };
        this.trackTimer(run.id, setTimeout(advance, 350));
    }
    async ensureApproval(run) {
        if (this.approvals.pendingForRun(run.id))
            return;
        await this.approvals.createForRun(run);
    }
    finishRealtimeRun(run) {
        if (!this.isTerminal(run)) {
            run.status = "success";
            run.progress = 100;
            run.updatedAt = new Date().toISOString();
            void this.artifacts.upsertFromRun(run);
        }
        this.clearRunTimers(run.id);
    }
    isTerminal(run) {
        return ["success", "failed", "canceled"].includes(run.status);
    }
    trackTimer(runId, timer) {
        this.liveTimers.set(runId, [...(this.liveTimers.get(runId) ?? []), timer]);
    }
    clearRunTimers(runId) {
        const timers = this.liveTimers.get(runId) ?? [];
        timers.forEach((timer) => clearTimeout(timer));
        this.liveTimers.delete(runId);
    }
};
exports.RunsService = RunsService;
exports.RunsService = RunsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(runs_repository_1.RunsRepository)),
    __param(1, (0, common_1.Inject)(pipelines_service_1.PipelinesService)),
    __param(2, (0, common_1.Inject)(applications_service_1.ApplicationsService)),
    __param(3, (0, common_1.Inject)(code_repos_service_1.CodeReposService)),
    __param(4, (0, common_1.Inject)(lifecycle_engine_1.LifecycleEngine)),
    __param(5, (0, common_1.Inject)(approvals_service_1.ApprovalsService)),
    __param(6, (0, common_1.Inject)(artifacts_service_1.ArtifactsService)),
    __param(7, (0, common_1.Inject)(audit_service_1.AuditService)),
    __metadata("design:paramtypes", [runs_repository_1.RunsRepository,
        pipelines_service_1.PipelinesService,
        applications_service_1.ApplicationsService,
        code_repos_service_1.CodeReposService,
        lifecycle_engine_1.LifecycleEngine,
        approvals_service_1.ApprovalsService,
        artifacts_service_1.ArtifactsService,
        audit_service_1.AuditService])
], RunsService);
function matchesAnyPattern(value, patterns) {
    return patterns.some((pattern) => globToRegExp(pattern).test(value));
}
function globToRegExp(pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`);
}
//# sourceMappingURL=runs.service.js.map