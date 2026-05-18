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
exports.SnapshotService = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@deploy-management/shared");
const applications_service_1 = require("../applications/applications.service");
const approvals_service_1 = require("../approvals/approvals.service");
const artifacts_service_1 = require("../artifacts/artifacts.service");
const audit_service_1 = require("../audit/audit.service");
const code_repos_service_1 = require("../code-repos/code-repos.service");
const environments_service_1 = require("../environments/environments.service");
const pipelines_service_1 = require("../pipelines/pipelines.service");
const releases_service_1 = require("../releases/releases.service");
const runners_service_1 = require("../runners/runners.service");
const runs_service_1 = require("../runs/runs.service");
let SnapshotService = class SnapshotService {
    applications;
    approvals;
    artifacts;
    audit;
    codeRepos;
    environments;
    pipelines;
    releases;
    runners;
    runs;
    constructor(applications, approvals, artifacts, audit, codeRepos, environments, pipelines, releases, runners, runs) {
        this.applications = applications;
        this.approvals = approvals;
        this.artifacts = artifacts;
        this.audit = audit;
        this.codeRepos = codeRepos;
        this.environments = environments;
        this.pipelines = pipelines;
        this.releases = releases;
        this.runners = runners;
        this.runs = runs;
    }
    build() {
        const runs = this.runs.list();
        const successRuns = runs.filter((run) => run.status === "success").length;
        const finishedRuns = runs.filter((run) => ["success", "failed", "canceled"].includes(run.status)).length || 1;
        const overview = {
            applications: this.applications.list().length,
            pipelines: this.pipelines.list().length,
            runningRuns: runs.filter((run) => run.status === "running").length,
            waitingApprovals: this.approvals.list().filter((approval) => approval.status === "pending").length,
            successRate: Math.round((successRuns / finishedRuns) * 1000) / 10,
            activeEnvironments: this.environments.list().filter((environment) => environment.activeRuns > 0).length,
        };
        return {
            overview,
            applications: this.applications.list(),
            repositories: this.codeRepos.list(),
            pipelines: this.pipelines.list(),
            runs,
            approvals: this.approvals.list(),
            environments: this.environments.list(),
            runnerPools: this.runners.list(),
            artifacts: this.artifacts.list(),
            releases: this.releases.list(),
            deploymentTargets: this.environments.listDeploymentTargets(),
            releasePlans: this.releases.listReleasePlans(),
            releaseExecutions: this.releases.listReleaseExecutions(),
            releaseEvents: this.releases.listReleaseEvents(),
            environmentLocks: this.environments.listEnvironmentLocks(),
            auditEvents: this.audit.list(),
            tekton: buildTektonSnapshot(runs, this.pipelines.list()),
        };
    }
};
exports.SnapshotService = SnapshotService;
exports.SnapshotService = SnapshotService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(applications_service_1.ApplicationsService)),
    __param(1, (0, common_1.Inject)(approvals_service_1.ApprovalsService)),
    __param(2, (0, common_1.Inject)(artifacts_service_1.ArtifactsService)),
    __param(3, (0, common_1.Inject)(audit_service_1.AuditService)),
    __param(4, (0, common_1.Inject)(code_repos_service_1.CodeReposService)),
    __param(5, (0, common_1.Inject)(environments_service_1.EnvironmentsService)),
    __param(6, (0, common_1.Inject)(pipelines_service_1.PipelinesService)),
    __param(7, (0, common_1.Inject)(releases_service_1.ReleasesService)),
    __param(8, (0, common_1.Inject)(runners_service_1.RunnersService)),
    __param(9, (0, common_1.Inject)(runs_service_1.RunsService)),
    __metadata("design:paramtypes", [applications_service_1.ApplicationsService,
        approvals_service_1.ApprovalsService,
        artifacts_service_1.ArtifactsService,
        audit_service_1.AuditService,
        code_repos_service_1.CodeReposService,
        environments_service_1.EnvironmentsService,
        pipelines_service_1.PipelinesService,
        releases_service_1.ReleasesService,
        runners_service_1.RunnersService,
        runs_service_1.RunsService])
], SnapshotService);
const componentDescriptions = {
    Pipelines: "Task、TaskRun、Pipeline、PipelineRun 控制器",
    Triggers: "EventListener、TriggerBinding、TriggerTemplate 事件入口",
    Results: "PipelineRun/TaskRun 长期历史、日志与 Record 查询",
    Chains: "SLSA provenance、in-toto attestations 与镜像签名",
    Dashboard: "Tekton 原生观测面，用于排障与 CRD 详情",
    Operator: "TektonConfig 统一安装、升级和组件治理",
    Hub: "可复用 Task/Pipeline Catalog 与远程解析",
};
function buildTektonSnapshot(runs, pipelines) {
    const bindings = pipelines.map((pipeline) => buildTektonBinding(pipeline));
    return {
        operator: {
            tektonConfigName: "tekton-config-yunxiao",
            status: "ready",
            profile: "all",
            targetNamespace: "tekton-pipelines",
        },
        cluster: {
            context: "ack-prod-shanghai / tekton-system",
            executorMode: runs.find((run) => run.executor)?.executor?.backend ?? executorModeFromEnv(),
            namespaces: ["tekton-pipelines", "tekton-triggers", "tekton-results", "tekton-chains"],
            pipelineRefConfigured: Boolean(process.env.TEKTON_PIPELINE_REF),
            sourcePvcConfigured: Boolean(process.env.TEKTON_SOURCE_PVC),
            dockerSecretFallbackConfigured: Boolean(process.env.TEKTON_DOCKER_SECRET),
            localRegistryPasswordConfigured: hasLocalRegistryPassword(),
            simulatedFallbackEnabled: process.env.TEKTON_ALLOW_SIMULATED_FALLBACK === "true",
        },
        components: [
            component("Operator", "tekton-operator", "v0.77.0", 1, 1),
            component("Pipelines", "tekton-pipelines", "v1.3.0", 2, 2),
            component("Triggers", "tekton-triggers", "v0.33.0", 2, 2),
            component("Results", "tekton-results", "v0.15.0", 2, 2),
            component("Chains", "tekton-chains", "v0.24.0", 1, 1),
            component("Dashboard", "tekton-pipelines", "v0.57.0", 1, 1),
            component("Hub", "tekton-hub", "v1.20.0", 1, 1),
        ],
        bindings,
        runRecords: runs.map((run) => buildTektonRunRecord(run, bindings)),
    };
}
function executorModeFromEnv() {
    if (process.env.EXECUTOR === "tekton")
        return "tekton";
    if (process.env.EXECUTOR === "local-docker")
        return "local-docker";
    return "simulated";
}
function hasLocalRegistryPassword() {
    return Boolean(process.env.ACR_PASSWORD || process.env.ALIYUN_ACR_PASSWORD || process.env.REGISTRY_PASSWORD || process.env.DOCKER_PASSWORD);
}
function component(name, namespace, version, readyReplicas, desiredReplicas) {
    return {
        name,
        namespace,
        version,
        readyReplicas,
        desiredReplicas,
        status: readyReplicas >= desiredReplicas ? "ready" : "degraded",
        description: componentDescriptions[name],
    };
}
function buildTektonBinding(pipeline) {
    const namespace = pipeline.targetEnvironment === "prod" ? "apps-prod" : `apps-${pipeline.targetEnvironment}`;
    const pipelineName = sanitizeKubernetesName(pipeline.name);
    const resolver = pipeline.triggers.includes("yaml") ? "git" : "cluster";
    const sourcePolicy = pipeline.sourcePolicy ?? {
        allowedBranchPatterns: [pipeline.defaultBranch],
        allowedTagPatterns: ["v*", "release-*"],
        allowRuntimeBranch: true,
        allowRuntimeTag: true,
        allowRuntimeCommit: true,
    };
    const pipelineVariables = pipeline.variables?.length ? pipeline.variables : defaultPipelineVariables(pipeline);
    const image = (0, shared_1.resolveImageArtifact)(pipeline);
    const buildConfig = pipeline.buildConfig ?? shared_1.DEFAULT_PIPELINE_BUILD_CONFIG;
    const params = [
        { key: "git-url", value: pipeline.repository },
        { key: "revision", value: pipeline.defaultRef },
        { key: "ref-type", value: pipeline.defaultRefType },
        { key: "branch-allowlist", value: sourcePolicy.allowedBranchPatterns.join(",") },
        { key: "tag-allowlist", value: sourcePolicy.allowedTagPatterns.join(",") },
        { key: "target-env", value: pipeline.targetEnvironment },
        { key: "canary-percent", value: String(pipeline.canaryPercent) },
        { key: "REGISTRY_PROVIDER", value: image.registryProvider ?? "custom", injectionTiming: "build", targetStages: ["build", "upload"] },
        { key: "IMAGE_REGISTRY", value: image.registryUrl, injectionTiming: "build", targetStages: ["build", "upload"] },
        { key: "IMAGE_REPOSITORY", value: image.repository, injectionTiming: "build", targetStages: ["build", "upload"] },
        { key: "IMAGE_REF", value: image.imageRef, injectionTiming: "build", targetStages: ["build", "upload", "deploy"] },
        { key: "DOCKERFILE_PATH", value: image.dockerfilePath, injectionTiming: "build", targetStages: ["build", "upload"] },
        { key: "BUILD_CONTEXT", value: image.contextPath, injectionTiming: "build", targetStages: ["build", "upload"] },
        { key: "BUILD_RUNTIME", value: buildConfig.runtime ?? "node", injectionTiming: "build", targetStages: ["test", "build"] },
        { key: "PACKAGE_BUILD_SCRIPT", value: buildConfig.packageBuildScript, injectionTiming: "build", targetStages: ["build"] },
        { key: "PACKAGE_OUTPUT_PATHS", value: buildConfig.packageOutputPaths.join(","), injectionTiming: "build", targetStages: ["build"] },
        { key: "REGISTRY_SERVICE_CONNECTION", value: image.serviceConnection, injectionTiming: "build", targetStages: ["upload"] },
        { key: "REGISTRY_USERNAME", value: image.registryUsername ?? "", injectionTiming: "build", targetStages: ["upload"] },
        { key: "REGISTRY_DOCKER_SECRET", value: image.dockerConfigSecret ?? "", injectionTiming: "build", targetStages: ["upload"] },
        ...pipelineVariables.map((param) => withParamInjectionDefaults(param)),
        ...(pipeline.runtimeVariables ?? []).map((param) => withParamInjectionDefaults({ ...param, key: `runtime.${param.key}`, injectionTiming: "runtime" })),
    ];
    const workspaceBindings = buildWorkspaceBindings(pipeline, pipelineName);
    return {
        pipelineId: pipeline.id,
        namespace,
        pipelineName,
        serviceAccountName: pipeline.targetEnvironment === "prod" ? "tekton-deployer-prod" : "tekton-builder",
        resolver,
        resolverRef: buildResolverRef(pipeline, pipelineName, resolver),
        workspaces: workspaceBindings.map((workspace) => workspace.name),
        workspaceBindings,
        params,
        taskGraph: buildTaskGraph(pipeline, params, workspaceBindings),
        trigger: {
            eventListener: `${pipelineName}-el`,
            trigger: `${pipelineName}-trigger`,
            triggerBinding: `${pipelineName}-binding`,
            triggerTemplate: `${pipelineName}-template`,
            route: `https://devops.example.com/hooks/${pipeline.id}`,
            interceptors: ["github/gitlab signature", "cel branch filter", "dedupe revision"],
        },
        results: {
            resultName: `${pipelineName}-result`,
            records: pipeline.targetEnvironment === "prod" ? 128 : 54,
            retentionDays: pipeline.targetEnvironment === "prod" ? 180 : 45,
        },
        chains: {
            format: "slsa/v1",
            storage: ["tekton", `oci://${(0, shared_1.resolveImageArtifact)(pipeline).repository}`],
            signedArtifacts: pipeline.requiresApproval ? 6 : 3,
        },
    };
}
function buildTektonRunRecord(run, bindings) {
    const binding = bindings.find((item) => item.pipelineId === run.pipelineId);
    const namespace = binding?.namespace ?? `apps-${run.environment}`;
    const pipelineRunName = `${sanitizeKubernetesName(run.pipelineName)}-${run.id.replace("run-", "")}`;
    const status = (0, shared_1.toYunxiaoRunStatus)(run.status);
    const condition = conditionForStatus(status);
    const workspaceBindings = binding?.workspaceBindings ?? buildWorkspaceBindings(run.definitionSnapshot, sanitizeKubernetesName(run.pipelineName));
    const params = buildRunParams(run, binding);
    const taskRuns = run.stages.map((stage) => ({
        taskRunName: `${pipelineRunName}-${stage.key}`,
        pipelineTaskName: stage.key,
        taskRef: String(stage.metadata.adapter ?? stage.key),
        status: (0, shared_1.toYunxiaoJobStatus)(stage.status),
        podName: `${pipelineRunName}-${stage.key}-pod`,
        retries: stage.status === "failed" ? 1 : 0,
        workspaces: stageWorkspaces[stage.key] ?? ["source-ws"],
        steps: buildStepsForStage(stage.key, stage.logs, (0, shared_1.toYunxiaoJobStatus)(stage.status)),
        results: buildTaskRunResults(stage.key, run, (0, shared_1.toYunxiaoJobStatus)(stage.status)),
        startedAt: stage.startedAt,
        finishedAt: stage.finishedAt,
    }));
    const events = buildRunEvents(run, pipelineRunName, condition);
    const results = buildRunResults(run, pipelineRunName, taskRuns, events);
    return {
        runId: run.id,
        namespace,
        pipelineRunName,
        executorBackend: run.executor?.backend,
        status,
        conditionReason: condition.reason,
        conditionMessage: condition.message,
        childReferences: taskRuns.map((taskRun) => ({
            name: taskRun.taskRunName,
            kind: "TaskRun",
            pipelineTaskName: taskRun.pipelineTaskName,
        })),
        taskRuns,
        params,
        workspaceBindings,
        results,
        events,
        pipelineSpecRef: binding?.resolverRef,
        resultRecordName: `${pipelineRunName}-record`,
        logsUrl: `tekton-results://${namespace}/${pipelineRunName}`,
        chainsAttestation: run.status === "failed"
            ? undefined
            : {
                name: `${pipelineRunName}.intoto.jsonl`,
                format: "slsa/v1",
                storage: `oci://${(0, shared_1.resolveImageArtifact)(run.definitionSnapshot, run).repository}/provenance`,
                signed: run.status === "success",
                digest: `sha256:${run.commit}${run.id.replace("run-", "")}`,
            },
    };
}
function buildResolverRef(pipeline, pipelineName, resolver) {
    if (resolver === "git") {
        return {
            resolver,
            resourceKind: "Pipeline",
            name: pipelineName,
            source: pipeline.repository,
            revision: pipeline.defaultRef,
            params: [
                { key: "url", value: pipeline.repository },
                { key: "revision", value: pipeline.defaultRef },
                { key: "pathInRepo", value: `.tekton/pipelines/${pipelineName}.yaml` },
            ],
        };
    }
    return {
        resolver,
        resourceKind: "Pipeline",
        name: pipelineName,
        source: "cluster://tekton-pipelines",
        revision: "installed",
        params: [
            { key: "name", value: pipelineName },
            { key: "kind", value: "Pipeline" },
            { key: "namespace", value: pipeline.targetEnvironment === "prod" ? "apps-prod" : `apps-${pipeline.targetEnvironment}` },
        ],
    };
}
function buildWorkspaceBindings(pipeline, pipelineName) {
    const cacheEnabled = pipeline.caches?.some((cache) => cache.enabled) ?? true;
    const image = (0, shared_1.resolveImageArtifact)(pipeline);
    return [
        {
            name: "source-ws",
            type: "persistentVolumeClaim",
            mountPath: "/workspace/source",
            claimName: `${pipelineName}-source-pvc`,
            subPath: "$(context.pipelineRun.name)",
            description: "代码、构建上下文和阶段间共享输出。",
        },
        ...(cacheEnabled
            ? [{
                    name: "cache-ws",
                    type: "persistentVolumeClaim",
                    mountPath: "/workspace/cache",
                    claimName: `${pipelineName}-cache-pvc`,
                    optional: true,
                    description: "依赖缓存与构建缓存，可在 PipelineRun 之间复用。",
                }]
            : []),
        {
            name: "docker-config",
            type: "secret",
            mountPath: "/tekton/home/.docker",
            secretName: image.dockerConfigSecret || `${sanitizeKubernetesName(image.serviceConnection)}-secret`,
            readOnly: true,
            description: "镜像仓库凭据，仅暴露给构建和上传任务。",
        },
        {
            name: "kubeconfig",
            type: "secret",
            mountPath: "/tekton/home/.kube",
            secretName: pipeline.targetEnvironment === "prod" ? "ack-prod-kubeconfig" : "ack-nonprod-kubeconfig",
            readOnly: true,
            description: "部署集群凭据，仅部署/灰度/全量发布任务读取。",
        },
    ];
}
function withParamInjectionDefaults(param) {
    const injectionTiming = param.injectionTiming ?? defaultInjectionTiming(param.key);
    return {
        ...param,
        injectionTiming,
        targetStages: param.targetStages ?? defaultTargetStages(param.key, injectionTiming),
    };
}
function defaultPipelineVariables(pipeline) {
    return [
        {
            key: "NODE_ENV",
            value: pipeline.targetEnvironment,
            description: "构建时注入，决定测试和构建产物的目标环境。",
            injectionTiming: "build",
            targetStages: ["test", "build", "package"],
        },
        {
            key: "IMAGE_TAG",
            value: "${run.id}-${commit.short}",
            description: "构建时注入，用于镜像与制品版本追踪。",
            injectionTiming: "build",
            targetStages: ["build", "upload", "deploy"],
        },
        {
            key: "DEPLOY_NAMESPACE",
            value: `${pipeline.applicationId}-${pipeline.targetEnvironment}`,
            description: "部署时注入，渲染 Kubernetes manifest 与发布策略。",
            injectionTiming: "deploy",
            targetStages: ["deploy", "canary", "promote"],
        },
    ];
}
function paramAppliesToStage(param, stage) {
    if (param.targetStages?.includes(stage))
        return true;
    const stageKeys = stageParamKeys[stage] ?? ["git-url", "revision", "target-env"];
    return stageKeys.includes(param.key);
}
function buildTaskGraph(pipeline, params, workspaces) {
    return pipeline.stages.map((stage, index) => ({
        name: stage,
        taskRef: `${stage}-task`,
        runAfter: index === 0 ? [] : [pipeline.stages[index - 1]],
        workspaces: (stageWorkspaces[stage] ?? ["source-ws"]).filter((name) => workspaces.some((workspace) => workspace.name === name)),
        params: params.filter((param) => paramAppliesToStage(param, stage)),
        retries: stage === "upload" || stage === "deploy" ? 1 : 0,
        timeoutSeconds: stageTimeoutSeconds[stage],
        when: stage === "approval"
            ? [{ input: "$(params.target-env)", operator: "in", values: ["prod"] }]
            : undefined,
    }));
}
function buildRunParams(run, binding) {
    const image = (0, shared_1.resolveImageArtifact)(run.definitionSnapshot, run);
    const buildConfig = run.definitionSnapshot.buildConfig ?? shared_1.DEFAULT_PIPELINE_BUILD_CONFIG;
    return [
        { key: "git-url", value: run.repository },
        { key: "revision", value: run.refName },
        { key: "resolved-commit", value: run.commit },
        { key: "ref-type", value: run.refType },
        { key: "target-env", value: run.environment },
        { key: "canary-percent", value: String(run.canaryPercent) },
        { key: "REGISTRY_PROVIDER", value: image.registryProvider ?? "custom" },
        { key: "IMAGE_REGISTRY", value: image.registryUrl },
        { key: "IMAGE_REPOSITORY", value: image.repository },
        { key: "IMAGE_TAG", value: image.tag },
        { key: "IMAGE_REF", value: image.imageRef },
        { key: "DOCKERFILE_PATH", value: image.dockerfilePath },
        { key: "BUILD_CONTEXT", value: image.contextPath },
        { key: "BUILD_RUNTIME", value: buildConfig.runtime ?? "node" },
        { key: "PACKAGE_BUILD_SCRIPT", value: buildConfig.packageBuildScript },
        { key: "PACKAGE_OUTPUT_PATHS", value: buildConfig.packageOutputPaths.join(",") },
        { key: "REGISTRY_SERVICE_CONNECTION", value: image.serviceConnection },
        { key: "REGISTRY_USERNAME", value: image.registryUsername ?? "" },
        { key: "REGISTRY_DOCKER_SECRET", value: image.dockerConfigSecret ?? "" },
        ...(binding?.params.filter((param) => param.key.startsWith("runtime.") || Boolean(param.injectionTiming)) ?? []),
    ];
}
function buildTaskRunResults(stage, run, status) {
    if (status === "INIT")
        return {};
    const image = (0, shared_1.resolveImageArtifact)(run.definitionSnapshot, run);
    const variableNamesByTiming = (timing) => (run.definitionSnapshot.variables ?? [])
        .filter((param) => (param.injectionTiming ?? defaultInjectionTiming(param.key)) === timing)
        .map((param) => param.key)
        .join(",") || "none";
    const values = {
        source: {
            commit: run.commit,
            url: run.repository,
            revision: `${run.refType}/${run.refName}`,
        },
        test: {
            report: `tekton-results://${run.id}/junit.xml`,
            qualityGate: status === "SUCCESS" ? "passed" : "blocked",
        },
        build: {
            image: image.imageRef,
            imageRepository: image.repository,
            buildDigest: `sha256:${run.commit}${run.id.replace("run-", "")}`,
            buildTimeEnv: variableNamesByTiming("build"),
        },
        env: {
            envFile: `/workspace/source/.deploy/${run.environment}.env`,
            configHash: `cfg-${run.commit.slice(0, 7)}`,
            buildTimeVariables: variableNamesByTiming("build"),
            runtimeVariables: variableNamesByTiming("runtime"),
            deployTimeVariables: variableNamesByTiming("deploy"),
        },
        package: {
            sbom: `${run.id}-sbom.spdx.json`,
            provenanceMaterial: `${run.id}-materials.json`,
        },
        upload: {
            imageUrl: image.imageRef,
            registryUrl: image.registryUrl,
            serviceConnection: image.serviceConnection,
            registryDigest: imageDigestResult(run) ?? "waiting-for-task-result",
        },
        deploy: {
            release: `${run.applicationName}-${run.environment}`,
            namespace: `${run.applicationName}-${run.environment}`,
            runtimeEnv: variableNamesByTiming("runtime"),
        },
        canary: {
            trafficPercent: `${run.canaryPercent}%`,
            slo: "latency-p95<300ms,error-rate<1%",
        },
        approval: {
            gate: run.status === "waiting_approval" ? "pending" : status.toLowerCase(),
            approvers: "owner,sre",
        },
        promote: {
            trafficPercent: status === "SUCCESS" ? "100%" : "0%",
            releaseStatus: status === "SUCCESS" ? "stable" : "pending",
        },
    };
    return values[stage];
}
function buildRunResults(run, pipelineRunName, taskRuns, events) {
    const storedAt = run.updatedAt;
    const successfulTaskRuns = taskRuns.filter((taskRun) => taskRun.status === "SUCCESS").length;
    return [
        {
            name: `${pipelineRunName}-pipelinerun`,
            recordType: "PipelineRun",
            value: run.status,
            storedAt,
            summary: `${run.pipelineName} ${run.status} at ${run.progress}%`,
        },
        {
            name: `${pipelineRunName}-source-event`,
            recordType: "SourceEvent",
            value: `${run.refType}/${run.refName}@${run.commit}`,
            storedAt,
            summary: "触发事件、代码 revision 与解析结果被归档。",
        },
        {
            name: `${pipelineRunName}-taskruns`,
            recordType: "TaskRun",
            value: `${successfulTaskRuns}/${taskRuns.length}`,
            storedAt,
            summary: "TaskRun 子对象与状态被聚合进同一个 Result。",
        },
        {
            name: `${pipelineRunName}-logs`,
            recordType: "Log",
            value: `tekton-results://${pipelineRunName}`,
            storedAt,
            summary: `${events.length} 条事件与阶段日志可长期查询。`,
        },
        ...(hasRealImageResult(run)
            ? [{
                    name: `${pipelineRunName}-artifact`,
                    recordType: "Artifact",
                    value: (0, shared_1.resolveImageArtifact)(run.definitionSnapshot, run).imageRef,
                    storedAt,
                    summary: "真实镜像 digest 已由 TaskRun result 回写并关联到本次运行。",
                }]
            : []),
    ];
}
function hasRealImageResult(run) {
    return Boolean(imageDigestResult(run));
}
function imageDigestResult(run) {
    const value = run.stages.find((stage) => stage.key === "upload")?.metadata.imageDigest;
    const realBackend = run.executor?.backend === "tekton" || run.executor?.backend === "local-docker";
    return realBackend && typeof value === "string" && value.startsWith("sha256:") ? value : undefined;
}
function buildRunEvents(run, pipelineRunName, condition) {
    const events = [
        {
            type: "Normal",
            reason: "PipelineRunCreated",
            message: `Created PipelineRun ${pipelineRunName}`,
            timestamp: run.createdAt,
            involvedObject: pipelineRunName,
        },
    ];
    run.stages.forEach((stage) => {
        if (!stage.startedAt)
            return;
        const objectName = `${pipelineRunName}-${stage.key}`;
        events.push({
            type: stage.status === "failed" ? "Warning" : "Normal",
            reason: stage.status === "running" ? "Started" : stage.status === "waiting" ? "Waiting" : (0, shared_1.toYunxiaoJobStatus)(stage.status),
            message: `${stage.title} ${stage.status}`,
            timestamp: stage.finishedAt ?? stage.startedAt,
            involvedObject: objectName,
        });
    });
    events.push({
        type: run.status === "failed" ? "Warning" : "Normal",
        reason: condition.reason,
        message: condition.message,
        timestamp: run.updatedAt,
        involvedObject: pipelineRunName,
    });
    return events.slice(-8);
}
function buildStepsForStage(stageKey, logs, status) {
    const stepNames = stageStepNames[stageKey] ?? ["run"];
    return stepNames.map((name, index) => ({
        id: `${stageKey}-step-${index}`,
        name,
        image: stageImages[stageKey] ?? "build-steps/alinux3",
        status,
        command: ["/bin/sh", "-c"],
        logsRef: logs[index] ? `line:${index}` : undefined,
    }));
}
function conditionForStatus(status) {
    if (status === "SUCCESS")
        return { reason: "Succeeded", message: "Tasks Completed: all tasks succeeded" };
    if (status === "FAIL")
        return { reason: "Failed", message: "Tasks Completed: failed task blocks downstream tasks" };
    if (status === "CANCELED")
        return { reason: "Cancelled", message: "PipelineRun was cancelled by user" };
    if (status === "QUEUED")
        return { reason: "Pending", message: "PipelineRun is waiting for approval or runner capacity" };
    return { reason: "Started", message: "PipelineRun has been picked up by the controller" };
}
function sanitizeKubernetesName(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 52);
}
const stageStepNames = {
    source: ["resolve-revision", "clone", "checkout"],
    test: ["install", "unit-test", "sast"],
    build: ["install", "package-script", "archive"],
    env: ["merge-vars", "project-secrets", "write-env"],
    package: ["sbom", "provenance-material"],
    upload: ["docker-build", "docker-push", "write-digest"],
    deploy: ["render-manifest", "kubectl-apply"],
    canary: ["route-traffic", "observe-slo"],
    approval: ["wait-approval"],
    promote: ["promote-stable", "record-release"],
};
const stageImages = {
    source: "alpine/git:2.45",
    test: "node:20-alpine",
    build: "node:20-alpine",
    env: "build-steps/alinux3",
    package: "anchore/syft:v1.4.1",
    upload: "docker:27-cli",
    deploy: "bitnami/kubectl:1.30",
    canary: "istio/istioctl:1.22",
    approval: "busybox:1.36",
    promote: "bitnami/kubectl:1.30",
};
const stageWorkspaces = {
    source: ["source-ws"],
    test: ["source-ws", "cache-ws"],
    build: ["source-ws", "cache-ws", "docker-config"],
    env: ["source-ws"],
    package: ["source-ws"],
    upload: ["source-ws", "docker-config"],
    deploy: ["source-ws", "kubeconfig"],
    canary: ["kubeconfig"],
    approval: [],
    promote: ["kubeconfig"],
};
const stageParamKeys = {
    source: ["git-url", "revision", "ref-type", "branch-allowlist", "tag-allowlist"],
    test: ["NODE_ENV", "runtime.RELEASE_NOTE"],
    build: ["NODE_ENV", "BUILD_RUNTIME", "PACKAGE_BUILD_SCRIPT", "PACKAGE_OUTPUT_PATHS", "REGISTRY_PROVIDER", "IMAGE_TAG", "IMAGE_REPOSITORY", "IMAGE_REF", "DOCKERFILE_PATH", "BUILD_CONTEXT"],
    env: ["target-env", "NODE_ENV", "runtime.RELEASE_NOTE"],
    package: ["IMAGE_TAG", "NODE_ENV"],
    upload: ["REGISTRY_PROVIDER", "IMAGE_TAG", "IMAGE_REGISTRY", "IMAGE_REPOSITORY", "IMAGE_REF", "DOCKERFILE_PATH", "BUILD_CONTEXT", "REGISTRY_SERVICE_CONNECTION", "REGISTRY_USERNAME", "REGISTRY_DOCKER_SECRET"],
    deploy: ["target-env", "canary-percent", "DEPLOY_NAMESPACE"],
    canary: ["target-env", "canary-percent"],
    promote: ["target-env", "DEPLOY_NAMESPACE", "runtime.RELEASE_NOTE"],
};
function defaultInjectionTiming(key) {
    if (key === "NODE_ENV" || key === "IMAGE_TAG" || isPublicSupabaseBuildKey(key))
        return "build";
    if (key === "DEPLOY_NAMESPACE" || isPrivateSupabaseRuntimeKey(key))
        return "deploy";
    return key.startsWith("runtime.") ? "runtime" : "runtime";
}
function defaultTargetStages(key, injectionTiming) {
    if (key === "NODE_ENV")
        return ["test", "build", "package"];
    if (key === "IMAGE_TAG")
        return ["build", "upload", "deploy"];
    if (isPublicSupabaseBuildKey(key))
        return ["test", "build", "package"];
    if (isPrivateSupabaseRuntimeKey(key))
        return ["deploy", "canary", "promote"];
    if (key.startsWith("IMAGE_") || key === "DOCKERFILE_PATH" || key === "BUILD_CONTEXT" || key.startsWith("REGISTRY_")) {
        return ["build", "upload", "deploy"];
    }
    if (key === "DEPLOY_NAMESPACE")
        return ["deploy", "canary", "promote"];
    if (key.startsWith("runtime."))
        return ["deploy", "canary", "approval", "promote"];
    if (injectionTiming === "build")
        return ["test", "build", "package"];
    if (injectionTiming === "deploy")
        return ["deploy", "canary", "promote"];
    return ["deploy", "canary", "approval", "promote"];
}
function isPublicSupabaseBuildKey(key) {
    return [
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ].includes(key);
}
function isPrivateSupabaseRuntimeKey(key) {
    return ["SUPABASE_DB_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"].includes(key);
}
const stageTimeoutSeconds = {
    source: 300,
    test: 900,
    build: 1_200,
    env: 180,
    package: 300,
    upload: 600,
    deploy: 900,
    canary: 1_800,
    approval: 86_400,
    promote: 900,
};
//# sourceMappingURL=snapshot.service.js.map