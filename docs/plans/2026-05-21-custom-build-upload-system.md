---
title: "Custom Build And Upload System"
type: sprint
status: completed
created: "2026-05-21"
updated: "2026-05-21"
checkpoints: 0
tasks_total: 5
tasks_completed: 5
tags: [sprint, cicd, packaging, upload, configuration]
aliases: ["自定义打包上传系统"]
invariants:
  - "真实构建仍只能走 EXECUTOR=tekton 或 EXECUTOR=local-docker，不能回退成 simulated 假成功"
  - "Supabase service role / DB URL / secret key 只能后端或部署期注入，不能进入前端包或 Docker build args"
  - "container_image 继续使用 imageArtifact；static_site/server_package 等包模式不能被镜像仓库前置条件误拦截"
invariant_tests:
  - "pnpm --filter @deploy-management/shared check"
  - "pnpm --filter @deploy-management/api check"
  - "pnpm --filter @deploy-management/web check"
  - "go build ./..."
  - "go build -tags tekton ./..."
deferred: []
deadcode_until: []
---

# Custom Build And Upload System

## Phase 1: Think

### 需求分析

本 sprint 在现有三层架构上补齐一等配置能力：

- 支持前端/后端自定义打包命令，不局限于 `package.json scripts.build`。
- 支持构建、运行、部署不同阶段的自定义环境变量，并在执行器中真实注入。
- 支持非镜像包的上传配置，包括 OSS、自建静态服务器、本地文件目录和自定义命令。
- 支持配置访问域名或 public base URL，让构建包上传后能回写可访问地址。

### 非目标

- 不引入新的远程 Runner 架构，不替换现有 `local-docker` / `tekton` 执行面。
- 不直接接入某个云厂商 SDK；OSS 或自建服务器上传通过通用配置、文件镜像和自定义上传命令承载。
- 不改发布灰度状态机，只把包上传结果接到现有 artifact/release 链路。

### 成功标准

- Pipeline 定义可以保存 `buildConfig.packageBuildCommand` 和 `packageUpload`。
- local-docker 能用自定义命令打包，并把构建时变量注入到真实子进程。
- 非 `container_image` 模式的 `upload` 阶段不再要求镜像仓库，能生成 package artifact 的 uri/publicUrl。
- 前端配置页能填写包上传目标、访问域名和自定义上传命令；运行前置检查按包模式区分。
- 共享类型、API DTO、执行器和文档一致，目标检查通过。

## Phase 2: 技术方案

### 入场扫描 - Invariants 继承

| 子系统 | 上 sprint invariant | 本 sprint 如何保持 |
|--------|---------------------|--------------------|
| 真实执行器 | `build` / `upload` 只能走 `tekton` 或 `local-docker` | 前置检查保留 executor 校验，新增包上传分支不允许 simulated |
| Secret 边界 | 私密 Supabase / registry secret 不进入前端包或 build args | 自定义变量按 `injectionTiming` / `targetStages` 注入，敏感值日志脱敏 |
| 包模式 | `packageMode` 已区分 container/static/server/manifest/helm | `container_image` 继续走 imageArtifact；非镜像包走 packageUpload |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 持久化 | 刷新后可见 |
|--------|----------|--------|--------|------------|
| 自定义构建命令 | 保存流水线并运行 build | Web config -> API DTO -> PipelineDefinition -> Executor globalParams | pipeline 定义持久化 | 是 |
| 自定义环境变量 | 编辑变量表并运行 | PipelineDefinition variables -> StartRunInput -> local/Tekton env/params | pipeline 定义持久化 | 是 |
| 包上传目标 | 非镜像包启用 upload | packageUpload -> Executor upload -> Artifact metadata | artifact 持久化 | 是 |
| 访问域名 | 填写 publicBaseUrl/accessDomain | packageUpload -> 上传结果 publicUrl -> Artifact/Release endpoint | artifact/release 持久化 | 是 |

### 入场扫描 - 债务清单

| 来源 sprint | 议题 | 本 sprint 决策 | deadline |
|-------------|------|----------------|----------|
| 2026-05-13 full-chain audit | 非镜像包上传仍偏本地目录 | 本 sprint 收口为 packageUpload 配置 | 2026-05-21 |

### 任务拆解

