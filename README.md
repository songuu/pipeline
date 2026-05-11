# 部署管理 CI/CD 平台

按 Tekton 生命周期组织的企业 CI/CD 控制面：NestJS API + Next.js 控制台 + Go Tekton bridge。
对外保留云效 OpenAPI 风格 (`/oapi/v1/flow/*`) 与平台原生 (`/api/*`) 双路由。

## 仓库结构

```text
apps/
  api/                NestJS 控制面（modular）
    src/
      common/         ApiResponse 信封 / zod pipe / InMemoryRepository / seed-data
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
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `EXECUTOR` | `simulated` | Nest 选择执行器：`simulated` \| `tekton` |
| `TEKTON_BRIDGE_URL` | `http://127.0.0.1:5050` | Tekton 模式下 Nest 调用 bridge 的地址 |
| `WEB_ORIGIN` | (空) | Nest CORS allowlist (逗号分隔)；空则关闭 CORS |
| `TEKTON_BRIDGE_ADDR` | `:5050` | bridge 监听地址 |
| `TEKTON_BRIDGE_ALLOWED_ORIGINS` | (空) | bridge CORS allowlist；空则关闭 CORS |
| `TEKTON_BRIDGE_NAMESPACE` | `default` | Tekton 模式下的 k8s namespace |
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:4000` | web build-time 注入的 API base |

## API 概览

平台原生（前端使用，最稳定）：

- `GET /api/snapshot` — 聚合读
- `GET /api/lifecycle` — 阶段定义
- `GET/POST /api/pipelines` — 流水线 CRUD
- `POST /api/pipelines/:id/trigger` — 触发运行
- `GET /api/runs[/:id[/logs]]` — 运行查询
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

## Tekton bridge

- 默认 `SimulatedBackend`（无需 k8s）：本地 dev 友好，按阶段时间倒计推进。
- `TektonBackend` 通过 `go build -tags tekton ./...` 启用，调用 `tektoncd/pipeline` 创建 `PipelineRun` CRD（本 sprint 为占位，实现见下个 sprint）。
- HTTP 表面：
  - `GET  /healthz`
  - `POST /v1/runs` （body = `StartRunInput`，1 MiB 限额，stages ≤ 64）
  - `GET  /v1/runs/:id`
  - `POST /v1/runs/:id/cancel`
  - `GET  /v1/runs/:id/events` (SSE)

## 文档入口

- [云效对标 + Tekton(Go) 接入 + 架构重构（本 sprint）](docs/plans/2026-05-09-yunxiao-tekton-architecture-overhaul.md)
- [云效流水线功能与视觉一致性优化](docs/plans/2026-05-08-yunxiao-pipeline-parity.md)
- [Nest + Next 完整 CI/CD 平台骨架](docs/plans/2026-05-08-nest-next-cicd-platform.md)
- [Tekton CI/CD 架构分析与重实现方案](docs/plans/2026-05-08-tekton-cicd-architecture.md)
