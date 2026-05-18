# 部署管理 CI/CD 平台

按 Tekton 生命周期组织的企业 CI/CD 控制面：NestJS API + Next.js 控制台 + Go Tekton bridge。
对外保留云效 OpenAPI 风格 (`/oapi/v1/flow/*`) 与平台原生 (`/api/*`) 双路由。

## 仓库结构

```text
apps/
  api/                NestJS 控制面（modular）
    src/
      common/         ApiResponse 信封 / zod pipe / 本地持久化 Repository / seed-data
      lifecycle/      LifecycleEngine + ExecutorAdapter 端口
      executors/      SimulatedExecutor（默认）+ TektonBridgeExecutor（HTTP）
      pipelines/ runs/ applications/ code-repos/
      approvals/ environments/ runners/ artifacts/ audit/
      snapshot/       聚合 GET /api/snapshot
  web/
    app/
      layout.tsx                      SnapshotProvider 注入
      page.tsx                        landing
      pipelines/page.tsx              list
      pipelines/[id]/page.tsx         detail
      pipelines/[id]/edit/page.tsx    config
      runs/[runId]/page.tsx           run detail
      ui/{components,layouts,sections,data}
      lib/{env,api,actions,snapshot-context}
packages/
  shared/             平台 + 云效 + Tekton 三层类型 + 映射函数
services/
  tekton-bridge/      Go 服务（chi）
    cmd/server/       main + 默认/Tekton backend 选择
    internal/{api,backend,domain}/
docs/
  plans/              历史 sprint 文档
```

## 本地运行

