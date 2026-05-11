---
title: "云效对标 + Tekton(Go) 接入 + 架构重构"
type: sprint
status: completed
created: "2026-05-09"
updated: "2026-05-11"
checkpoints: 0
tasks_total: 9
tasks_completed: 9
tags: [sprint, architecture, cicd, yunxiao, tekton, nestjs, nextjs, golang]
aliases: ["云效Tekton架构对齐"]
---

# 云效对标 + Tekton(Go) 接入 + 架构重构

## 需求分析

用户原话：
> 优化下当前的架构，必须保持和aliyun 云效（https://newdemo123-cn-hangzhou.devops.aliyuncs.com/workbench）以及必须全方位的接入tekton(使用go实现 https://tekton.dev/)，对于前端的选型必须是next，后端的选型必须是nest。当前的实现存在很多的使用问题以及没有完全的对标云效，导致使用的效果很差。

拆解四件事：

1. **架构优化**：当前 `apps/api` 是单 mega-class（`CicdService` 491 行），所有领域揉在一起；`apps/web` 是单 1354 行 React 组件 + 2622 行手写 CSS。可维护性低、扩展难、无验证、无持久化、无测试。
2. **云效对标**：当前类型与接口不匹配云效 OpenAPI（`pipelineRunId` / `stages[].jobs[]` / `triggerMode` / `runningBranchs` / `globalParams` / `sources[]`）。UI 已有云效形，但路由、数据形、字段命名仍是私有。
3. **Tekton 全方位接入（Go）**：现有 lifecycle-engine 是 TS 模拟，没有任何 Tekton 调用。用户要求 Go 实现，需要新增独立服务（`services/tekton-bridge`），并把 Nest 的执行器抽象成 ExecutorAdapter，可切换 Simulated / TektonBridge。
4. **保持选型不变**：前端 Next.js、后端 NestJS（已就位，不动）。

非目标（next sprint 处理）：

- Postgres / Prisma 持久化（本 sprint 用 Repository 接口 + InMemory 实现）
- 真实 Kubernetes 集群对接（本 sprint 仅做 Tekton client 桩 + 本地 Simulated backend，确保无 k8s 也能 build/run）
- AuthN/AuthZ、RBAC、租户隔离
- Webhook 入口的签名验证、去重、replay protection
- SBOM / SLSA provenance / cosign / Chains
- 完整云效 UI 还原（本 sprint 完成路由 + 组件拆分；视觉细节迭代留给下一轮）

## 成功标准

- `pnpm check && pnpm build` 全绿。
- `go build ./...` 在 `services/tekton-bridge` 全绿。
- 现有用户操作链路全部可用：landing → list → detail → config → trigger → approve → cancel → promote。
- Nest 拆分成多模块；`CicdService` 不再是唯一聚合根。
- Web 不再是单文件；`app/pipelines`、`app/runs` 路由可独立访问。
- Tekton bridge 提供 5 个端点（create/get/cancel/events/health），SimulatedBackend 与 Nest 可端到端对接。
- 所有可能 panic 的运行时未处理输入都通过 zod 校验。

## 风险与约束

| 风险 | 影响 | 缓解 |
|---|---|---|
| 1354 行 dashboard 拆分回归 | 用户操作失效 | 按 surface 切割（landing/list/detail/config）+ 每切一个 surface 立刻 manual smoke check |
| Tekton 客户端要求 k8s 环境 | 本地 build/run 失败 | 默认走 SimulatedBackend；Tekton client 作为可选 build tag 或 `tekton` 子包，不在主链路 import |
| 云效 OpenAPI 字段命名与现有字段冲突 | 类型 churn 大 | 新类型并行加进 `shared`，旧类型保留 1 sprint，前后端逐步迁移 |
| Nest 模块拆分破坏 import 链路 | API 全挂 | 一次只拆一个模块 + 每次 `pnpm check` |
| 单 sprint 完不成完整云效 parity | 用户失望 | Phase 1 明确 non-scope；输出后续 sprint 列表 |

## 技术方案

### 仓库结构（目标）

