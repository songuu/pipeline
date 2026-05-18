---
title: "云效流水线模板一致性增强"
status: in-progress
date: 2026-05-15
mode: sprint-auto
---

# 云效流水线模板一致性增强

## 需求分析

目标：继续丰富流水线模板，保持和阿里云云效 Flow 的模板体验一致，不只还原样式，还要让每条模板创建后自带对应功能配置。

验收点：

- 模板列表覆盖截图中的 Node.js 与 Go 预置模板。
- 模板卡片使用云效式白色卡片、蓝色预置标签、并行任务汇聚的小流程图。
- 每条模板创建流水线时带入对应配置：构建语言、打包方式、制品路径、服务连接、变量、缓存、镜像仓库或部署目标。
- 本地执行器可以区分 Node.js 与 Go 构建流程，Go 模板不再误走 `package.json scripts.build`。

参考依据：

- 云效 Node.js 测试构建文档说明模板预置 JavaScript 代码扫描、Node.js 单元测试、Node.js 构建上传，以及构建环境、执行命令、构建物上传等配置项。
- 云效流程配置文档说明流水线由阶段、任务、步骤组成，任务可以串行或并行。
- 云效 ACK 模板文档说明 Node.js 镜像构建后推送 ACR，并发布到 ACK / Kubernetes。

## 技术方案

1. 扩展前端模板模型：
   - `flowGroups` 表达并行任务与后续任务汇聚。
   - `buildConfig` 表达每条模板的构建语言、打包方式和产物路径。
   - `serviceConnections`、`variables`、`runtimeVariables`、`caches` 表达模板创建后的功能配置。

2. 扩展创建流水线映射：
   - Node.js 模板默认走 package.json 脚本。
   - Go 模板设置 `buildConfig.runtime=go`，默认缓存 Go build 目录。
   - 镜像模板自动创建 ACR 镜像配置。
   - ECS/OSS/ACK 模板注入对应部署变量与服务连接。

3. 扩展执行器：
   - `local-docker` 根据 `BUILD_RUNTIME` 识别 Node.js / Go。
   - Go 流程执行 `go test ./...`、`go mod download`、`go build -o bin/application .`。

4. 视觉还原：
   - 模板弹窗使用云效式浅色卡片，即使主系统是深色控制台，也保持模板市场与云效一致。
   - `MiniFlow` 支持多列任务组，第一列可展示并行扫描/测试任务。

## 任务拆解

- [x] T1：补齐 Node.js / Go 云效预置模板数据。
- [x] T2：模板创建请求带入差异化功能配置。
- [x] T3：本地执行器支持 Go 构建运行时。
- [x] T4：模板卡片流程图改为云效式并行汇聚样式。
- [x] T5：类型检查与构建验证。
- [x] T6：审查剩余 UI / 架构风险。

## 变更日志

- 新增 Node.js · ECS/主机部署、Node.js · React OSS、Go · 测试构建、Go · 构建镜像模板。
- 模板模型新增语言、流程分组、构建配置、服务连接、变量、缓存和设置摘要。
- 创建流水线时根据模板语言和部署方式生成真实配置。
- `PipelineBuildConfig` 新增 `runtime`，并通过 API DTO、snapshot、lifecycle、local-docker 执行链路传递。
- 模板弹窗改为更接近云效截图的浅色预置模板卡片。

## 验证

- 通过：`pnpm --filter @deploy-management/shared check`
- 通过：`pnpm --filter @deploy-management/shared build`
- 通过：`pnpm --filter @deploy-management/api check`
- 通过：`pnpm --filter @deploy-management/web check`
- 通过：`pnpm --filter @deploy-management/api build`
- 通过：`pnpm --filter @deploy-management/web build`

## 审查结果

- Go 模板已经有执行链路，但目前默认入口是 `go build -o bin/application .`。多 main package 的 Go 仓库后续需要在配置页继续暴露 `Go build package` 字段。
- OSS / ECS / ACK 模板已经在流水线定义层带入服务连接和变量，但真实上传 OSS、ECS 主机部署仍由当前发布适配器抽象承接；后续可继续拆专门 executor adapter。
- 模板市场已按云效浅色预置卡片还原；主系统仍保留 Dark Veil 控制台风格，两者通过弹窗边界隔离。

## 复利记录

- 模板不能只做静态 UI。模板数据必须同时携带流程图、构建配置、变量、服务连接、缓存和执行器 runtime，否则创建后会出现“看起来是 Go / ACK / OSS，实际运行仍是 Node.js 默认链路”的断层。
