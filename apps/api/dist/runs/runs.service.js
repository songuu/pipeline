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
const shared_1 = require("@deploy-management/shared");
const applications_service_1 = require("../applications/applications.service");
const approvals_service_1 = require("../approvals/approvals.service");
const artifacts_service_1 = require("../artifacts/artifacts.service");
const audit_service_1 = require("../audit/audit.service");
const ids_1 = require("../common/ids");
const code_repos_service_1 = require("../code-repos/code-repos.service");
const lifecycle_engine_1 = require("../lifecycle/lifecycle.engine");
const pipelines_service_1 = require("../pipelines/pipelines.service");
const run_events_repository_1 = require("./run-events.repository");
const runs_repository_1 = require("./runs.repository");
let RunsService = class RunsService {
    repo;
    pipelines;
    applications;
    codeRepos;
    lifecycle;
    approvals;
    artifacts;
    audit;
    runEvents;
    liveTimers = new Map();
    runHandles = new Map();
    constructor(repo, pipelines, applications, codeRepos, lifecycle, approvals, artifacts, audit, runEvents) {
        this.repo = repo;
        this.pipelines = pipelines;
        this.applications = applications;
        this.codeRepos = codeRepos;
        this.lifecycle = lifecycle;
        this.approvals = approvals;
        this.artifacts = artifacts;
        this.audit = audit;
        this.runEvents = runEvents;
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
    getEvents(id) {
        this.get(id);
        return this.runEvents.listForRun(id);
    }
    /**
     * Trigger a pipeline run. The platform-native shape (TriggerRunRequest) is
     * used; controllers translate Yunxiao-shaped StartPipelineRunParams to this
     * shape before calling. Runs always go through the realtime ExecutorAdapter
     * (local-docker / tekton); the legacy `instant` mode was retired in sprint-1.
     */
    async trigger(pipelineId, request) {
        const pipeline = this.pipelines.get(pipelineId);
        const application = this.findApplication(pipeline.applicationId) ?? createDraftApplication(pipeline);
        const realRepository = this.findRepository(request.repositoryId ?? pipeline.repositoryId);
        const repository = realRepository ?? createDraftRepositoryFromPipeline(pipeline, request.repositoryId ?? pipeline.repositoryId, request);
        const refType = request.refType ?? pipeline.defaultRefType;
        const refName = request.refName ??
            request.branch ??
            request.tag ??
            pipeline.defaultRef ??
            (refType === "branch" ? repository.defaultBranch : repository.tags[0]);
        if (!refName) {
            throw new common_1.BadRequestException(`Pipeline ${pipelineId} 缺少有效的 refName`);
        }
        if (!repository.url.trim()) {
            throw new common_1.BadRequestException(`Pipeline ${pipelineId} 缺少仓库地址，请先完成流水线源配置`);
        }
        if (realRepository) {
            this.codeRepos.assertReference(realRepository, refType, refName);
        }
        const requestedStages = request.stages ? this.pipelines.normalizeStages(request.stages) : pipeline.stages;
        const runtimeStages = this.pipelines.normalizeStages((0, shared_1.ensureRegistryUploadStage)(requestedStages, (0, shared_1.resolveImageArtifact)(pipeline)));
        const runPipeline = {
            ...pipeline,
            repositoryId: repository.id,
            repository: repository.url,
            defaultRefType: refType,
            defaultRef: refName,
            defaultBranch: refType === "branch" ? refName : repository.defaultBranch,
            targetEnvironment: request.environment ?? pipeline.targetEnvironment,
            canaryPercent: request.canaryPercent ?? pipeline.canaryPercent,
            stages: runtimeStages,
        };
        this.assertSourcePolicy(pipeline, refType, refName, request.commitSha);
        this.assertRealArtifactPrerequisites(runPipeline);
        const runId = (0, ids_1.createStableId)("run");
        const resolvedCommit = await this.resolveRunCommit(runPipeline, repository, refType, refName, request.commitSha, request.repositoryAccessToken);
        const { repositoryAccessToken: _repositoryAccessToken, ...safeRequest } = request;
        const run = this.lifecycle.createRun({
            pipeline: runPipeline,
            applicationName: application.name,
            request: {
                ...safeRequest,
                repositoryId: repository.id,
                refType,
                refName,
                branch: refType === "branch" ? refName : repository.defaultBranch,
                tag: refType === "tag" ? refName : undefined,
                commitSha: request.commitSha,
            },
            runId,
            resolvedCommit,
        });
        await this.repo.prepend(run);
        this.scheduleRealtimeRun(run);
        await this.audit.record(run.actor, "trigger_pipeline", `${runPipeline.name}/${run.id}/${refType}:${refName}`);
        return run;
    }
    async cancel(runId) {
        const run = this.get(runId);
        this.clearRunTimers(runId);
        const handle = this.runHandles.get(runId) ?? run.executor;
        if (handle) {
            await this.lifecycle.cancelExecutor(handle).catch(() => undefined);
        }
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
        const repository = this.findRepository(pipeline.repositoryId) ?? createDraftRepositoryFromPipeline(pipeline, pipeline.repositoryId, {});
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
    findApplication(id) {
        return this.applications.list().find((application) => application.id === id);
    }
    findRepository(id) {
        return this.codeRepos.list().find((repository) => repository.id === id);
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
    assertRealArtifactPrerequisites(pipeline) {
        const stages = new Set(pipeline.stages);
        const requiresRealBuild = stages.has("build") || stages.has("upload");
        if (!requiresRealBuild)
            return;
        const image = (0, shared_1.resolveImageArtifact)(pipeline);
        const buildConfig = pipeline.buildConfig ?? shared_1.DEFAULT_PIPELINE_BUILD_CONFIG;
        const missing = [];
        const backend = this.lifecycle.backendTag;
        if (backend !== "tekton" && backend !== "local-docker") {
            missing.push(`执行器需要使用 EXECUTOR=tekton 或 EXECUTOR=local-docker，当前是 ${backend}`);
        }
        if (backend === "tekton" && process.env.TEKTON_ALLOW_SIMULATED_FALLBACK === "true") {
            missing.push("TEKTON_ALLOW_SIMULATED_FALLBACK 仍为 true，真实构建不允许降级成模拟结果");
        }
        if (!pipeline.repository.trim()) {
            missing.push("仓库地址不能为空，真实构建需要从 Git 仓库 checkout 源码");
        }
        if ((stages.has("build") || stages.has("upload")) && !stages.has("source") && !process.env.TEKTON_PIPELINE_REF) {
            missing.push("inline Pipeline 的真实打包/上传必须包含 source 阶段，用于正式拉取代码");
        }
        if (!image.registryUrl.trim()) {
            missing.push("镜像仓库地址 imageArtifact.registryUrl 不能为空");
        }
        if (!image.namespace.trim()) {
            missing.push("镜像 namespace/project 不能为空");
        }
        if (!image.imageName.trim()) {
            missing.push("镜像仓库名称 imageName 不能为空");
        }
        if (!image.tagTemplate.trim()) {
            missing.push("镜像 Tag 模板 tagTemplate 不能为空");
        }
        if (stages.has("build") || stages.has("upload")) {
            if (!buildConfig.packageBuildScript.trim()) {
                missing.push("package.json 打包脚本不能为空，请配置 buildConfig.packageBuildScript，例如 build 或 build:prod");
            }
            if (buildConfig.packageOutputPaths.length === 0) {
                missing.push("真实打包需要至少一个产物目录，例如 .next、dist、build 或 out");
            }
            if (!image.dockerfilePath.trim()) {
                missing.push("Dockerfile 路径不能为空");
            }
            if (!image.contextPath.trim()) {
                missing.push("构建上下文 contextPath 不能为空");
            }
            if (backend === "tekton" && !process.env.TEKTON_PIPELINE_REF && !process.env.TEKTON_SOURCE_PVC) {
                missing.push("缺少 TEKTON_SOURCE_PVC，inline Pipeline 需要 source-ws PVC 承载真实 checkout、package 打包产物和 Docker build 上下文");
            }
        }
        if (stages.has("upload")) {
            if (!image.serviceConnection.trim()) {
                missing.push("上传服务连接不能为空");
            }
            if (backend === "tekton" && image.privateRegistry && !image.dockerConfigSecret?.trim() && !process.env.TEKTON_DOCKER_SECRET) {
                missing.push("私有镜像仓库需要 docker-registry Secret：配置 imageArtifact.dockerConfigSecret 或 TEKTON_DOCKER_SECRET");
            }
            if (backend === "local-docker" && image.privateRegistry && !hasLocalRegistryPassword()) {
                missing.push("本机 Docker 推送私有镜像需要设置 ACR_PASSWORD、ALIYUN_ACR_PASSWORD、REGISTRY_PASSWORD 或 DOCKER_PASSWORD");
            }
        }
        if (missing.length > 0) {
            throw new common_1.BadRequestException(`真实打包/上传前置条件缺失：${missing.join("；")}`);
        }
    }
    async resolveRunCommit(pipeline, repository, refType, refName, commitSha, repositoryAccessToken) {
        if (commitSha?.trim())
            return commitSha.trim();
        const localCommit = refType === "branch" && refName === repository.defaultBranch
            ? repository.recentCommits[0]?.sha
            : undefined;
        if (localCommit)
            return localCommit;
        const requiresRealBuild = pipelineRequiresRealArtifacts(pipeline);
        if (requiresRealBuild) {
            return this.codeRepos.resolveCommit({
                url: pipeline.repository,
                provider: repository.provider,
                accessToken: repositoryAccessToken,
                refType,
                refName,
            });
        }
        return (0, ids_1.createStableId)("unresolved-commit");
    }
    scheduleRealtimeRun(run) {
        this.clearRunTimers(run.id);
        void this.startRealtimeExecutorRun(run);
    }
    async ensureApproval(run) {
        if (this.approvals.pendingForRun(run.id))
            return;
        await this.approvals.createForRun(run);
    }
    async startRealtimeExecutorRun(run) {
        try {
            const handle = await this.lifecycle.startExecutor(run);
            this.runHandles.set(run.id, handle);
            void this.consumeExecutorEvents(run, handle);
            await this.syncExecutorRun(run, handle);
        }
        catch (error) {
            this.failExecutorRun(run, `执行器启动失败: ${describeError(error)}`);
        }
    }
    async syncExecutorRun(run, handle) {
        if (this.isTerminal(run))
            return;
        try {
            const status = await this.lifecycle.executorStatus(handle);
            await this.runEvents.recordStatusSnapshot(handle, status);
            this.lifecycle.syncExecutorStatus(run, status);
            await this.upsertCompletedStageArtifacts(run);
            if (run.status === "waiting_approval") {
                await this.artifacts.upsertFromRun(run);
                await this.ensureApproval(run);
                this.clearRunTimers(run.id);
                return;
            }
            if (run.status === "success") {
                await this.artifacts.upsertFromRun(run);
                await this.artifacts.upsertFromRun(run, "provenance");
                this.clearRunTimers(run.id);
                return;
            }
            if (this.isTerminal(run)) {
                this.clearRunTimers(run.id);
                return;
            }
        }
        catch (error) {
            this.failExecutorRun(run, `执行器状态同步失败: ${describeError(error)}`);
            return;
        }
        this.trackTimer(run.id, setTimeout(() => {
            void this.syncExecutorRun(run, handle);
        }, 700));
    }
    async upsertCompletedStageArtifacts(run) {
        for (const stage of run.stages) {
            if (stage.status === "success") {
                await this.artifacts.upsertFromStage(run, stage.key);
            }
        }
    }
    async consumeExecutorEvents(run, handle) {
        try {
            for await (const event of this.lifecycle.executorEvents(handle)) {
                await this.runEvents.append(event, handle.backend);
                if (this.isTerminal(run))
                    return;
            }
        }
        catch (error) {
            await this.runEvents.append({
                runId: run.id,
                type: "status",
                timestamp: new Date().toISOString(),
                payload: {
                    status: "EVENT_STREAM_FAILED",
                    error: describeError(error),
                },
            }, "control-plane");
        }
    }
    failExecutorRun(run, message) {
        const stage = run.stages.find((item) => item.status === "running") ??
            run.stages.find((item) => item.status === "pending") ??
            run.stages[0];
        if (stage) {
            this.lifecycle.failStage(stage, run, [message]);
        }
        else {
            run.status = "failed";
            run.updatedAt = new Date().toISOString();
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
    __param(8, (0, common_1.Inject)(run_events_repository_1.RunEventsRepository)),
    __metadata("design:paramtypes", [runs_repository_1.RunsRepository,
        pipelines_service_1.PipelinesService,
        applications_service_1.ApplicationsService,
        code_repos_service_1.CodeReposService,
        lifecycle_engine_1.LifecycleEngine,
        approvals_service_1.ApprovalsService,
        artifacts_service_1.ArtifactsService,
        audit_service_1.AuditService,
        run_events_repository_1.RunEventsRepository])
], RunsService);
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
function hasLocalRegistryPassword() {
    return Boolean(process.env.ACR_PASSWORD || process.env.ALIYUN_ACR_PASSWORD || process.env.REGISTRY_PASSWORD || process.env.DOCKER_PASSWORD);
}
function pipelineRequiresRealArtifacts(pipeline) {
    return pipeline.stages.includes("build") || pipeline.stages.includes("upload");
}
function matchesAnyPattern(value, patterns) {
    return patterns.some((pattern) => globToRegExp(pattern).test(value));
}
function globToRegExp(pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`);
}
function createDraftApplication(pipeline) {
    return {
        id: pipeline.applicationId,
        name: pipeline.applicationId,
        owner: pipeline.owner,
        repositoryId: pipeline.repositoryId,
        repository: pipeline.repository,
        defaultBranch: pipeline.defaultBranch,
        language: "Node.js",
        serviceType: "web",
        environments: [pipeline.targetEnvironment],
    };
}
function createDraftRepositoryFromPipeline(pipeline, repositoryId, request) {
    const refType = request.refType ?? pipeline.defaultRefType;
    const refName = request.refName ?? request.branch ?? request.tag ?? pipeline.defaultRef;
    const defaultBranch = refType === "branch" ? refName : pipeline.defaultBranch || "main";
    return {
        id: repositoryId,
        name: repositoryNameFrom(pipeline.repository, repositoryId),
        provider: providerFrom(pipeline.repository),
        url: pipeline.repository,
        defaultBranch,
        branches: unique([defaultBranch, pipeline.defaultBranch, refType === "branch" ? refName : undefined]),
        tags: unique([refType === "tag" ? refName : undefined]),
        recentCommits: [],
        owner: pipeline.owner || "未配置",
    };
}
function unique(values) {
    return Array.from(new Set(values.map((value) => value?.trim()).filter((value) => Boolean(value))));
}
function repositoryNameFrom(url, fallback) {
    const normalizedFallback = fallback.trim() || "repository";
    if (!url.trim())
        return normalizedFallback;
    const path = url.replace(/\.git$/i, "").split(/[/:]/).filter(Boolean);
    return path[path.length - 1] || normalizedFallback;
}
function providerFrom(url) {
    if (url.includes("github.com"))
        return "github";
    if (url.includes("gitlab"))
        return "gitlab";
    if (url.includes("gitcode"))
        return "gitcode";
    if (url.includes("gitea"))
        return "gitea";
    return "codeup";
}
//# sourceMappingURL=runs.service.js.map