---
title: "完整灰度发布系统"
type: sprint
status: completed
created: "2026-05-15"
updated: "2026-05-15"
checkpoints: 0
tasks_total: 6
tasks_completed: 6
tags: [sprint, release, canary, deployment]
aliases: ["灰度系统", "Canary Release"]
---

# 完整灰度发布系统

## Phase 1: 需求分析

### 范围

- 将灰度发布从流水线里的一个 `canaryPercent` 字段提升为可管理的发布状态机。
- 支持灰度计划：批次比例、观测窗口、成功率/错误率/延迟门禁、失败自动回滚策略。
- 支持灰度操作：开始上线、推进下一批、暂停、继续、全量发布、回滚。
- 发布记录需要持久化到当前 Repository Store，因此在 Supabase 模式下也会进入 `deployment_records`。
- 前端制品中心需要展示灰度状态、批次、指标、操作按钮和上线记录。

### 非范围

- 不假设本地一定有 Kubernetes；本地先走 `local-docker` 真实镜像拉取与容器上线。
- 不强行实现真实流量网关；当目标环境没有服务网格/Ingress 控制面时，系统保存灰度控制状态并显式提示。
- 不引入新的数据库表；沿用当前 generic repository store，避免和已有 Supabase 接入重复造迁移。

### 验收标准

- `DeployArtifactRequest` 可以传入灰度策略。
- `ReleaseDeployment` 可以表达当前灰度比例、批次状态、指标结果、暂停/回滚/全量发布。
- 后端提供灰度推进、暂停、继续、全量、回滚接口。
- 前端制品中心可以对镜像制品发起灰度上线，并对进行中的灰度发布执行控制操作。
- `pnpm --filter @deploy-management/shared build`、`api check`、`web check` 通过。

### 风险

- 真实 Kubernetes/网关灰度需要集群能力，当前本地只能完整管理状态机和 local-docker 上线，不会伪装已切真实流量。
- 现有工作区有大量未提交改动，本轮只改灰度相关边界，避免回滚其他改动。

## Phase 2: 技术方案

### 领域模型

- 新增 `CanaryRolloutPolicy`：批次、指标门禁、自动/手动推进、失败策略。
- 新增 `CanaryRolloutStep`：每个灰度批次的比例、状态、时间和指标。
- 新增 `CanaryAnalysisSnapshot`：请求量、成功率、错误率、P95 延迟和结论。
- 扩展 `ReleaseDeployment`：`rolloutPolicy`、`rolloutSteps`、`currentTrafficPercent`、`stableImageRef`、`rollbackImageRef`、`rollbackReleaseId`、`completedAt`。

### API

- `POST /api/artifacts/:artifactId/deploy` 支持 `rolloutPolicy`。
- `POST /api/releases/:releaseId/canary/advance`
- `POST /api/releases/:releaseId/canary/pause`
- `POST /api/releases/:releaseId/canary/resume`
- `POST /api/releases/:releaseId/canary/promote`
- `POST /api/releases/:releaseId/rollback`
- OAPI 路径保持同构。

### 执行语义

- 初始上线仍执行真实镜像部署。
- `rolling / blue_green / canaryPercent=100` 直接标记 `success`。
- `canary` 且批次未到 100 时标记 `canarying`，记录当前批次并等待推进。
- 回滚在本地优先复用上一条成功 release 的镜像引用；没有稳定版本时给出明确错误。

## Phase 3: 任务拆解

- [x] Task 1: 建立 sprint 文档并确认范围。
- [x] Task 2: 扩展 shared 类型和 API DTO。
- [x] Task 3: 实现 Release 灰度状态机与控制接口。
- [x] Task 4: 更新前端 action 与制品中心 UI。
- [x] Task 5: 执行 shared/api/web 检查。
- [x] Task 6: 复核风险并更新文档。

### 变更日志

- `packages/shared/src/index.ts`
  - 新增 `CanaryRolloutPolicy`、`CanaryRolloutStep`、`CanaryAnalysisSnapshot`、`ReleaseCanaryActionRequest`。
  - `ReleaseDeployment` 新增灰度批次、当前流量、稳定版本、回滚版本和完成时间。
  - `ReleaseStatus` 新增 `canarying`、`paused`。
- `apps/api/src/releases/*`
  - `deployArtifact` 支持 `rolloutPolicy`，可以创建真实 release 记录并进入灰度状态。
  - 新增灰度推进、暂停、继续、全量发布、回滚接口。
  - 回滚会查找同应用同环境最近一次成功发布作为稳定版本。
- `apps/web/app/ui/sections/artifact-center.tsx`
  - 制品卡片增加“灰度上线”入口。
  - 发布记录增加灰度批次轨道和推进/暂停/继续/全量/回滚按钮。
- `apps/web/app/globals.css`
  - 增加灰度轨道、控制面板、按钮和发布状态样式。

## Phase 4: 审查结果

### 结果

- P0: 未发现阻断问题。
- P1: 当前 `local-docker` 只能真实拉取镜像并启动容器，不能真实切分流量；已在 release 日志中显式说明。
- P1: Kubernetes 目标当前仍依赖集群侧已有 Deployment/Ingress/ServiceMesh，本轮提供灰度控制面和状态机，不替用户伪造集群流量能力。

### 验证

- `pnpm --filter @deploy-management/shared build`：通过。
- `pnpm --filter @deploy-management/shared check`：通过。
- `pnpm --filter @deploy-management/api check`：通过。
- `pnpm --filter @deploy-management/api build`：通过。
- `pnpm --filter @deploy-management/web check`：通过。
- `pnpm --filter @deploy-management/web build`：通过。

## Phase 5: 复利记录

### 可沉淀经验

- 灰度系统必须拆成两层：发布状态机和真实流量执行器。没有流量网关时只能完成状态机与容器上线，不能声称已经真实按比例切流。
- Release 记录要保存 rollback anchor，否则灰度失败时只能“知道失败”，无法可靠回滚到上一稳定版本。

### 下一步

- 服务器接入 Kubernetes 后，增加网关适配器：Nginx Ingress、Istio、Argo Rollouts 或自定义 `kubectl patch` 模板。
- 将灰度策略从当前固定 UI 默认值扩展为可配置表单。