```bash
# 1. 安装依赖
pnpm install

# 2. 三个进程
pnpm dev:api                                    # http://127.0.0.1:4000
(cd services/tekton-bridge && go run ./cmd/server)  # http://127.0.0.1:5050
pnpm dev:web                                    # http://127.0.0.1:3000

# 本机真实构建/推送，不依赖 Kubernetes
pnpm dev:api:local-docker
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `EXECUTOR` | `simulated` | Nest 选择执行器：`simulated` \| `tekton` \| `local-docker` |
| `KUBERNETES_ENABLED` | `false` | 本地/k8s 能力开关；只有设为 `true` 或 `EXECUTOR=tekton` 时 API 才会请求 Tekton bridge |
| `TEKTON_BRIDGE_URL` | `http://127.0.0.1:5050` | Tekton 模式下 Nest 调用 bridge 的地址 |
| `TEKTON_ALLOW_SIMULATED_FALLBACK` | `false` | 仅显式设为 `true` 时允许 Tekton bridge 不可达后退回模拟执行；生产/真实打包必须保持关闭 |
| `DEPLOYMENT_STORAGE` | `json` | 控制面持久化后端：默认本地 JSON；设为 `supabase` 后使用 Supabase PostgreSQL |
| `DEPLOYMENT_DATA_DIR` | `.deploy-data` | Nest 控制面本地持久化目录，用于保存 pipeline / run / artifact / release / audit 等状态 |
| `SUPABASE_URL` | (空) | `DEPLOYMENT_STORAGE=supabase` 时必填；当前项目地址为 `https://br-ideal-fawn-814db5fc.supabase.aidap-global.cn-beijing.volces.com:443` |
| `SUPABASE_SERVICE_ROLE_KEY` | (空) | `DEPLOYMENT_STORAGE=supabase` 时必填，只能放 API 服务端环境变量，不能暴露给 Web |
| `SUPABASE_SCHEMA` | `public` | Supabase PostgREST schema |
| `CONTROL_PLANE_AUTH_REQUIRED` | `false` | 设为 `true` 后写操作和受保护读操作必须携带控制面令牌；生产环境即使未设置也会按启用处理 |
| `CONTROL_PLANE_API_TOKEN` | (空) | 控制面 Bearer token / `x-control-plane-token`，只放 API 服务端和可信调用方 |
| `CONTROL_PLANE_JWT_SECRET` | (空) | 可选 HS256 JWT secret；Bearer JWT 校验通过后从 `role` / `app_metadata.role` / `user_metadata.role` 提取角色 |
| `CONTROL_PLANE_DEFAULT_ROLE` | `admin` | 令牌通过后的默认角色：`admin` / `member` / `viewer`；请求头 `x-devops-role` 只能降级不能提权 |
| `WEBHOOK_SECRET` | (空) | 通用 webhook secret；GitHub/GitLab/GitCode 专用 secret 或 pipeline 专用 secret 优先 |
| `GITHUB_WEBHOOK_SECRET` / `GITLAB_WEBHOOK_SECRET` / `GITCODE_WEBHOOK_SECRET` | (空) | Provider 级 webhook secret；分别校验 GitHub HMAC、GitLab token、GitCode/Gitee token 或 HMAC |
| `PIPELINE_WEBHOOK_SECRET_<PIPELINE_ID>` | (空) | Pipeline 级 secret；`pipelineId` 转大写并把非字母数字替换为 `_` |
| `WEB_ORIGIN` | (空) | Nest CORS allowlist (逗号分隔)；空则关闭 CORS |
| `GITHUB_TOKEN` | (空) | 可选，私有 GitHub 仓库拉取分支 / Tag / Commit 时使用 |
| `GITLAB_TOKEN` | (空) | 可选，私有 GitLab 或自建 GitLab 仓库拉取分支 / Tag / Commit 时使用 |
| `GITCODE_TOKEN` | (空) | 可选，GitCode OpenAPI 拉取分支 / Tag / Commit 时使用 |
| `TEKTON_BRIDGE_ADDR` | `:5050` | bridge 监听地址 |
| `TEKTON_BRIDGE_BACKEND` | `tekton` with `-tags tekton`; otherwise `simulated` | 只有明确演示假流程时才设置为 `simulated`；正式流程不能使用模拟后端 |
| `TEKTON_BRIDGE_ALLOWED_ORIGINS` | (空) | bridge CORS allowlist；空则关闭 CORS |
| `TEKTON_BRIDGE_NAMESPACE` | `default` | Tekton 模式下的 k8s namespace |
| `TEKTON_PIPELINE_REF` | (空) | 指向集群中已有 Pipeline；为空时 bridge 生成 inline `pipelineSpec` |
| `TEKTON_SOURCE_PVC` | (空) | inline `pipelineSpec` 真实 checkout + 镜像构建所需的 `source-ws` PVC |
| `TEKTON_DOCKER_SECRET` | `aliyun-acr-deploy-secret` 可选兜底 | 真实上传镜像时挂载为 `docker-config` workspace，供 `docker push` 读取 registry 凭据；流水线配置里的 `REGISTRY_DOCKER_SECRET` 优先 |
| `TEKTON_SERVICE_ACCOUNT` | (空) | Tekton preflight 检查的运行 ServiceAccount；为空时提示将使用 namespace 默认 ServiceAccount |
| `TEKTON_BUILD_STRATEGY` | `dind` | Tekton 镜像构建策略：当前落地 `dind`，后续可扩展 `kaniko` / `buildkit` / `buildpacks` |
| `TEKTON_NODE_BUILD_IMAGE` | `node:20-alpine` | 执行 package.json 打包脚本的镜像，可替换成内网镜像 |
| `TEKTON_DOCKER_CLI_IMAGE` | `docker:27-cli` | 执行 `docker build` / `docker push` 的镜像 |
| `TEKTON_DOCKER_DIND_IMAGE` | `docker:27-dind` | Docker daemon sidecar 镜像，Tekton namespace 需允许 privileged sidecar |
| `LOCAL_DOCKER_WORKDIR` | `.codex-tmp/local-docker-runs` | `EXECUTOR=local-docker` 时的真实 checkout / package build 工作目录 |
| `LOCAL_DOCKER_COMMAND_TIMEOUT_MS` | `900000` | local-docker 每条 git / package manager / docker 命令的超时时间，避免构建或上传长期卡死 |
| `ACR_USERNAME` / `ALIYUN_ACR_USERNAME` | (空) | `EXECUTOR=local-docker` 时执行 `docker login` 的 ACR 用户名；流水线 `REGISTRY_USERNAME` 优先 |
| `ACR_PASSWORD` / `ALIYUN_ACR_PASSWORD` | (空) | `EXECUTOR=local-docker` 时执行 `docker login --password-stdin` 的 ACR 固定密码，不要提交到仓库 |
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:4000` | web build-time 注入的 API base |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_ANON_KEY` | (空) | 后续接入 Supabase 时可作为公开客户端配置进入前端构建参数；推荐优先使用 publishable key |
| `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_URL` | (空) | 仅用于后端服务、迁移或部署期 Secret，不能进入前端包或 Docker build args |