- [x] Task 1: 扩展共享类型、默认值、DTO 和 Pipeline service 归一化。
- [x] Task 2: 扩展 Lifecycle -> StartRunInput，按包模式生成上传参数和环境变量。
- [x] Task 3: 扩展 local-docker 与 Tekton inline task，自定义命令、env 注入、包上传结果回写。
- [x] Task 4: 扩展前端配置页和运行前置检查，支持 OSS/静态服务器/访问域名配置。
- [x] Task 5: 更新 README / sprint review，并跑 targeted checks。

## Phase 3: Work Log

### 共享契约

- `packages/shared/src/platform/index.ts` 新增 `PackageUploadConfig`、`PackageUploadProvider`、`DEFAULT_PACKAGE_UPLOAD_CONFIG`，并让 `PipelineDefinition` / Create / Update / Artifact 支持 `packageUpload`、`uri`、`publicUrl` 和 `storageProvider`。
- `packages/shared/src/registry/index.ts` 新增 `ensureArtifactUploadStage`，让 `container_image` 继续走 `imageArtifact`，非镜像包按 `packageUpload` 自动补 `upload` 阶段。

### API 控制面

- DTO 和 Pipeline service 归一化 `buildConfig.contextPath`、`buildConfig.packageBuildCommand`、`packageUpload`。
- Lifecycle 生成 `PACKAGE_MODE`、`PACKAGE_BUILD_COMMAND`、`PACKAGE_UPLOAD_*` 参数，并按 `injectionTiming` / `targetStages` 保留变量注入语义。
- Runs 前置检查按包模式分支：镜像上传检查 registry/Dockerfile/Secret，非镜像上传检查 build 阶段、上传端点、目标路径和服务连接。
- Artifact 持久化非镜像包的 `package-uri`、`package-public-url` 和 `package-storage-provider`。

### 执行面

- `local-docker` 支持 `generic` runtime、自定义打包命令、构建/上传阶段环境变量注入、非镜像包镜像到上传目录、可选自定义上传命令，以及 package URI/public URL 回写。
- `tekton-bridge` 的 inline Pipeline 支持 `PACKAGE_BUILD_COMMAND`，并为非镜像包生成 package upload task；自定义上传命令可读取 `PACKAGE_ARCHIVE_PATH`、`PACKAGE_MIRROR_PATH`、`PACKAGE_DIGEST`、`PACKAGE_URI`、`PACKAGE_PUBLIC_URL`。
- Tekton preflight 不再把非镜像包误判为必须配置 docker-registry Secret。

### 前端

- Pipeline 配置页新增构建上下文、自定义打包命令、包上传类型、上传端点、访问域名、目标路径模板、上传服务连接、自定义上传命令和访问地址预览。
- Run launch dialog 的真实运行前置检查按 `packageMode` 区分镜像与非镜像包。
- Artifact Center 展示包 URI/public URL，长地址使用单行省略避免撑破布局。

## Phase 4: Review

### 复核结论

- 未发现需要继续修改的 P0/P1 问题。
- 保持了现有架构边界：控制面仍通过 `LifecycleEngine -> ExecutorAdapter/Tekton bridge` 执行；没有新增独立 Runner 或云厂商 SDK。
- Secret 边界保持：普通自定义变量只在运行期注入真实子进程；内置参数和敏感环境变量会从命令日志中脱敏。
- 补了一个边界检查：非镜像包 `upload` 必须包含 `build` 阶段，因为上传任务依赖 build task 的 package artifact。

### 验证

- `pnpm --filter @deploy-management/shared check` 通过。
- `pnpm --filter @deploy-management/shared build` 通过。
- `pnpm --filter @deploy-management/api check` 通过。
- `pnpm --filter @deploy-management/web check` 通过。
- `go build ./...` 通过。
- `go build -tags tekton ./...` 通过。

## Phase 5: Compound

### 经验沉淀

- 架构经验：镜像产物和静态/服务端包产物应共享 “build -> upload -> artifact” 语义，但前置条件必须按 `packageMode` 分支，否则非镜像包会被 registry/Docker Secret 误拦截。
- 工具链经验：Go/TypeScript 验证可能产生临时文件或 tsbuildinfo 噪音，收尾时要只清理本轮工具产物，不碰用户原有 dirty worktree。
- 后续扩展点：如果要真正接入某个 OSS SDK，可在 `PACKAGE_UPLOAD_COMMAND` 稳定后再沉淀 provider adapter；当前先保持通用 endpoint + 自定义命令，避免把某个厂商做成硬依赖。