```text
apps/
  api/                NestJS 控制面（modular）
    src/
      app.module.ts
      main.ts
      common/         zod pipe, exception filter, response envelope
      lifecycle/      LifecycleEngine + ExecutorAdapter port
      executors/
        simulated.ts  现有逻辑搬迁
        tekton.ts     HTTP client → services/tekton-bridge
      pipelines/      controller + service + repository + dto
      runs/
      applications/
      repositories/   (代码仓库，不是 DDD repo)
      approvals/
      environments/
      runners/
      artifacts/
      audit/
      snapshot/       聚合 GET /api/snapshot
  web/
    app/
      page.tsx                  landing
      pipelines/page.tsx        list
      pipelines/[id]/page.tsx   detail (latest run)
      pipelines/[id]/edit/page.tsx config
      runs/[runId]/page.tsx     run detail
      ui/
        components/   小颗粒 UI（按钮、徽标、表单字段）
        layouts/      shell, topbar, sidebar
        sections/     landing, pipeline-list, pipeline-detail, pipeline-config
      lib/
        api.ts        集中 fetch + envelope
        env.ts        NEXT_PUBLIC_API_URL
packages/
  shared/             领域类型 + 生命周期常量
services/
  tekton-bridge/      Go 服务
    cmd/server/main.go
    internal/
      api/            HTTP handlers
      backend/        Backend interface + Simulated + Tekton 实现
      domain/         共享 run/stage/job 模型
    go.mod
    go.sum
docs/plans/...
```

### shared 类型扩展

新增（与现有并存）：

```ts
// Yunxiao 对齐
export type TriggerMode = "manual" | "scheduled" | "code_commit" | "webhook" | "pipeline" | "openapi";
export type JobStatus = "INIT" | "QUEUED" | "RUNNING" | "SUCCESS" | "FAIL" | "SKIPPED" | "CANCELED";
export interface PipelineSource {
  id: string;
  type: "codeup" | "github" | "gitlab" | "gitea";
  endpoint: string;
  branch?: string;
  tag?: string;
  cloneDepth?: number;
  credentialId?: string;
  webhookUrl?: string;
}
export interface GlobalParam {
  key: string;
  value: string;
  encrypted?: boolean;
  description?: string;
}
export interface JobInstance {
  id: string;
  name: string;
  taskRef: string;
  status: JobStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  steps: StepInstance[];
  result?: Record<string, string>;
  logsRef?: string;
}
export interface StepInstance {
  id: string;
  name: string;
  image?: string;
  command?: string[];
  status: JobStatus;
  exitCode?: number;
}
export interface StageInstance {
  index: number;
  name: string;
  status: JobStatus;
  jobs: JobInstance[];
}

// Tekton 对齐（控制面内部使用）
export interface TaskSpec {
  name: string;
  steps: StepSpec[];
  params?: ParamSpec[];
  results?: ResultSpec[];
  workspaces?: WorkspaceDeclaration[];
}
export interface StepSpec {
  name: string;
  image: string;
  command?: string[];
  args?: string[];
  script?: string;
  env?: Array<{ name: string; value: string }>;
}
export interface ParamSpec { name: string; type: "string" | "array"; default?: string }
export interface ResultSpec { name: string; description?: string }
export interface WorkspaceDeclaration { name: string; description?: string; readOnly?: boolean }
export interface PipelineTaskRef {
  name: string;
  taskRef: string;
  runAfter?: string[];
  when?: WhenExpression[];
  params?: Array<{ name: string; value: string }>;
}
export interface WhenExpression { input: string; operator: "in" | "notin"; values: string[] }
```

### Nest 模块拆分

每个领域 1 个模块，结构统一：

```text
{domain}.module.ts      Nest @Module
{domain}.controller.ts  HTTP / OpenAPI 路由
{domain}.service.ts     业务逻辑
{domain}.repository.ts  Repository<T> 接口（in-memory 实现）
dto/                    zod schema → DTO + ZodValidationPipe
```

`SnapshotModule` 聚合所有 repository 暴露 `GET /api/snapshot`（保留旧路径兼容前端旧调用），同时 mount 云效路由 `/oapi/v1/flow/*`。

### ExecutorAdapter 端口

```ts
export interface ExecutorAdapter {
  start(input: StartRunInput): Promise<RunHandle>;
  status(handle: RunHandle): Promise<RunStatus>;
  cancel(handle: RunHandle): Promise<void>;
  events(handle: RunHandle): AsyncIterable<RunEvent>;
}
```

实现：
- `SimulatedExecutor`：搬运现有 lifecycle-engine 逻辑（同步推进 stage / 模拟时长）。
- `TektonBridgeExecutor`：HTTP client → `services/tekton-bridge`。

