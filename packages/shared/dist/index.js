"use strict";
// ============================================================================
// 部署管理平台共享领域模型
//
// 本文件聚合三层概念：
//   1. 平台产品模型 (Application / Pipeline / Run / Approval / Environment)
//   2. 云效 (Aliyun Yunxiao Flow) OpenAPI 对齐 (PipelineRunInstance / Stage / Job
//      / TriggerMode / GlobalParam / PipelineSource)
//   3. Tekton 工作流模型 (Task / Step / Param / Result / Workspace / When)
//
// 旧字段保留以保持向后兼容；新字段并行存在，前后端逐步迁移。
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.toPipelineRunInstance = exports.toYunxiaoRunStatus = exports.toYunxiaoJobStatus = exports.getLifecycleStage = exports.LIFECYCLE_STAGES = void 0;
exports.LIFECYCLE_STAGES = [
    {
        key: "source",
        title: "拉取代码",
        description: "验签 webhook，解析 revision，clone 代码并生成 source snapshot。",
        adapter: "GitSourceAdapter",
        required: true,
    },
    {
        key: "test",
        title: "测试与扫描",
        description: "执行单元测试、类型检查、SAST 和质量门禁。",
        adapter: "QualityGateAdapter",
        required: true,
    },
    {
        key: "build",
        title: "打包构建",
        description: "根据应用类型执行 npm/maven/go build 或容器构建。",
        adapter: "BuildAdapter",
        required: true,
    },
    {
        key: "env",
        title: "注入环境变量",
        description: "合并流水线变量、运行变量和密钥引用，生成任务级环境注入清单。",
        adapter: "EnvInjectionAdapter",
        required: true,
    },
    {
        key: "package",
        title: "生成制品",
        description: "生成镜像、前端静态包、SBOM 和 provenance 原始材料。",
        adapter: "ArtifactPackager",
        required: true,
    },
    {
        key: "upload",
        title: "上传制品",
        description: "推送镜像仓库、对象存储或 OCI registry，并记录 digest。",
        adapter: "RegistryUploadAdapter",
        required: true,
    },
    {
        key: "deploy",
        title: "部署环境",
        description: "渲染 Helm/Kustomize manifest 并提交给执行集群。",
        adapter: "KubernetesDeployAdapter",
        required: true,
    },
    {
        key: "canary",
        title: "灰度发布",
        description: "按流量比例渐进发布，观察错误率和延迟。",
        adapter: "CanaryRolloutAdapter",
        required: true,
    },
    {
        key: "approval",
        title: "发布审批",
        description: "生产环境进入人工审批和变更窗口门禁。",
        adapter: "ApprovalGateAdapter",
        required: false,
    },
    {
        key: "promote",
        title: "全量发布",
        description: "审批通过后扩大流量，写入部署历史和审计事件。",
        adapter: "PromotionAdapter",
        required: true,
    },
];
const getLifecycleStage = (key) => {
    const stage = exports.LIFECYCLE_STAGES.find((item) => item.key === key);
    if (!stage) {
        throw new Error(`Unknown lifecycle stage: ${key}`);
    }
    return stage;
};
exports.getLifecycleStage = getLifecycleStage;
// ----------------------------------------------------------------------------
// 6. Yunxiao ↔ 平台模型映射工具
// ----------------------------------------------------------------------------
const STAGE_STATUS_TO_JOB = {
    pending: "INIT",
    running: "RUNNING",
    success: "SUCCESS",
    failed: "FAIL",
    waiting: "QUEUED",
    skipped: "SKIPPED",
};
const RUN_STATUS_TO_JOB = {
    queued: "QUEUED",
    running: "RUNNING",
    waiting_approval: "QUEUED",
    success: "SUCCESS",
    failed: "FAIL",
    canceled: "CANCELED",
};
const toYunxiaoJobStatus = (status) => STAGE_STATUS_TO_JOB[status];
exports.toYunxiaoJobStatus = toYunxiaoJobStatus;
const toYunxiaoRunStatus = (status) => RUN_STATUS_TO_JOB[status];
exports.toYunxiaoRunStatus = toYunxiaoRunStatus;
const toPipelineRunInstance = (run) => ({
    pipelineRunId: run.id,
    pipelineId: run.pipelineId,
    pipelineName: run.pipelineName,
    status: (0, exports.toYunxiaoRunStatus)(run.status),
    triggerMode: "manual",
    creatorAccountId: run.actor,
    createTime: run.createdAt,
    updateTime: run.updatedAt,
    sources: [
        {
            id: run.repositoryId,
            type: "codeup",
            endpoint: run.repository,
            branch: run.refType === "branch" ? run.refName : run.branch,
            tag: run.refType === "tag" ? run.refName : run.tag,
        },
    ],
    stages: run.stages.map((stage, index) => ({
        index,
        name: stage.title,
        status: (0, exports.toYunxiaoJobStatus)(stage.status),
        jobs: [
            {
                id: stage.id,
                name: stage.title,
                taskRef: stage.metadata.adapter ? String(stage.metadata.adapter) : stage.key,
                status: (0, exports.toYunxiaoJobStatus)(stage.status),
                startedAt: stage.startedAt,
                finishedAt: stage.finishedAt,
                durationMs: stage.durationMs,
                steps: stage.logs.map((line, stepIndex) => ({
                    id: `${stage.id}-step-${stepIndex}`,
                    name: line.split(" ").slice(0, 3).join(" "),
                    status: (0, exports.toYunxiaoJobStatus)(stage.status),
                })),
            },
        ],
    })),
    globalParams: [
        { key: "ENVIRONMENT", value: run.environment },
        { key: "CANARY_PERCENT", value: String(run.canaryPercent) },
        { key: "COMMIT", value: run.commit },
        ...(run.definitionSnapshot.variables ?? []),
        ...(run.definitionSnapshot.runtimeVariables ?? []).map((param) => ({ ...param, key: `runtime.${param.key}` })),
    ],
});
exports.toPipelineRunInstance = toPipelineRunInstance;
//# sourceMappingURL=index.js.map