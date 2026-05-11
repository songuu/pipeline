---
title: "Tekton 优势集成冲刺"
type: sprint
status: completed
created: "2026-05-11"
updated: "2026-05-11"
checkpoints: 0
tasks_total: 5
tasks_completed: 5
tags: [sprint, tekton, cicd, observability]
aliases: ["Tekton 优势集成"]
---

# 需求分析

目标：继续把 Tekton 的真实优势集成到当前 Nest + Next CI/CD 平台中，让页面不只是“像云效”，而是能表达 Tekton 的可组合、可审计、可观测和供应链安全能力。

## 官方能力锚点

- PipelineRun 会执行 Pipeline 中的 Task，并自动创建对应 TaskRun；status 中包含每个 TaskRun 与完整 PipelineSpec，可用于审计。
- PipelineRun 支持 params、ServiceAccount、taskRunSpecs、workspaces 等运行时配置。
- Triggers 用 EventListener/Trigger/TriggerTemplate/TriggerBinding/Interceptor 从事件中抽取数据并确定性地创建 TaskRun/PipelineRun。
- Results 把 PipelineRun/TaskRun/Logs 分组为长期可查询记录，降低控制器和 etcd 压力。
- Chains 观察 TaskRun/PipelineRun 完成事件，生成标准证明材料、签名并存储。

参考：
- https://tekton.dev/docs/pipelines/pipelineruns/
- https://tekton.dev/docs/triggers/
- https://tekton.dev/docs/results/
- https://tekton.dev/docs/chains/

## 范围

1. 扩展共享 Tekton runtime 模型：WorkspaceBinding、Resolver、Task graph、Run Results、Run Events、TaskRun results。
2. API 快照基于 pipeline/run 派生更完整的 Tekton 控制面视图。
3. 运行详情页展示 Tekton 的 DAG、Workspaces、Params、Results、Events、Chains。
4. 配置页展示 resolver/workspace/task graph，让配置和 Tekton 执行模型对应。
5. 保持现有运行/审批/取消链路可用。

## 非范围

1. 不接真实 Kubernetes CRD。
2. 不引入数据库或消息队列。
3. 不新增 E2E 测试依赖。

# 技术方案

采用非破坏式扩展：保留现有字段，新增可选/新增字段，前端优先读新字段，缺失时继续 fallback 到旧字段。

# 任务拆解

- [x] Task 1: 扩展 shared Tekton runtime 类型
- [x] Task 2: 扩展 API `SnapshotService` Tekton 派生数据
- [x] Task 3: 运行详情页增强 Tekton runtime / event / result / chain 可视化
- [x] Task 4: 配置页增强 resolver / workspace / task graph 展示
- [x] Task 5: 类型检查、构建、Chrome 冒烟验证

# 验证策略

风险等级：L3。跨 shared/api/web，并影响核心运行详情页。

验证命令：

1. `pnpm --filter @deploy-management/shared check`
2. `pnpm --filter @deploy-management/api check`
3. `pnpm --filter @deploy-management/web check`
4. `pnpm --filter @deploy-management/api build`
5. `pnpm --filter @deploy-management/web build`
6. Chrome 验证：配置页切换、保存运行、运行中、待审批、审批通过。

# 变更日志

- 2026-05-11: 创建 sprint 文档，冻结 Tekton 优势集成范围。
- 2026-05-11: `packages/shared` 增加 ResolverRef、WorkspaceBinding、TaskGraph、ResultRecord、RunEvent 等 Tekton runtime 类型。
- 2026-05-11: `SnapshotService` 基于 pipeline/run 派生 resolver、workspace binding、task graph、TaskRun results、Results records 和 Events。
- 2026-05-11: 运行详情页新增 PipelineSpec/Resolver、Params/Workspaces、Results Records、Events、TaskRun outputs 面板。
- 2026-05-11: 配置页流程配置新增 resolver、workspace binding、task graph 展示。
- 2026-05-11: 验证通过：shared/api/web check，api build，web build，Chrome 冒烟。

# 审查结果

P0：无。

P1：无。

剩余风险：Chrome 扩展在完整 DOM snapshot 上会因为运行详情页信息密度较高而超时；已改用文本定位做冒烟验证。后续如果要自动化完整截图，应增加运行详情页虚拟滚动或分区折叠。

# 复利记录

经验：Tekton 的优势不要只落在“对象名称”上，必须把 `PipelineRun.status`、TaskRun 子对象、Workspace binding、Results record、Chains attestation 和事件流同时放到同一个运行视图里，用户才会感知到它比传统脚本流水线更可审计、更可追踪。
