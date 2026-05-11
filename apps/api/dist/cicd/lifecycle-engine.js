"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifecycleEngine = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@deploy-management/shared");
const STAGE_DURATIONS = {
    source: 18_000,
    test: 96_000,
    build: 184_000,
    package: 42_000,
    upload: 28_000,
    deploy: 76_000,
    canary: 135_000,
    approval: 0,
    promote: 58_000,
};
let LifecycleEngine = class LifecycleEngine {
    createRun(input) {
        const now = new Date().toISOString();
        const refType = input.request.refType ?? input.pipeline.defaultRefType;
        const refName = input.request.refName ?? input.pipeline.defaultRef;
        const branch = refType === "branch" ? refName : input.pipeline.defaultBranch;
        const tag = refType === "tag" ? refName : undefined;
        const commit = this.createCommit();
        const environment = input.request.environment ?? input.pipeline.targetEnvironment;
        const canaryPercent = input.request.canaryPercent ?? input.pipeline.canaryPercent;
        const stages = input.pipeline.stages.map((key) => this.createStage(key, "pending"));
        return {
            id: `run-${input.runNumber}`,
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
    simulateUntilGate(run, failureStage) {
        const gateIndex = run.stages.findIndex((stage) => stage.key === "approval");
        const stopIndex = gateIndex === -1 ? run.stages.length : gateIndex;
        run.status = "running";
        let blockedByFailure = false;
        run.stages.forEach((stage, index) => {
            if (blockedByFailure) {
                stage.status = "skipped";
                stage.logs = [`${stage.title} 已跳过，因为前序阶段失败。`];
                return;
            }
            if (failureStage && stage.key === failureStage) {
                this.finishStage(stage, "failed", run);
                run.status = "failed";
                run.progress = this.calculateProgress(run);
                blockedByFailure = true;
                return;
            }
            if (index < stopIndex) {
                this.finishStage(stage, "success", run);
            }
        });
        if (blockedByFailure) {
            run.updatedAt = new Date().toISOString();
            return run;
        }
        const approvalStage = run.stages[gateIndex];
        if (approvalStage && run.definitionSnapshot.requiresApproval) {
            approvalStage.status = "waiting";
            approvalStage.startedAt = new Date().toISOString();
            approvalStage.logs = [
                "生产环境命中审批门禁。",
                `灰度比例 ${run.canaryPercent}% 已完成，等待 owner 与 SRE 审批后继续全量。`,
            ];
            run.status = "waiting_approval";
            run.progress = this.calculateProgress(run);
            run.updatedAt = new Date().toISOString();
            return run;
        }
        this.completePromotion(run);
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
    finishStage(stage, status, run, extraLogs = []) {
        const now = new Date();
        const startedAt = new Date(now.getTime() - STAGE_DURATIONS[stage.key]);
        stage.status = status;
        stage.startedAt = startedAt.toISOString();
        stage.finishedAt = now.toISOString();
        stage.durationMs = STAGE_DURATIONS[stage.key];
        stage.logs = [...this.createLogs(stage.key, run, status), ...extraLogs];
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
    createCommit() {
        return Math.random().toString(16).slice(2, 9);
    }
    createLogs(stage, run, status) {
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
    }
};
exports.LifecycleEngine = LifecycleEngine;
exports.LifecycleEngine = LifecycleEngine = __decorate([
    (0, common_1.Injectable)()
], LifecycleEngine);
//# sourceMappingURL=lifecycle-engine.js.map