## API 概览

平台原生（前端使用，最稳定）：

- `GET /api/snapshot` — 聚合读
- `GET /api/lifecycle` — 阶段定义
- `GET /api/tekton/capabilities` / `GET /api/kubernetes/capabilities` — 读取 bridge 观测到的 Kubernetes/Tekton 能力与缺失项
- `POST /api/tekton/preflight` / `POST /api/kubernetes/preflight` — 创建 PipelineRun 前做 namespace、CRD、PVC、Secret、ServiceAccount、运行参数检查
- `GET /api/storage/health` — 检查当前控制面存储后端，本地 JSON 或 Supabase 迁移/连接状态
- `POST /api/repositories/resolve` — 根据 GitHub/GitLab/GitCode 仓库地址解析 provider、默认分支、分支和 Tag
- `POST /api/repositories/refs` — 根据仓库地址与 `refType=branch|tag` 拉取远程 refs，支持 `page` / `perPage` / `search`
- `POST /api/webhooks/:provider/pipelines/:pipelineId` — 接收 GitHub / GitLab / GitCode / generic webhook，校验签名或 token、delivery 去重后触发流水线
- `GET/POST /api/pipelines` — 流水线 CRUD
- `POST /api/pipelines/:id/trigger` — 触发运行
- `GET /api/runs[/:id[/logs]]` — 运行查询
- `GET /api/runs/:id/events` / `GET /api/runs/:id/events/stream` — 读取持久化运行事件或订阅 SSE 实时事件
- `GET /api/release-plans` / `GET /api/release-executions` / `GET /api/release-events` — 读取上线计划、上线执行和灰度事件记录
- `GET /api/releases/:id/events` — 读取某次上线的完整灰度/部署事件流
- `GET/POST /api/deployment-targets` / `POST /api/deployment-targets/:id/preflight` — 管理上线目标并做 Supabase 可持久化预检
- `GET /api/environment-locks` — 查看同应用同环境的上线锁状态
- `GET /api/tekton/runs/:id/taskruns/:taskRunName` — 读取真实 TaskRun 详情、steps、results 和关联事件
- `GET /api/tekton/runs/:id/taskruns/:taskRunName/logs?step=<step>` — 读取真实 Pod step container 日志
- `POST /api/runs/:id/{cancel,promote}` — 运行操作
- `POST /api/approvals/:id/:decision` — 审批

云效风格（OpenAPI 对接，`ApiResponse<T>` 信封）：

- `GET /oapi/v1/flow/{snapshot,lifecycle,applications,repositories,environments,runnerPools,artifacts,auditEvents}`
- `GET/POST /oapi/v1/flow/pipelines`
- `GET /oapi/v1/flow/pipelines/:id`
- `GET/POST /oapi/v1/flow/pipelines/:id/runs` （body 接受 `StartPipelineRunParams`：`runningBranchs`/`runningTags`/`envs`/`comment`）
- `GET /oapi/v1/flow/pipelineRuns[/:id]`
- `POST /oapi/v1/flow/pipelineRuns/:id/{cancel,promote}`
- `POST /oapi/v1/flow/approvals/:id/:decision`
- `POST /oapi/v1/flow/webhooks/:provider/pipelines/:pipelineId`

## Tekton bridge

