---
title: "Full Chain Completion Audit"
type: audit
status: completed
created: "2026-05-13"
updated: "2026-05-13"
tags: [audit, cicd, docker, tekton, yunxiao, supabase]
---

# Full Chain Completion Audit

## Objective

检查并补齐完整 CI/CD 发版链路：拉取代码、前端/后端资源打包、Docker 构建、Docker 上传、本地上传、阿里云 ACR 或其他云厂商上传、发版灰度，并按云效与 Tekton 的架构思路保留后续 Supabase 接入位置。

## Prompt-to-artifact checklist

| 需求 | 当前证据 | 结论 |
|---|---|---|
| 拉取代码 | `apps/api/src/code-repos/code-repos.service.ts` 支持 GitHub/GitLab/GitCode refs；`LocalDockerExecutor.checkoutSource` 执行 `git clone`/`checkout`；`TektonBackend.inlineSourceTask` 创建 git clone task | 已实现 |
| 前端/后端资源打包 | `DEFAULT_PIPELINE_BUILD_CONFIG.packageOutputPaths` 覆盖 `.next`、`dist`、`apps/web/.next`、`apps/api/dist`、`packages/shared/dist`；local-docker 与 Tekton build task 都要求 `PACKAGE_BUILD_SCRIPT` 和真实输出目录 | 已补齐 |
| Docker 构建 | `LocalDockerExecutor.dockerBuildAndPush` 执行 `docker build`；`TektonBackend.inlineImageUploadTask` 使用 `docker:27-cli` + `docker:27-dind` 执行 build | 已实现 |
| Docker 上传 | local-docker 执行 `docker push` 并解析 digest；Tekton 上传 task 写 `image-digest` result | 已实现 |
| 本地上传 | `EXECUTOR=local-docker` 与 `scripts/dev-api-local-docker.ps1` 启动本地真实执行器；脚本读取环境变量或交互输入 registry 密码，不再写死凭据 | 已补齐 |
| 阿里云/其他云厂商上传 | `IMAGE_REGISTRY_PRESETS` 支持 `aliyun-acr`、`harbor`、`docker-hub`、`tencent-tcr`、`aws-ecr`、`custom`；默认 ACR deploy 仓库已配置；README 包含 Secret 创建命令 | 已实现 |
| 发版灰度 | `LIFECYCLE_STAGES` 包含 `canary`、`approval`、`promote`；`RunsService` 支持审批与 promote；UI 运行配置支持灰度百分比 | 已实现 |
| 参考云效 | `/oapi/v1/flow/*` 双路由、`PipelineRunInstance`、`StartPipelineRunParams.runningBranchs/runningTags` 等云效形态保留；UI 使用云效 Flow 信息结构 | 已实现 |
| 参考 Tekton | Go `services/tekton-bridge` 支持 `PipelineRun` 创建、TaskRun 状态回写、Workspaces、params、SSE events；Nest 通过 `ExecutorAdapter` 切换 simulated/tekton/local-docker | 已实现 |
| Supabase 后续接入 | 公开 Supabase key 可作为构建变量，secret/service role/DB URL 明确只能后端或部署期注入；文档记录边界，避免 secret 被打进前端包或镜像 build args | 已补齐 |

## Architecture boundary

当前架构分三层：

1. **控制面**：NestJS API 管理 pipeline、run、approval、artifact、snapshot，并保留云效 OpenAPI 风格路由。
2. **执行面**：`ExecutorAdapter` 选择 `simulated`、`local-docker` 或 `tekton`。真实打包/上传只能走 `local-docker` 或 `tekton`，并且禁止 Tekton 模拟 fallback。
3. **执行内核**：本地 Docker 用 Node 子进程执行 Git/package/Docker；生产推荐 Go Tekton bridge 创建 Kubernetes `PipelineRun`。

## Supabase extension plan

后续接入 Supabase 不应直接替换当前 Repository 端口，而应按以下顺序演进：

1. **数据持久化**：新增 `PersistenceModule`，把现有 in-memory repositories 替换成 Supabase Postgres adapter，保留服务层接口不变。
2. **认证与 RLS**：平台账号、组织、项目权限进入 Supabase Auth / Postgres RLS；控制面 API 仍作为三层架构的业务门面。
3. **公开配置**：前端只注入 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / legacy anon key。
4. **后端 Secret**：`SUPABASE_SECRET_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_DB_URL` 只能放后端运行环境、Kubernetes Secret、Tekton workspace 或迁移任务，不进入浏览器包和 Docker build args。
5. **制品与审计**：Supabase Storage 可作为日志、报告、SBOM、provenance 的长期存储，但不可替代 ACR/OCI registry 的镜像托管。

## External reference anchors

- Tekton `PipelineRun` 会在集群中实例化 Pipeline，并为 Pipeline 里的 Task 自动创建对应 TaskRun；`status` 可用于执行审计：https://tekton.dev/docs/pipelines/pipelineruns/
- Tekton Workspaces 用于在 Task/PipelineRun 间传递源代码、输出、凭据和配置：https://tekton.dev/docs/pipelines/workspaces/
- 阿里云 ACR Docker 登录使用独立 registry 访问凭证，不应使用控制台登录密码：https://www.alibabacloud.com/help/en/acr/support/faq-about-errors-of-docker-login-docker-push-and-docker-pull
- Supabase 推荐公开 publishable key 用于浏览器/客户端，secret key 只用于受控后端组件：https://supabase.com/docs/guides/api/api-keys

## Verification commands

- `rg -n 'songyu\\.\\.520|ACR_PASSWORD\\s*=\\s*"[^<]' -g '!*tsbuildinfo' .` -> no matches.
- `pnpm check` -> passed with elevated permission after sandbox `spawn EPERM`.
- `pnpm build` -> passed with elevated permission after sandbox `spawn EPERM` / `.next` EPERM.
- `pnpm --filter @deploy-management/shared check` -> passed.
- `pnpm --filter @deploy-management/api check` -> passed.
- `pnpm --filter @deploy-management/web check` -> passed.
- `pnpm --filter @deploy-management/shared build` -> passed.
- `pnpm --filter @deploy-management/api build` -> passed.
- `pnpm --filter @deploy-management/web build` -> passed with elevated permission.
- `go build ./...` -> passed with elevated permission after Go telemetry cache permission error.
- `go build -tags tekton ./...` -> passed.
- `go test -tags tekton ./...` -> passed.
- Dist API smoke: start `node apps/api/dist/main.js`, request `GET http://127.0.0.1:4000/api/snapshot`, receive 200 JSON, then stop the process.
- `docker version --format '{{.Server.Version}}'` -> Docker daemon reachable with server `29.2.1` after elevated permission.