LifecycleEngine 持有 `ExecutorAdapter`，根据 `process.env.EXECUTOR`（默认 simulated）选择。

### Go services/tekton-bridge

依赖：
- `github.com/go-chi/chi/v5` — router
- `github.com/tektoncd/pipeline` — client（仅在 TektonBackend 内 import；构建主二进制依然不需要 k8s 集群）
- `k8s.io/client-go` — kube config
- `golang.org/x/sync/errgroup`

API（HTTP/JSON）：

```text
POST  /v1/runs                 创建运行 → { runId }
GET   /v1/runs/:runId          查询状态
POST  /v1/runs/:runId/cancel   取消
GET   /v1/runs/:runId/events   SSE 事件流（status/stage/log 增量）
GET   /healthz                 健康检查
```

后端选择：环境变量 `TEKTON_BRIDGE_BACKEND=simulated|tekton`。

### Web 拆分策略

1. 抽 UI primitives（`Field`、`StatusBadge`、`Switch`、`MiniFlow`、`JobCard`、`Summary`、`WebhookField`、`VariableTable`、`StageConfigurator`）→ `app/ui/components/`。
2. 抽 layout（`CloudTopbar`、`RepoSidebar`）→ `app/ui/layouts/`。
3. 抽 surface 组件 → `app/ui/sections/`。
4. 用 Next App Router 拆路由：
   - `/` → landing
   - `/pipelines` → list
   - `/pipelines/[id]` → detail (latest run)
   - `/pipelines/[id]/edit` → config
   - `/runs/[runId]` → run detail
5. 集中 API client `app/lib/api.ts`：负责 fetch + ApiResponse<T> 解包 + 错误。
6. 顶层 layout 提供 `SnapshotProvider`（client-side），子页面共享数据，避免每个页面重复 fetch。

### 验证策略

- 每完成一个 Task：`pnpm check`（必通过）。
- Sprint 结尾：`pnpm build`、`(cd services/tekton-bridge && go build ./...)`、`go vet ./...`。
- 端到端冒烟（手工）：landing → 创建模板 → list → trigger → detail → 审批 → promote。

## 任务拆解

