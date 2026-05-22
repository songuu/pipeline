---
title: "Frontend Static Pipeline"
type: sprint
status: completed
created: "2026-05-22"
updated: "2026-05-22"
checkpoints: 0
tasks_total: 4
tasks_completed: 4
tags: [sprint, frontend, pipeline, packaging]
aliases: ["前端静态站点流水线"]
invariants:
  - "真实构建仍只能走 EXECUTOR=tekton 或 EXECUTOR=local-docker，不能回退成 simulated 假成功"
  - "Supabase service role / DB URL / secret key 只能后端或部署期注入，不能进入前端包或 Docker build args"
  - "container_image 继续使用 imageArtifact；static_site/server_package 等包模式不能被镜像仓库前置条件误拦截"
invariant_tests:
  - "pnpm --filter @deploy-management/api check"
  - "pnpm --filter @deploy-management/web check"
deferred: []
deadcode_until: []
---

# Frontend Static Pipeline

## Phase 1: Think

### 需求分析

新增一条前端流水线，默认走静态站点包模式，支持使用者在创建后自行输入前端打包执行命令、命令参数，并配置上传后的访问域名。

### 非目标

- 不重做上一 sprint 已完成的执行器、上传、artifact、release 链路。
- 不接入真实云厂商 SDK；默认使用通用 static-server 配置，访问域名由使用者填写。
- 不把私密 token / service role 注入前端构建产物。

### 成功标准

- 新实例默认有一条前端静态站点流水线。
- 新建模板里有一条“自定义前端打包、访问域名”流水线。
- 从模板创建流水线时保留“手输命令”模式、命令参数变量和访问域名入口，但不预置具体值。
- 当前本地 API 数据里新增同等配置，刷新列表可见。

## Phase 2: 技术方案

### 入场扫描 - Invariants 继承

| 子系统 | 上 sprint invariant | 本 sprint 如何保持 |
|--------|---------------------|--------------------|
| 真实执行器 | `build` / `upload` 只能走 `tekton` 或 `local-docker` | 只新增配置入口，不改变 executor fallback |
| Secret 边界 | 私密 Supabase / registry secret 不进入前端包或 build args | seed/template 只提供空的 `PUBLIC_BASE_URL` 和 `BUILD_ARGS` 输入位 |
| 包模式 | `container_image` 继续走 imageArtifact；非镜像包走 packageUpload | 前端流水线固定 `static_site` + `packageUpload` |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 持久化 | 刷新后可见 |
|--------|----------|--------|--------|------------|
| seed 前端流水线 | 新环境启动 | SEED_PIPELINES -> repository store | json/supabase seed | 是 |
| 模板前端流水线 | 新建流水线 | template -> CreatePipelineRequest -> API normalize | pipelines repository | 是 |
| 当前运行数据 | 本地 API POST/PUT | /api/pipelines -> 当前 API store | 本地运行态 | 是 |

### 入场扫描 - 债务清单

| 来源 sprint | 议题 | 本 sprint 决策 | deadline |
|-------------|------|----------------|----------|
| 2026-05-21 custom build upload | 前端模板没有自定义命令、命令参数和域名输入入口 | 本 sprint 收口 | 2026-05-22 |

### 任务拆解

- [x] Task 1: 新增 API seed 前端静态站点流水线。
- [x] Task 2: 新增 Web 模板，并让模板创建请求携带 `packageUpload`。
- [x] Task 3: 补 seed/template 回归测试。
- [x] Task 4: 运行目标检查，复核当前 API 数据。

## Phase 3: Work Log

- 新增 `pipe-frontend-static-custom` seed，配置 `static_site`、`packageBuildCommandMode=custom`，但不预设具体打包命令或访问域名。
- 新增 `node-frontend-custom-static` 模板，覆盖“创建后由使用者填写执行命令、命令参数和访问域名”的入口。
- `createRequestFromTemplate` 现在会把非镜像模板的 `packageUpload` 写入 `CreatePipelineRequest`。
- 前端静态模板在选择模板弹窗里直接展示醒目的必填输入区：执行命令、命令参数、访问域名；命令和域名为空时不能创建。
- 输入的执行命令和命令参数会拼成最终 `buildConfig.packageBuildCommand`，命令参数也会保留到 `BUILD_ARGS`，访问域名同步写入 `PUBLIC_BASE_URL` 和 `packageUpload.publicBaseUrl/accessDomain`。
- 当前本地 API 已通过 `POST /api/pipelines` 新增 `tianqi-frontend-staging-release`。
- 根据反馈已通过 `PUT /api/pipelines/:id` 清理当前本地静态站点流水线的默认命令和默认域名，并补齐空的 `BUILD_ARGS`。
- 新增回归测试：`apps/api/src/common/seed-data.spec.ts` 和 `apps/web/app/ui/data/templates.test.ts`。

## Phase 4: Review

### 复核结论

- 未发现 P0/P1 问题。
- 没有改变执行器边界；新增配置继续走已有 `static_site` + `packageUpload` 链路。
- 模板创建请求已携带 `packageUpload`，同时不预置 `publicBaseUrl/accessDomain`，创建后由使用者填写。
- 当前本地 API 数据已新增 `tianqi-frontend-staging-release`，字段为 `static_site`、`packageBuildCommandMode=custom`，命令和访问域名为空。

### 验证

- `pnpm --filter @deploy-management/api test -- src/common/seed-data.spec.ts` 通过。
- `pnpm --filter @deploy-management/web test -- app/ui/data/templates.test.ts` 通过。
- `pnpm --filter @deploy-management/web test -- app/ui/data/templates.test.ts app/ui/data/template-inputs.test.ts app/ui/sections/__tests__/template-modal-frontend-inputs.test.tsx` 通过。
- `pnpm --filter @deploy-management/api check` 通过。
- `pnpm --filter @deploy-management/web check` 通过。
- `GET http://127.0.0.1:4000/api/snapshot` 确认当前本地两条静态站点自定义流水线均为 `command=null`、`publicBaseUrl=null`、`accessDomain=null`，且 `PUBLIC_BASE_URL/BUILD_ARGS` 为空。

## Phase 5: Compound

### 复利记录

- 模板层新增非镜像包配置时，必须同步 `CreatePipelineRequest.packageUpload` 传递测试点；同时区分“配置入口存在”和“具体值由使用者填写”。
- 已保持上一 sprint 的自定义构建/上传能力不变量，本轮只新增默认配置与入口。
