---
title: "Nest + Next 完整 CI/CD 平台骨架"
type: sprint
status: completed
created: "2026-05-08"
updated: "2026-05-08"
tasks_total: 6
tasks_completed: 6
tags: [sprint, cicd, nestjs, nextjs, tekton]
aliases: ["完整 CI/CD 平台"]
---

# Nest + Next 完整 CI/CD 平台骨架

## 需求分析

用户需要的不是单页原型，而是一套覆盖 Tekton 全生命周期的 CI/CD 平台：

- 拉代码：解析分支、commit、source snapshot。
- 测试：单元测试、类型检查、安全扫描、质量门禁。
- 打包：应用构建、镜像构建、静态包构建。
- 生成制品：镜像、前端包、SBOM、provenance 原材料。
- 上传：推送 registry / artifact store，记录 digest。
- 部署：渲染部署配置并提交执行环境。
- 灰度：按比例发布并观测。
- 审批：生产环境门禁。
- 全量：审批后扩大流量并写审计、证明和部署历史。

## 技术方案

采用 pnpm monorepo：

```text
apps/api       NestJS 控制面与生命周期 API
apps/web       Next.js 控制台
packages/shared 共享领域类型与生命周期阶段定义
```

后端采用 NestJS 实现：

- `LifecycleEngine`: 创建 `PipelineRun`，模拟执行阶段，处理审批、取消、全量发布。
- `CicdService`: 内存态控制面，管理应用、流水线、运行、审批、环境、Runner、制品、审计。
- `CicdController`: 暴露 REST API。

前端采用 Next.js 实现：

- 直接读取 Nest `/api/snapshot`。
- 支持新建发布、选择仓库、选择分支或 tag、运行流水线、取消运行、审批通过/驳回、强制全量。
- 页面保留云效风格：左侧导航、顶部操作、高密度表格、生命周期 DAG、日志终端。

## API 范围

- `GET /api/snapshot`
- `GET /api/lifecycle`
- `GET /api/applications`
- `GET /api/repositories`
- `GET /api/pipelines`
- `POST /api/pipelines`
- `GET /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/logs`
- `POST /api/pipelines/:pipelineId/trigger`
- `POST /api/runs/:runId/cancel`
- `POST /api/runs/:runId/promote`
- `POST /api/approvals/:approvalId/:decision`

## 任务拆解

- [x] 重构为 pnpm workspace。
- [x] 新增 shared 领域模型。
- [x] 新增 NestJS API。
- [x] 实现生命周期引擎。
- [x] 新增 Next.js 控制台。
- [x] 更新文档和运行说明。
- [x] 支持仓库、分支、tag、运行参数和生命周期阶段配置。

## 配置化行为

平台配置入口分为两层：

1. 流水线定义层：`POST /api/pipelines` 创建新的发布流水线，保存默认仓库、默认分支或 tag、目标环境、灰度比例、审批策略和启用阶段。
2. 单次运行层：`POST /api/pipelines/:pipelineId/trigger` 可以覆盖流水线默认配置，选择其他仓库、分支、tag、环境、灰度比例和生命周期阶段。

每次运行都会保存：

- `repositoryId`
- `repository`
- `refType`
- `refName`
- `branch`
- `tag`
- `definitionSnapshot`
- `stages`

这样运行记录可以回放当时到底从哪个仓库、哪个分支或 tag、按哪些阶段完成发布。

## 后续生产化边界

当前是完整平台骨架，执行器采用模拟 adapter。后续生产化要替换以下边界：

- `GitSourceAdapter`: 接真实 Git provider 和 webhook 验签。
- `QualityGateAdapter`: 接 CI runner、测试报告和安全扫描。
- `BuildAdapter`: 接 BuildKit、Kaniko、Maven、npm 等构建器。
- `RegistryUploadAdapter`: 接 ACR/Harbor/S3/OCI registry。
- `KubernetesDeployAdapter`: 接 Helm/Kustomize/Argo Rollouts。
- `CanaryRolloutAdapter`: 接流量网关、Service Mesh 或 ingress 权重。
- `ApprovalGateAdapter`: 接组织审批、变更窗口和通知渠道。

## 验证

已验证命令：

```bash
pnpm build
pnpm check
```

已验证 API 链路：

- `GET /api/repositories` 返回 4 个仓库。
- `POST /api/pipelines` 成功创建 `tag-prod-release`。
- `POST /api/pipelines/:pipelineId/trigger` 使用 `tag:v2026.05.08` 成功触发 `run-23848`。
- 运行包含 9 个生命周期阶段，状态进入 `waiting_approval`。

运行方式：

```bash
pnpm dev:api
pnpm dev:web
```