- 默认无 build tag 时为 `SimulatedBackend`（仅本地 dev / 流程演示）；通过 `go build -tags tekton ./...` 启用后默认就是 `TektonBackend`。
- `TektonBackend` 调用 `tektoncd/pipeline` 创建真实 `PipelineRun` CRD，并从 PipelineRun / TaskRun 状态实时回写运行详情；API 会先检查 bridge `/healthz`，如果返回 `backend=simulated` 会直接拒绝真实打包/上传。
- 本地默认不假设 Kubernetes 可用：`EXECUTOR=local-docker` 时 `/api/kubernetes/capabilities` 会返回 `kubernetes.local-disabled`，运行详情也不会请求 `127.0.0.1:5050` 的 Tekton bridge。只有 `EXECUTOR=tekton` 或 `KUBERNETES_ENABLED=true` 才会进入 k8s/Tekton 检查。
- 真实打包必须使用 `EXECUTOR=tekton` 或 `EXECUTOR=local-docker`；默认 `simulated` 只用于流程演示，不再生成可复制的真实镜像产物，避免把模拟结果误当成已经推送到 registry 的镜像。
- 如果本机 Kubernetes 不可用，可以使用 `EXECUTOR=local-docker`：API 进程会在本机直接执行 `git clone`、`pnpm/npm/yarn run <packageBuildScript>`、`docker build`、`docker login`、`docker push`，不需要 Kubernetes namespace / PVC / Secret，但需要本机 Docker daemon 可用，并通过 `ACR_PASSWORD` 等环境变量提供 registry 密码。
- 触发包含 `build` / `upload` 的真实流水线时会先做前置校验：缺少 `EXECUTOR=tekton`、`TEKTON_SOURCE_PVC`、package.json 打包脚本、真实产物目录、镜像 registry/namespace/name/tag、Dockerfile/context、或 docker-registry Secret 时，API 会直接返回缺失项，不再进入假成功流程。
- 控制面会把 pipeline、run、artifact、release、approval、audit 等状态落盘到 `DEPLOYMENT_DATA_DIR`，并使用稳定随机 ID，避免 API 重启后复用 `run-1` / `artifact-1` 这类旧编号。
- 如果要接入 Supabase，先在 Supabase SQL Editor 执行 `supabase/migrations/20260518_domain_storage_tables.sql`，再设置 `DEPLOYMENT_STORAGE=supabase`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`。已有 `.deploy-data/*.json` 时先用 PowerShell 执行 `$env:DRY_RUN="true"; pnpm migrate:storage:supabase` 检查记录数量，再清掉 `DRY_RUN` 并执行 `pnpm migrate:storage:supabase` 一次性迁移。service role key 只给 Nest API 使用，不进入 Next.js 前端。旧的 `20260514_deployment_records.sql` / `20260518_release_records_indexes.sql` 只保留给已经试运行过的通用 JSONB 单表迁移做兼容参考。
- Supabase 模式会按业务域写入不同表：`dm_applications`、`dm_source_repositories`、`dm_pipelines`、`dm_pipeline_runs`、`dm_run_events`、`dm_artifacts`、`dm_releases`、`dm_deployment_targets`、`dm_environment_locks`、`dm_release_plans`、`dm_release_executions`、`dm_release_events`、`dm_approvals`、`dm_webhook_deliveries`、`dm_audit_events`、`dm_environments`、`dm_runner_pools`。Webhook 去重、灰度推进、暂停、恢复、全量、回滚、失败都会生成独立业务记录。
- 控制面 RBAC 是最小角色模型：`viewer` 可读，`member` 可触发运行、审批、上线、预检和修改配置，`admin` 额外允许删除流水线。默认本地开发不强制 token；生产或 `CONTROL_PLANE_AUTH_REQUIRED=true` 必须携带 `Authorization: Bearer <CONTROL_PLANE_API_TOKEN>`、`x-control-plane-token`，或由 `CONTROL_PLANE_JWT_SECRET` 校验通过的 HS256 JWT。
- API 启动时会向上查找并加载 `.env`；已有 shell 环境变量优先级更高，不会被 `.env` 覆盖。`.env` 已在 `.gitignore` 中，适合放本机 service role key。
- 真实打包/上传会在创建 run 前解析分支或 Tag 对应的真实 commit；如果 provider 暂不支持或 GitCode 缺少令牌，会直接报错要求补充 commit/token，不再用随机 commit 生成镜像 Tag。
- inline 正式流程按顺序执行：`git clone/checkout` → `pnpm/npm/yarn run <packageBuildScript>` → `docker build` → `docker push`，并把 registry 返回的 digest 回写为真实镜像产物。
- 镜像上传不再使用固定占位仓库：流水线配置里的 `imageArtifact.registryProvider / registryUrl / namespace / imageName / tagTemplate` 会解析为 `REGISTRY_PROVIDER` 和 `IMAGE_REF`，传给 Tekton；inline 上传任务使用 Docker CLI + DinD sidecar 将镜像推送到该完整地址。Tekton namespace 需要允许 privileged sidecar。
- 镜像托管是 preset 配置模式：当前支持 `aliyun-acr`、`harbor`、`docker-hub`、`tencent-tcr`、`aws-ecr`、`custom`；后续新增镜像托管时在 shared preset 中补默认 registry、secret、service connection 即可接入 UI 和运行参数。
- 默认接入阿里云 ACR：`crpi-yjy3pqx1wqed2s2s.cn-hangzhou.personal.cr.aliyuncs.com/company_sy/deploy`，VPC 内网地址为 `crpi-yjy3pqx1wqed2s2s-vpc.cn-hangzhou.personal.cr.aliyuncs.com`。
- 在 Tekton namespace 中创建 docker-registry Secret 后即可真实推送；密码使用阿里云 Container Registry 的访问凭证密码，不是控制台登录密码：
  `kubectl -n <namespace> create secret docker-registry aliyun-acr-deploy-secret --docker-server=crpi-yjy3pqx1wqed2s2s.cn-hangzhou.personal.cr.aliyuncs.com --docker-username=songyu19960525 --docker-password=<ACR 登录密码> --dry-run=client -o yaml | kubectl apply -f -`
- 触发上传前 Tekton bridge 会检查 Secret 是否存在、类型是否为 `kubernetes.io/dockerconfigjson` / `kubernetes.io/dockercfg`，否则直接返回包含创建命令的错误信息，避免 PipelineRun 跑到上传阶段才失败。
- 本机无 Kubernetes 的最小真实上传配置示例：
  ```powershell
  $env:EXECUTOR = "local-docker"
  $env:ACR_USERNAME = "songyu19960525"
  $env:ACR_PASSWORD = "<ACR 固定密码>"
  pnpm dev:api
  ```
  然后保持 Web 使用同一个 API，运行流水线即可在本机执行真实 `docker build` / `docker push`。
- 也可以直接运行本机封装脚本；它会设置 `EXECUTOR=local-docker`、默认 ACR 用户名和本机工作目录，若没有检测到 ACR 密码环境变量，会在启动时提示输入：
  ```powershell
  pnpm dev:api:local-docker
  ```
- `dev:api:local-docker` 会优先读取当前 shell、项目 `.env`、Windows 用户/机器级环境变量；缺少 ACR 密码时会直接报错并提示设置环境变量，不再交互式输入密码。
- 这条本机路径是第一版落地方式。服务器部署时不要依赖服务器本地 Docker 长期构建，建议切换到 `EXECUTOR=tekton` 指向 ACK/Tekton，或后续新增独立 Runner/BuildKit 执行器；流水线侧仍复用同一套 `imageArtifact` 和 `buildConfig` 配置。
- 默认打包产物路径同时覆盖单应用与 monorepo：`.next`、`dist`、`build`、`out`、`apps/web/.next`、`apps/api/dist`、`packages/shared/dist`。这保证根目录 `pnpm build` 能同时把前端 Next 产物和后端 Nest dist 纳入资源包。
- Supabase 作为后续扩展被划分成两类变量：公开配置（URL、publishable/anon key）可进入前端构建；后端 secret、service role、DB URL 只允许作为部署期/运行期 Secret，不会被本地 Docker 执行器自动转成 build arg。
- HTTP 表面：
  - `GET  /healthz`
  - `GET  /v1/capabilities`
  - `POST /v1/preflight`
  - `POST /v1/runs` （body = `StartRunInput`，1 MiB 限额，stages ≤ 64）
  - `GET  /v1/runs/:id`
  - `POST /v1/runs/:id/cancel`
  - `GET  /v1/runs/:id/events` (SSE)
  - `GET  /v1/runs/:id/taskruns/:taskRunName`
  - `GET  /v1/runs/:id/taskruns/:taskRunName/logs?step=<step>`

## 文档入口

- [云效对标 + Tekton(Go) 接入 + 架构重构（本 sprint）](docs/plans/2026-05-09-yunxiao-tekton-architecture-overhaul.md)
- [全链路完成审计与 Supabase 扩展边界](docs/plans/2026-05-13-full-chain-completion-audit.md)
- [当前项目架构审计与完整解决方案](docs/plans/2026-05-14-project-architecture-audit.md)
- [Kubernetes 与 Tekton 深度接入方案](docs/plans/2026-05-14-k8s-tekton-deep-integration.md)
- [云效流水线功能与视觉一致性优化](docs/plans/2026-05-08-yunxiao-pipeline-parity.md)
- [Nest + Next 完整 CI/CD 平台骨架](docs/plans/2026-05-08-nest-next-cicd-platform.md)
- [Tekton CI/CD 架构分析与重实现方案](docs/plans/2026-05-08-tekton-cicd-architecture.md)
