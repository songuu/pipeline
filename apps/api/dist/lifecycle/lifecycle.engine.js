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
exports.LifecycleEngine = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@deploy-management/shared");
// LifecycleEngine 不再持有 simulated 行为；真实运行只走 ExecutorAdapter（local-docker / tekton）。
// 历史的 simulateUntilGate 在 controller 与 dev seed 都不再调用，已于 sprint-1 清理。
const executor_adapter_1 = require("./executor-adapter");
const stage_templates_1 = require("../executors/stage-templates");
const IMAGE_PARAM_KEYS = new Set([
    "REGISTRY_PROVIDER",
    "IMAGE_REGISTRY",
    "IMAGE_REPOSITORY",
    "IMAGE_NAME",
    "IMAGE_NAMESPACE",
    "IMAGE_TAG",
    "IMAGE_REF",
    "DOCKERFILE_PATH",
    "BUILD_CONTEXT",
    "BUILD_RUNTIME",
    "REGISTRY_SERVICE_CONNECTION",
    "REGISTRY_USERNAME",
    "REGISTRY_DOCKER_SECRET",
    "PACKAGE_BUILD_SCRIPT",
    "PACKAGE_OUTPUT_PATHS",
]);
/**
 * LifecycleEngine 不再持有模拟逻辑；它负责：
 *   1. 根据 PipelineDefinition + TriggerRunRequest 构造一个不可变 PipelineRun
 *   2. 把"是否已经走到审批门"这种业务半态推进到正确状态
 *   3. 把执行操作委托给 ExecutorAdapter（只发出意图）
 *
 * 状态机仍然是面向用户视角（PipelineRunStatus），与 Yunxiao 的 JobStatus 由
 * shared 中的 toYunxiaoRunStatus 统一映射。
 */