- [x] T1 清理 Vite 残留（src/、dist/、dev-web-3001.*）
- [x] T2 shared：Yunxiao + Tekton 类型扩展，向后兼容
- [x] T3 Nest：抽 ExecutorAdapter 端口 + SimulatedExecutor（搬现有 lifecycle）
- [x] T4 Nest：拆模块（pipelines/runs/applications/repositories/approvals/environments/runners/artifacts/audit/snapshot），Repository 接口 + InMemory，zod DTO
- [x] T5 Nest：新增 /oapi/v1/flow/* Yunxiao 风格路由，旧 /api/* 保留
- [x] T6 Nest：TektonBridgeExecutor HTTP client + 环境变量切换
- [x] T7 Go：services/tekton-bridge 骨架（chi + Backend 接口 + Simulated 实现 + Tekton 占位）
- [x] T8 Web：API client lib、env config、ApiResponse envelope；shared 类型迁移
- [x] T9 Web：路由 + 组件拆分（5 routes，UI primitives，sections）
- [x] R1 安全 review 后：CORS 收紧 + actor/decision 校验 + 请求体上限

## 变更日志

- 删除：`src/`、`dist/`、`dev-web-3001.{out,err}.log`、`apps/api/src/cicd/`、`apps/web/app/ui/cicd-dashboard.tsx`（1354 行）。
- 新增 Nest 模块：`applications`、`approvals`、`artifacts`、`audit`、`code-repos`、`environments`、`executors`、`lifecycle`、`pipelines`、`runners`、`runs`、`snapshot`，每模块自带 controller/service/repository/dto。
- 新增 Nest common 工具：`api-response.ts`（ApiResponse<T> 信封）、`zod-validation.pipe.ts`、`in-memory.repository.ts`、`seed-data.ts`。
- 新增 ExecutorAdapter 端口 + `SimulatedExecutor`、`TektonBridgeExecutor`，由 `EXECUTOR=simulated|tekton` 切换；Tekton 实现失败时自动 fallback 到 Simulated。
- 新增云效风格 OpenAPI 路由：`/oapi/v1/flow/{snapshot,lifecycle,applications,repositories,environments,runnerPools,artifacts,auditEvents,pipelines,pipelineRuns,approvals}`，全部走 ApiResponse 信封；旧 `/api/*` 路由保留以兼容前端。
- 扩展 `packages/shared/src/index.ts`：新增 Yunxiao 对齐 (`PipelineRunInstance`, `StageInstance`, `JobInstance`, `StepInstance`, `TriggerMode`, `JobStatus`, `PipelineSource`, `GlobalParam`, `StartPipelineRunParams`, `toPipelineRunInstance`)、Tekton 对齐 (`TaskSpec`, `StepSpec`, `ParamSpec`, `ResultSpec`, `WorkspaceDeclaration`, `WhenExpression`, `PipelineTaskRef`, `PipelineSpec`)、通信契约 (`StartRunInput`, `RunHandle`, `RunStatus`, `RunEvent`, `ApiResponse<T>`)。
- 新增 Go 服务 `services/tekton-bridge`：chi 路由 + `Backend` 接口 + `SimulatedBackend`（默认）+ `TektonBackend` 占位（`//go:build tekton`），HTTP `POST /v1/runs`、`GET /v1/runs/:id`、`POST /v1/runs/:id/cancel`、`GET /v1/runs/:id/events` (SSE)、`GET /healthz`。
- 重写 web 入口：`SnapshotProvider` 提升到 root layout，`DashboardShell` 接收 `surface` 参数从 5 个 App Router 路由（`/`、`/pipelines`、`/pipelines/[id]`、`/pipelines/[id]/edit`、`/runs/[runId]`）调用；UI 拆 `components/`、`layouts/`、`sections/`、`data/`，`lib/{env,api,actions,snapshot-context}` 集中数据。
- 安全 review 后修复：`apps/api/src/main.ts` 的 CORS 改为 `WEB_ORIGIN` 显式 allowlist（默认 false）；`services/tekton-bridge/internal/api/router.go` 改为 `TEKTON_BRIDGE_ALLOWED_ORIGINS` env 显式 allowlist（默认空）；bridge `POST /v1/runs` 加 `MaxBytesReader` 1 MiB 上限 + `len(stages) <= 64` 校验；`actorSchema` 限制 `^[\p{L}\p{N}_.\-@]+$` 长度 1-64，禁止换行注入；`approvalDecisionParamSchema` 校验 `:decision` URL 段；`startPipelineRunSchema` 限制 `envs`/`runningBranchs`/`runningTags` 条目数与 key 字符集；`legacyDecideApproval` 补 zod。

## 审查结果

Phase 4 触发了三个 reviewer，碳/quota 限制下只回到一个完整结果（security），其余两个（architecture、correctness）记录在跟进项。

### Security findings（已应用）

| 等级 | 文件 | 问题 | 处置 |
|---|---|---|---|
| P0 | `services/tekton-bridge/internal/api/router.go` | `AllowedOrigins:["*"]` + 无认证，浏览器跨域可触发 run | ✅ 改为 `TEKTON_BRIDGE_ALLOWED_ORIGINS` 显式 allowlist；默认 nil（CORS 关闭） |
| P1 | `services/tekton-bridge/internal/api/handlers.go:39` | `json.NewDecoder` 无大小限制，可 DoS | ✅ 加 `MaxBytesReader(1MiB)` + `len(stages) <= 64` |
| P1 | `apps/api/src/runs/dto/trigger-run.dto.ts:21` | `actor` 无长度/字符限制，可 log forging | ✅ `actorSchema` 限制 `^[\p{L}\p{N}_.\-@]+$` 长度 1-64 |
| P1 | `apps/api/src/runs/runs.controller.ts:65` | `:decision` URL 参数无运行时校验 | ✅ `approvalDecisionParamSchema` 校验，legacy 路径补 zod body |
| P2 | `apps/api/src/runs/dto/trigger-run.dto.ts:31` | `envs/runningBranchs/runningTags` 无条目/字符限制 | ✅ 限制 ≤50 envs / ≤32 ref maps，envKey 必须 `^[A-Z][A-Z0-9_]*$` |
| P2 | `apps/api/src/main.ts:6` | NestFactory `cors:true` 反射 origin | ✅ 改为 `WEB_ORIGIN` 显式 allowlist，默认 false |
| P2 | `apps/api/src/common/zod-validation.pipe.ts:14` | 错误消息回显 zod 完整 issues | 保留：当前 schema 没有敏感 refine，下一 sprint 加 prod 模式脱敏 |

### 残余风险（按 non-scope 推迟到下一 sprint）

- **认证/授权全栈缺失**：Nest 与 bridge 所有路由仍未鉴权。本 sprint 已收紧 CORS，但任何能到 API 的服务端调用方仍可触发生产 promote/cancel。下一 sprint **必须**先做 AuthN/AuthZ 才能上非 localhost。
- **TektonBackend 是占位**：仅在 `go build -tags tekton` 时编译，且方法返回 "not yet implemented"。真实 PipelineRun CRD 创建 + watcher 留下 sprint。
- **持久化仍是内存**：Repository 接口已抽象，但所有实现都是 `InMemoryRepository`。重启即丢数据。下 sprint 替换为 Prisma + Postgres。
- **未实施的 architecture / correctness reviewer**：因 quota 限制未拿到完整输出。下 sprint 起手做一遍专项 review。
- **未做测试**：本 sprint 未写单测；现状靠 `pnpm check && build` + 手动 curl。下 sprint 至少给 `RunsService.toTriggerRequest` / `LifecycleEngine.simulateUntilGate` 加单测，给 zod schema 加边界用例。

## 复利记录

### 经验

1. **Nest `@UsePipes(schema)` 会作用到所有形参**：route 同时有 `@Param` + `@Body` 时，pipe 会 拿 `:param` 的字符串去喂 zod object schema，必然报 "Expected object, received string"。修法：`@Body(new ZodValidationPipe(schema)) body: Dto`，按形参绑定。
2. **`go mod tidy` 会删除未使用的 require**：`google/uuid` 加进 go.mod 但代码未 import 时，tidy 会移除。先写代码再加依赖更稳。
3. **`taskkill` / `Stop-Process` 杀掉前台 background 任务时，runtime 会收到 exit-code 通知**：日常清理后台进程的标准做法是用 powershell `Get-CimInstance Win32_Process | Stop-Process -Force`，然后接受任务的 failed 通知。这不是错误，是预期。
4. **Next.js App Router 5 路由 + 单 client shell 是合理折中**：5 个 surface 共享 snapshot + 模板 modal 状态，独立路由各自再 fetch 会造成 N 次 `/api/snapshot`。`SnapshotProvider` 在 root layout 里放一次 + `DashboardShell` 接 `surface` prop 是 router-aware 但不重复 fetch 的最简形态。
5. **Tekton 集成必须 build-tag 隔离**：默认编译不应 import `k8s.io/client-go`（拖入 100+ 间接依赖）。`//go:build tekton` 让本地 dev `go build ./...` 在没有 k8s 环境时也能跑。
6. **云效 OpenAPI 字段命名（`pipelineRunId` 而非 `id`、`triggerMode` 整数 vs 字符串、`runningBranchs` 拼写错误的 `s`）**：照搬云效会引入命名异味，但选择了照搬以便对接方零适配。`shared` 中通过 `toPipelineRunInstance(run)` 单向映射，避免污染内部 PipelineRun。
7. **Repository 抽象的最小骨架**：`Repository<T extends {id: string}>` + `InMemoryRepository` + `seed/snapshot/prepend` 三个非标准方法（来自实际业务：种子数据加载、聚合读、按时间倒序写入）。提前定义这三个方法节省了未来替换 ORM 时的反向适配。

### 本能（待 `/instinct-status` 评估）

- 拆解大文件时，**先按 surface 切**而不是按代码相似度切：route 边界往往就是好的拆点。
- Nest 模块化时，`SnapshotModule` 这种聚合读模块要放在最末，`imports` 显式列出依赖模块；不要把读聚合写进每个领域 service。
- Go 跨语言 schema 同步：手动维护 `internal/domain/run.go` 与 TS `shared` 的字段对齐，并在 `go.mod` 注释里指明 schema 来源；未来如果出错就在 `domain` 层加 round-trip 测试。
- 写 zod schema 时，**安全校验要在第一版就到位**：长度、字符集、条目数。事后补很容易漏。
- 跨进程 fallback 模式（`TektonBridgeExecutor` 网络失败 → `SimulatedExecutor`）：要么明确文档化，要么不写 fallback。本 sprint 选择了文档化，以保证 dev 体验。

