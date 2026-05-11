---
title: "CI/CD 全链路云效 Flow 科幻化冲刺"
type: sprint
status: completed
created: "2026-05-11"
updated: "2026-05-11"
checkpoints: 0
tasks_total: 7
tasks_completed: 7
tags: [sprint, cicd, tekton, yunxiao, frontend]
aliases: ["CI/CD 全链路", "云效 Flow 科幻 UI"]
---

# 需求分析

目标：把当前 Nest + Next CI/CD 平台从“静态展示”推进到“可创建、可配置、可执行、可查看日志、可观测 Tekton 对象”的完整链路。

## 范围

1. 新建流水线：支持模板创建与自定义空模板创建。
2. 配置流水线：基本信息、流程配置、触发设置、变量和缓存可编辑，并可保存到后端。
3. 执行流水线：从列表、详情、配置页都可触发运行。
4. 生命周期：拉取代码、测试、打包、注入环境变量、构建镜像、上传制品、部署、灰度、审批、全量。
5. 日志：每个阶段、TaskRun、Step 都能展示对应日志。
6. Tekton：PipelineRun、TaskRun、Params、Workspaces、Results、Chains 全链路进入快照和 UI。
7. UI：信息结构保持云效 Flow；视觉风格改成更科幻的控制台风格。

## 非范围

1. 不接真实 Git/ACR/Kubernetes 集群。
2. 不引入数据库；继续用内存仓储作为本 sprint 持久层占位。
3. 不新增浏览器测试依赖。

## 操作清单 / 验收

| 编号 | 操作 | 入口 | 结果 |
|---|---|---|---|
| OP-01 | 打开新建流水线弹窗 | 列表页“新建流水线” | 模板/空模板可选 |
| OP-02 | 切换创建方式 | 模板弹窗“可视化/YAML” | request.triggers 包含 yaml |
| OP-03 | 选择模板分类/模板 | 模板弹窗左侧/卡片 | 预览生命周期更新 |
| OP-04 | 创建模板流水线 | 模板弹窗“创建” | 进入配置页 |
| OP-05 | 创建自定义流水线 | 空模板分类/空模板 | 进入配置页，可补配置 |
| OP-06 | 保存基本配置 | 配置页“仅保存” | 后端 pipeline 更新 |
| OP-07 | 保存流程配置 | 流程配置页 | stages 更新 |
| OP-08 | 保存触发/变量/缓存 | 对应 tab | triggers/metadata 参数进入运行配置 |
| OP-09 | 保存并运行 | 配置页 | 创建 PipelineRun |
| OP-10 | 列表运行 | 列表行播放按钮 | 创建 PipelineRun 并进入详情 |
| OP-11 | 详情重跑 | 详情页“运行” | 创建新运行 |
| OP-12 | 取消运行 | 详情页 | pending/running/waiting 阶段取消 |
| OP-13 | 审批/灰度推进 | 详情页 | waiting_approval 继续到 promote |
| OP-14 | 查看阶段日志 | 详情页阶段卡片 | 右侧日志面板显示 stage/task/step logs |
| OP-15 | 查看 Tekton 对象 | 列表/详情/配置 | PipelineRun/TaskRun/Results/Chains 可见 |

# 技术方案

## 后端

- `PipelineDefinition` 增加 variables/cache/settings 轻量配置字段。
- 新增 `UpdatePipelineRequest` 与 `PUT /api/pipelines/:id`。
- `LifecycleEngine` 日志模板覆盖完整生命周期，加入环境变量注入阶段语义。
- `SnapshotService` Tekton record 从 run stage 派生 TaskRun/Step/Results/Chains。

## 前端

- `DashboardShell` 统一处理 create/update/run/cancel/promote/reload。
- `PipelineList` 所有 toolbar/row actions 有真实 handler。
- `PipelineConfigEditor` 保存到 API；流程节点点击同步 stages；变量/缓存进入 run config。
- `PipelineRunDetail` stage card 可选中，右侧展示 logs/taskRuns/steps/evidence。
- `globals.css` 改为深色科幻控制台变量层，同时保留云效密集布局。

# 任务拆解

- [x] Task 1: 补共享模型与 API update pipeline
- [x] Task 2: 补生命周期日志与 Tekton run record 完整性
- [x] Task 3: 补前端 actions：save/run/refresh/list-row-run
- [x] Task 4: 补配置页可编辑字段、stages、variables/cache 保存
- [x] Task 5: 补详情页阶段日志与 TaskRun/Step 选择
- [x] Task 6: 科幻云效 UI 视觉改造
- [x] Task 7: 检查、构建、HTTP 冒烟验证

# 验证策略

风险等级：L3。原因：跨 shared/api/web，涉及核心数据模型、API 契约、用户操作链路。

验证：

1. `pnpm --filter @deploy-management/shared check`
2. `pnpm --filter @deploy-management/api check`
3. `pnpm --filter @deploy-management/web check`
4. `pnpm --filter @deploy-management/api build`
5. `pnpm --filter @deploy-management/web build`
6. API smoke：`/api/snapshot`、创建、更新、运行
7. Web smoke：`/`、`/pipelines`、`/pipelines/:id`、`/pipelines/:id/edit`

# 变更日志

- 2026-05-11: 创建 sprint 文档，冻结操作清单。
- 2026-05-11: `PipelineDefinition` 增加 variables/runtimeVariables/caches/serviceConnections。
- 2026-05-11: 生命周期增加 `env` 阶段，覆盖环境变量注入。
- 2026-05-11: 新增 `PUT /api/pipelines/:id`，配置页保存可持久化。
- 2026-05-11: 列表运行、配置保存并运行、详情日志选择、TaskRun/Step 日志面板完成。
- 2026-05-11: Flow UI 切换为科幻控制台视觉层。
- 2026-05-11: HTTP 冒烟完成：创建→更新→运行→日志→Tekton runRecords。

# 审查结果

P0：无。

P1：无。

剩余风险：当前仍是内存仓储与同步模拟执行；真实 Git/ACR/Kubernetes 接入时需要把 ExecutorAdapter 替换为实际 Tekton bridge，并增加集成测试。

# 复利记录

经验：新增生命周期阶段时，必须同步 shared union、API DTO schema、stage template、UI icon、模板数据、Tekton step mapping，否则会出现“创建能过、触发失败”的半链路问题。
