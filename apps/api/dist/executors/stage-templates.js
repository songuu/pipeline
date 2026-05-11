"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStageLogs = exports.STAGE_DURATIONS = void 0;
/**
 * 各生命周期阶段的模拟时长（毫秒）。SimulatedExecutor 用其推进 stage。
 */
exports.STAGE_DURATIONS = {
    source: 18_000,
    test: 96_000,
    build: 184_000,
    env: 12_000,
    package: 42_000,
    upload: 28_000,
    deploy: 76_000,
    canary: 135_000,
    approval: 0,
    promote: 58_000,
};
/**
 * 阶段日志模板。失败态返回不同的诊断信息。
 */
const buildStageLogs = (stage, run, status) => {
    const failed = status === "failed";
    const templates = {
        source: [
            `git clone ${run.definitionSnapshot.repository}`,
            run.refType === "tag"
                ? `checkout tag ${run.refName} -> ${run.commit}`
                : `checkout branch ${run.branch}@${run.commit}`,
            "生成 source snapshot 与变更文件清单。",
        ],
        test: [
            "恢复依赖缓存。",
            failed ? "单元测试失败: payment.spec.ts timeout" : "单元测试通过: 284 passed, 0 failed。",
            failed ? "质量门禁阻止后续构建。" : "SAST 扫描通过，未发现高危漏洞。",
        ],
        build: [
            "开始构建应用产物。",
            failed ? "构建失败: Dockerfile 缺少 runtime layer。" : "容器镜像构建完成。",
        ],
        env: [
            `注入环境变量: NODE_ENV=${run.environment === "prod" ? "production" : run.environment}`,
            "挂载密钥引用: ACR_TOKEN、KUBECONFIG、CANARY_ROUTER_TOKEN。",
            failed ? "变量校验失败: 缺少 DEPLOY_NAMESPACE。" : "生成 Tekton task env 与 projected secret 清单。",
        ],
        package: [
            "生成 SBOM、测试报告与 provenance 原始材料。",
            "写入不可变运行快照。",
        ],
        upload: [
            `推送制品 registry.internal/${run.applicationId}:${run.id}`,
            "记录 artifact digest sha256:8f31c2d90...",
        ],
        deploy: [
            `渲染 ${run.environment} 环境 Helm values。`,
            "提交 Kubernetes rollout 并等待副本就绪。",
        ],
        canary: [
            `灰度发布 ${run.canaryPercent}% 流量。`,
            "观察窗口 5 分钟，错误率 0.04%，P95 延迟稳定。",
        ],
        approval: [
            "创建生产发布审批单。",
            "等待 owner 与 SRE 双人确认。",
        ],
        promote: [
            "扩大流量至 100%。",
            "写入部署历史、审计事件和签名证明。",
        ],
    };
    return templates[stage];
};
exports.buildStageLogs = buildStageLogs;
//# sourceMappingURL=stage-templates.js.map