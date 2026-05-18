"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStageLogs = exports.STAGE_DURATIONS = void 0;
const shared_1 = require("@deploy-management/shared");
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
    const image = (0, shared_1.resolveImageArtifact)(run.definitionSnapshot, run);
    const buildConfig = run.definitionSnapshot.buildConfig ?? shared_1.DEFAULT_PIPELINE_BUILD_CONFIG;
    const isGo = buildConfig.runtime === "go";
    const templates = {
        source: [
            `git clone ${run.definitionSnapshot.repository}`,
            run.refType === "tag"
                ? `checkout tag ${run.refName} -> ${run.commit}`
                : `checkout branch ${run.branch}@${run.commit}`,
            "生成 source snapshot 与变更文件清单。",
        ],
        test: [
            isGo ? "恢复 Go module 与 go-build 缓存。" : "恢复依赖缓存。",
            failed
                ? isGo ? "Go 单元测试失败: go test ./... 返回错误。" : "单元测试失败: service.spec.ts timeout"
                : isGo ? "Go 单元测试通过: go test ./...。" : "单元测试通过: 284 passed, 0 failed。",
            failed ? "质量门禁阻止后续构建。" : "SAST 扫描通过，未发现高危漏洞。",
        ],
        build: [
            isGo ? "执行 go mod download 与 go build -o bin/application ." : `执行 package.json scripts.${buildConfig.packageBuildScript}。`,
            failed ? "打包失败: 未生成配置的真实产物目录。" : `打包完成: ${buildConfig.packageOutputPaths.join(" / ")}。`,
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
            `docker build -f ${image.dockerfilePath} -t ${image.imageRef} ${image.contextPath}`,
            `docker push ${image.imageRef} 并记录 registry digest。`,
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