let LifecycleEngine = class LifecycleEngine {
    executor;
    constructor(executor) {
        this.executor = executor;
    }
    createRun(input) {
        const now = new Date().toISOString();
        const refType = input.request.refType ?? input.pipeline.defaultRefType;
        const refName = input.request.refName ?? input.pipeline.defaultRef;
        const branch = refType === "branch" ? refName : input.pipeline.defaultBranch;
        const tag = refType === "tag" ? refName : undefined;
        const commit = input.resolvedCommit;
        const environment = input.request.environment ?? input.pipeline.targetEnvironment;
        const canaryPercent = input.request.canaryPercent ?? input.pipeline.canaryPercent;
        const stages = input.pipeline.stages.map((key) => this.createStage(key, "pending"));
        return {
            id: input.runId,
            pipelineId: input.pipeline.id,
            pipelineName: input.pipeline.name,
            applicationId: input.pipeline.applicationId,
            applicationName: input.applicationName,
            actor: input.request.actor ?? "RO",
            repositoryId: input.pipeline.repositoryId,
            repository: input.pipeline.repository,
            refType,
            refName,
            branch,
            tag,
            commit,
            environment,
            status: "queued",
            progress: 0,
            canaryPercent,
            createdAt: now,
            updatedAt: now,
            definitionSnapshot: { ...input.pipeline, targetEnvironment: environment, canaryPercent },
            stages,
        };
    }
    async startExecutor(run) {
        const handle = await this.executor.start(this.toStartRunInput(run));
        run.executor = handle;
        run.stages.forEach((stage) => {
            stage.metadata = {
                ...stage.metadata,
                executorBackend: handle.backend,
            };
        });
        run.updatedAt = new Date().toISOString();
        return handle;
    }
    async executorStatus(handle) {
        return this.executor.status(handle);
    }
    executorEvents(handle) {
        return this.executor.events(handle);
    }
    async cancelExecutor(handle) {
        await this.executor.cancel(handle);
    }
    syncExecutorStatus(run, status) {
        const executorStages = new Map(status.stages.map((stage) => [stage.name, stage]));
        let waitingForApproval = false;
        run.stages.forEach((stage) => {
            const executorStage = executorStages.get(stage.key);
            if (!executorStage)
                return;
            const nextStatus = this.toStageStatus(stage.key, executorStage.status, run.definitionSnapshot.requiresApproval);
            if (nextStatus === "running") {
                this.syncRunningStage(stage, run, executorStage, status);
                return;
            }
            if (nextStatus === "success" || nextStatus === "failed") {
                this.syncFinishedStage(stage, run, executorStage, nextStatus);
                return;
            }
            if (nextStatus === "waiting") {
                waitingForApproval = true;
                this.waitForApproval(run);
                return;
            }
            if (nextStatus === "skipped") {
                stage.status = "skipped";
                stage.logs = stage.logs.length ? stage.logs : [`${stage.title} 已由执行器跳过。`];
                stage.metadata = {
                    ...stage.metadata,
                    executorStatus: executorStage.status,
                };
            }
        });
        if (status.status === "SUCCESS") {
            run.status = "success";
            run.progress = 100;
        }
        else if (status.status === "FAIL") {
            run.status = "failed";
            run.progress = this.calculateProgress(run);
        }
        else if (status.status === "CANCELED") {
            run.status = "canceled";
            run.progress = this.calculateProgress(run);
        }
        else if (waitingForApproval) {
            run.status = "waiting_approval";
            run.progress = this.calculateProgress(run);
        }
        else if (run.stages.some((stage) => stage.status === "running" || stage.status === "success")) {
            run.status = "running";
            run.progress = this.calculateProgress(run);
        }
        else {
            run.status = "queued";
            run.progress = this.calculateProgress(run);
        }
        if (status.finishedAt) {
            run.updatedAt = status.finishedAt;
        }
        else {
            run.updatedAt = new Date().toISOString();
        }
        return run;
    }
    completePromotion(run) {
        run.stages.forEach((stage) => {
            if (stage.status === "pending" || stage.status === "waiting" || stage.status === "running") {
                this.finishStage(stage, "success", run);
            }
        });
        run.status = "success";
        run.progress = 100;
        run.updatedAt = new Date().toISOString();
        return run;
    }
    startStage(stage, run) {
        const now = new Date().toISOString();
        stage.status = "running";
        stage.startedAt = stage.startedAt ?? now;
        stage.finishedAt = undefined;
        stage.durationMs = undefined;
        stage.logs = this.buildRunningLogs(stage, run);
        stage.metadata = {
            ...stage.metadata,
            status: "running",
        };
        run.status = "running";
        run.progress = this.calculateProgress(run);
        run.updatedAt = now;
        return run;
    }
    appendStageLog(stage, run, line) {
        if (!stage.logs.includes(line)) {
            stage.logs = [...stage.logs, line];
        }
        run.updatedAt = new Date().toISOString();
        return run;
    }
    succeedStage(stage, run, extraLogs = []) {
        this.finishStage(stage, "success", run, extraLogs);
        return run;
    }
    failStage(stage, run, extraLogs = []) {
        this.finishStage(stage, "failed", run, extraLogs);
        run.status = "failed";
        run.progress = this.calculateProgress(run);
        run.updatedAt = new Date().toISOString();
        return run;
    }
    waitForApproval(run) {
        const approvalStage = run.stages.find((stage) => stage.key === "approval");
        if (!approvalStage)
            return run;
        approvalStage.status = "waiting";
        approvalStage.startedAt = approvalStage.startedAt ?? new Date().toISOString();
        approvalStage.logs = [
            "生产环境命中审批门禁。",
            `灰度比例 ${run.canaryPercent}% 已完成，等待 owner 与 SRE 审批后继续全量。`,
        ];
        approvalStage.metadata = {
            ...approvalStage.metadata,
            status: "waiting",
        };
        run.status = "waiting_approval";
        run.progress = this.calculateProgress(run);
        run.updatedAt = new Date().toISOString();
        return run;
    }
    markApproval(run, approved, actor) {
        const approvalStage = run.stages.find((stage) => stage.key === "approval");
        if (!approvalStage)
            return run;
        if (!approved) {
            this.finishStage(approvalStage, "failed", run, [`${actor} 驳回生产发布。`]);
            const promote = run.stages.find((stage) => stage.key === "promote");
            if (promote) {
                promote.status = "skipped";
                promote.logs = ["审批驳回，跳过全量发布。"];
            }
            run.status = "failed";
            run.progress = this.calculateProgress(run);
            run.updatedAt = new Date().toISOString();
            return run;
        }
        this.finishStage(approvalStage, "success", run, [`${actor} 审批通过，继续执行全量发布。`]);
        this.completePromotion(run);
        return run;
    }
    cancel(run) {
        run.status = "canceled";
        run.stages.forEach((stage) => {
            if (stage.status === "pending" || stage.status === "running" || stage.status === "waiting") {
                stage.status = "skipped";
                stage.logs = [...stage.logs, "运行已取消。"];
            }
        });
        run.updatedAt = new Date().toISOString();
        return run;
    }
    /** Returns the executor backend tag (used in audit logs / UI badges). */
    get backendTag() {
        return this.executor.backend;
    }
    createStage(key, status) {
        const spec = (0, shared_1.getLifecycleStage)(key);
        return {
            id: `stage-${key}`,
            key,
            title: spec.title,
            status,
            logs: [],
            metadata: {
                adapter: spec.adapter,
                required: spec.required,
            },
        };
    }
    toStartRunInput(run) {
        const image = (0, shared_1.resolveImageArtifact)(run.definitionSnapshot, run);
        const buildConfig = run.definitionSnapshot.buildConfig ?? shared_1.DEFAULT_PIPELINE_BUILD_CONFIG;
        const variables = [
            { key: "ENVIRONMENT", value: run.environment },
            { key: "CANARY_PERCENT", value: String(run.canaryPercent) },
            { key: "COMMIT", value: run.commit },
            { key: "REF_TYPE", value: run.refType },
            { key: "REF_NAME", value: run.refName },
            ...(run.definitionSnapshot.variables ?? []).filter((param) => !IMAGE_PARAM_KEYS.has(param.key)),
            ...(run.definitionSnapshot.runtimeVariables ?? []).map((param) => ({
                ...param,
                key: `runtime.${param.key}`,
                injectionTiming: param.injectionTiming ?? "runtime",
            })),
            { key: "REGISTRY_PROVIDER", value: image.registryProvider ?? "custom" },
            { key: "IMAGE_REGISTRY", value: image.registryUrl },
            { key: "IMAGE_REPOSITORY", value: image.repository },
            { key: "IMAGE_NAME", value: image.imageName },
            { key: "IMAGE_NAMESPACE", value: image.namespace },
            { key: "IMAGE_TAG", value: image.tag },
            { key: "IMAGE_REF", value: image.imageRef },
            { key: "DOCKERFILE_PATH", value: image.dockerfilePath },
            { key: "BUILD_CONTEXT", value: image.contextPath },
            { key: "BUILD_RUNTIME", value: buildConfig.runtime ?? "node" },
            { key: "REGISTRY_SERVICE_CONNECTION", value: image.serviceConnection },
            { key: "REGISTRY_USERNAME", value: image.registryUsername ?? "" },
            { key: "REGISTRY_DOCKER_SECRET", value: image.dockerConfigSecret ?? "" },
            { key: "PACKAGE_BUILD_SCRIPT", value: buildConfig.packageBuildScript },
            { key: "PACKAGE_OUTPUT_PATHS", value: buildConfig.packageOutputPaths.join(",") },
        ];
        const source = {
            id: run.repositoryId,
            type: providerFromUrl(run.repository),
            endpoint: run.repository,
            branch: run.refType === "branch" ? run.refName : run.branch,
            tag: run.refType === "tag" ? run.refName : run.tag,
            cloneDepth: 1,
        };
        return {
            pipelineRunId: run.id,
            pipelineName: run.pipelineName,
            applicationId: run.applicationId,
            environment: run.environment,
            stages: run.stages.map((stage) => stage.key),
            sources: [source],
            globalParams: variables,
            canaryPercent: run.canaryPercent,
            requiresApproval: run.definitionSnapshot.requiresApproval,
        };
    }
    toStageStatus(stageKey, status, requiresApproval) {
        if (status === "RUNNING")
            return "running";
        if (status === "SUCCESS")
            return "success";
        if (status === "FAIL")
            return "failed";
        if (status === "SKIPPED")
            return "skipped";
        if (status === "CANCELED")
            return "skipped";
        if (status === "QUEUED" && stageKey === "approval" && requiresApproval)
            return "waiting";
        return "pending";
    }
    syncRunningStage(stage, run, executorStage, status) {
        if (stage.status !== "running") {
            this.startStage(stage, run);
        }
        const job = executorStage.jobs[0];
        stage.startedAt = job?.startedAt || stage.startedAt || status.startedAt;
        stage.metadata = {
            ...stage.metadata,
            executorStatus: executorStage.status,
            taskRef: job?.taskRef ?? stage.metadata.taskRef ?? stage.key,
        };
    }
    syncFinishedStage(stage, run, executorStage, status) {
        const job = executorStage.jobs[0];
        const now = new Date().toISOString();
        const finishedAt = job?.finishedAt || stage.finishedAt || now;
        const durationMs = job?.durationMs || stage.durationMs || stage_templates_1.STAGE_DURATIONS[stage.key];
        const jobResult = job?.result ?? {};
        const imageDigest = firstNonEmpty(jobResult["image-digest"], jobResult["IMAGE_DIGEST"], jobResult["digest"]);
        const imageRef = firstNonEmpty(jobResult["image-ref"], jobResult["imageRef"], jobResult["IMAGE_REF"]);
        const dockerPullCommand = firstNonEmpty(jobResult["docker-pull"], jobResult["DOCKER_PULL"]);
        const packagePath = firstNonEmpty(jobResult["package-path"], jobResult["PACKAGE_PATH"]);
        const packageDigest = firstNonEmpty(jobResult["package-digest"], jobResult["PACKAGE_DIGEST"]);
        const executorError = firstNonEmpty(jobResult["error"], jobResult["ERROR"]);
        const startedAt = job?.startedAt ||
            stage.startedAt ||
            new Date(new Date(finishedAt).getTime() - durationMs).toISOString();
        stage.status = status;
        stage.startedAt = startedAt;
        stage.finishedAt = finishedAt;
        stage.durationMs = durationMs;
        stage.logs = [
            ...(0, stage_templates_1.buildStageLogs)(stage.key, run, status),
            ...(executorError ? [`执行器错误: ${truncateLogValue(executorError)}`] : []),
        ];
        stage.metadata = {
            ...stage.metadata,
            durationMs,
            status,
            executorStatus: executorStage.status,
            taskRef: job?.taskRef ?? stage.metadata.taskRef ?? stage.key,
            resultKeys: Object.keys(jobResult).join(","),
            ...(imageDigest ? { imageDigest } : {}),
            ...(imageRef ? { imageRef } : {}),
            ...(dockerPullCommand ? { dockerPullCommand } : {}),
            ...(packagePath ? { packagePath } : {}),
            ...(packageDigest ? { packageDigest } : {}),
            ...(executorError ? { executorError: truncateLogValue(executorError) } : {}),
        };
    }
    finishStage(stage, status, run, extraLogs = []) {
        const now = new Date();
        const startedAt = new Date(now.getTime() - stage_templates_1.STAGE_DURATIONS[stage.key]);
        stage.status = status;
        stage.startedAt = startedAt.toISOString();
        stage.finishedAt = now.toISOString();
        stage.durationMs = stage_templates_1.STAGE_DURATIONS[stage.key];
        stage.logs = [...(0, stage_templates_1.buildStageLogs)(stage.key, run, status), ...extraLogs];
        stage.metadata = {
            ...stage.metadata,
            durationMs: stage.durationMs,
            status,
        };
        run.progress = this.calculateProgress(run);
        run.updatedAt = now.toISOString();
    }
    calculateProgress(run) {
        const weighted = run.stages.reduce((score, stage) => {
            if (stage.status === "success" || stage.status === "skipped")
                return score + 1;
            if (stage.status === "failed")
                return score + 0.85;
            if (stage.status === "waiting")
                return score + 0.65;
            if (stage.status === "running")
                return score + 0.45;
            return score;
        }, 0);
        return Math.round((weighted / run.stages.length) * 100);
    }
    buildRunningLogs(stage, run) {
        const [firstLine] = (0, stage_templates_1.buildStageLogs)(stage.key, run, "success");
        return [`${stage.title} 已进入执行队列，正在申请运行资源。`, firstLine].filter(Boolean);
    }
};
exports.LifecycleEngine = LifecycleEngine;
exports.LifecycleEngine = LifecycleEngine = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(executor_adapter_1.EXECUTOR_ADAPTER)),
    __metadata("design:paramtypes", [Object])
], LifecycleEngine);
function providerFromUrl(value) {
    const url = value.toLowerCase();
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
const firstNonEmpty = (...values) => values.find((value) => Boolean(value?.trim()))?.trim();
const truncateLogValue = (value) => (value.length > 4_000 ? `${value.slice(0, 4_000)}...` : value);
//# sourceMappingURL=lifecycle.engine.js.map