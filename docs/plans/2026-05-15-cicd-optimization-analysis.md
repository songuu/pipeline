---
title: "CI/CD 平台优化分析（Phase 1 Think 报告）"
type: sprint-audit
status: proposed
created: "2026-05-15"
updated: "2026-05-15"
tags: [audit, cicd, optimization, runner-queue, service-connection, persistence, refactor]
aliases: ["优化分析-2026-05-15", "CICD 优化清单"]
based_on:
  - "docs/plans/2026-05-14-project-architecture-audit.md"
  - "docs/plans/2026-05-13-full-chain-completion-audit.md"
  - "docs/plans/2026-05-15-gray-release-system.md"
---

# CI/CD 平台优化分析

> 本文是 `/sprint --auto` Phase 1 Think 输出，**不直接修代码**。
> 列出当前可优化项、推荐 sprint 范围、风险与不做清单，供用户挑选后进入 Phase 2 Plan。

## 1. 背景

2026-05-14 的 `project-architecture-audit` 完成了"演示型流水线 → 真实拉取/打包/Docker build/ACR push/制品中心/上线入口"的第一轮演进，并提出 5 个 P0 + 3 个 P1 缺陷。
2026-05-15 的 `gray-release-system` 已经把"上线入口"升级为带状态机的灰度发布（含批次/暂停/继续/全量/回滚）。

本轮重新对照 audit 的 8 项重点，**核对当前仓库实际状态**，形成下一阶段优化清单。

## 2. 现状对照表

| 维度 | audit 要求 | 当前状态 | 证据 |
|---|---|---|---|
| **持久化** | SQLite/PostgreSQL adapter | ⚠ 半 — 已落 JSON 文件 (`DEPLOYMENT_DATA_DIR`)；ULID 已切；**未上 SQLite/Postgres** | `apps/api/src/common/in-memory.repository.ts` 246 行 |
| **真实 commit 解析** | `Run.resolvedCommit` 唯一来源 | ✅ | provider API + git ls-remote 已接入 |
| **模拟/真实隔离** | 真实 trigger 禁用 simulate | ❌ | `lifecycle.engine.ts:103 simulateUntilGate` + `runs.service.ts:143/149/155/295` `mode === "instant"` 仍混在真实路径 |
| **Runner 队列 / 并发 / 心跳** | RunnerQueue + RunnerProfile + lease | ❌ | 全仓 0 处；多人并发会抢本地 Docker |
| **命令级超时** | 统一 timeout | ✅ | `LOCAL_DOCKER_COMMAND_TIMEOUT_MS` 已加 |
| **实时事件** | SSE / WebSocket | ✅ | `run-events.repository.ts` + SSE `/api/runs/:id/events/stream` 已接入；前端 `EventSource` 已在 `pipeline-run-detail.tsx:109` |
| **Tekton bridge informer** | 用 watch 替代轮询 | ✅ | `services/tekton-bridge/internal/backend/tekton.go` 已用 `watch.ResultChan` |
| **Tekton desired vs observed** | 拆分 + 不再合成 | ⚠ | digest 判定已修；snapshot 仍合成；前端无 desired/observed 分屏 |
| **ServiceConnection / Secret 收敛** | 凭据走 ServiceConnection | ❌ | 全仓 0 处；`process.env.*` 散落 11 个 service 文件（kubernetes 13 处、local-docker/snapshot/storage 各 6-7 处） |
| **制品/上线一等模型** | ReleasePlan/Execution/Target | ⚠ | gray-release-system 已加 `CanaryRolloutPolicy/Step` + 状态机 + 回滚锚点；**仍缺 `DeploymentTarget` 模型 + 环境锁 + 健康检查抽象** |
| **Shared 拆分** | 7 子域 | ❌ | `packages/shared/src/index.ts` 已涨到 **1389 行**；`ALIYUN_ACR_DEFAULT_IMAGE_ARTIFACT` 仍在 shared |
| **Web 配置编辑器** | 拆 6 panel | ❌ 恶化 | `pipeline-config-editor.tsx` 已涨到 **2344 行**（audit 时 2000+） |
| **TS 测试基线** | 单元/集成 | ❌ 缺位 | TS 侧 0 个 `.test.ts`；只有 Go bridge 2 个测试文件 |

## 3. 候选优化（按 impact / 可逆性排序）

### T1 — 退场 simulateUntilGate 与 instant mode

**优先级：** P0（流程边界）
**风险等级：** L2
**预计工时：** 0.5 天

**证据：**
- `apps/api/src/lifecycle/lifecycle.engine.ts:103` 的 `simulateUntilGate` 仍会在 in-memory 路径推进随机阶段
- `apps/api/src/runs/runs.service.ts` 第 143/149/155/295 行 4 处 `options.mode === "instant"` 分支
- audit P0-2 明确标记：随机 commit + simulate 会污染镜像 tag、provenance、UI 运行记录

**任务：**
1. 把 `simulateUntilGate` 改成只能在 `seed-data.ts` 的 dev seed 路径调用，并改名为 `seedRunWithCompletedStages`
2. 删除 `runs.service.ts` 的 4 处 `instant` 分支；保留对应 DTO 字段但在 controller 校验时直接拒绝
3. 真实 trigger 路径必须先调用 `resolveCommit()`，失败即报错（已实现，复核一遍）
4. dev seed 单独走 `RunsRepository.create()` + 预填充 stages，**不经过 lifecycle engine**

**验收：**
- `grep -rn "simulateUntilGate\|mode === \"instant\"" apps/api/src` 只剩 `seed-data.ts` 一处
- `POST /api/pipelines/:id/trigger` body 含 `{mode:"instant"}` 时返回 400
- 重启 API 后 dev seed run 仍可见（与现状一致）

---

### T2 — RunnerQueue + lease 心跳

**优先级：** P0（多人并发 / 重启恢复）
**风险等级：** L3
**预计工时：** 1.5 天

**证据：**
- 全仓 0 处 `RunnerQueue/RunnerProfile/runner_lease`
- audit P0-3：本地 Docker 多用户并发会抢资源；卡住的 `npm install`/`docker push` 缺统一取消；API 重启后 runner ownership 丢失
- `apps/api/src/runs/runs.service.ts:567 行` 仍用 `setTimeout` 推进，且 `liveTimers` 是进程内 Map，重启即丢

**任务：**
1. 新增 `apps/api/src/runners/queue.service.ts`：
   - `RunnerProfile`：`local-docker` / `tekton-bridge` / 后续 `remote-buildkit`
   - 并发上限：按 profile / environment / repository 分桶
   - 入队/出队：FIFO + priority（即时触发 > 定时触发）
2. 新增 `runner_leases` 持久化（沿用 `DEPLOYMENT_DATA_DIR`）：
   - `runId / runnerProfile / acquiredAt / heartbeatAt / expiresAt`
   - heartbeat 间隔 10s，expire 30s
3. `LocalDockerExecutor` 与 `TektonBridgeExecutor` 启动前必须 acquire lease，每条命令完成后 renew
4. API 启动时执行 reconciliation：
   - lease 已 expire 但 run 状态仍 `running` → 标记 `failed`（含错误说明 `runner heartbeat lost`）
   - lease 仍 valid → 重新订阅 executor events（local-docker 子进程已挂的话也标记 failed）

**验收：**
- 同时触发 5 个 local-docker run，看到 3 个 `running` + 2 个 `queued`（默认 concurrency=3）
- `kill -9` API 进程 30s 后重启，`running` run 自动转 `failed`
- 任意 stage 超过 `LOCAL_DOCKER_COMMAND_TIMEOUT_MS` 后命令被 SIGKILL，run 标记 `failed`

---

### T3 — 拆分 `pipeline-config-editor.tsx` 2344 行

**优先级：** P1（维护负担）
**风险等级：** L2（视觉回归风险高）
**预计工时：** 1.5 天

**证据：**
- `apps/web/app/ui/sections/pipeline-config-editor.tsx` **2344 行**（audit 时 2000+，已恶化）
- audit P1-3 推荐拆 `source-panel / flow-panel / trigger-panel / variables-panel / artifact-panel / release-target-panel`
- refs 拉取与状态散落在大组件里

**任务：**
1. 抽 `apps/web/app/lib/api/hooks/use-repository-refs.ts`，统一管理 branches/tags/recent commits 拉取
2. 按 audit 推荐拆 6 个 panel 文件，放到 `apps/web/app/ui/pipeline-config/`：
   - `source-panel.tsx`（仓库 + 分支/Tag）
   - `flow-panel.tsx`（阶段画布）
   - `trigger-panel.tsx`（webhook + 定时）
   - `variables-panel.tsx`（变量表）
   - `artifact-panel.tsx`（镜像 + ACR）
   - `release-target-panel.tsx`（环境 + 灰度策略）
3. `pipeline-config-editor.tsx` 收敛为路由级 layout + tab 切换器，目标 ≤ 400 行
4. **每拆一个 panel 立刻启动 `pnpm dev:web` 手测**，确认视觉零回归

**验收：**
- `wc -l apps/web/app/ui/sections/pipeline-config-editor.tsx` ≤ 400
- 6 个 panel 每个 ≤ 500 行
- 配置页所有交互（保存/触发/取消）行为不变
- `pnpm --filter @deploy-management/web check && build` 绿

---

### T4 — `shared/index.ts` 1389 行按域拆分

**优先级：** P1（领域边界）
**风险等级：** L1
**预计工时：** 0.5 天

**证据：**
- `packages/shared/src/index.ts` 1389 行，平台 + 云效 + Tekton + ACR 默认值堆一起
- audit P1-1 推荐拆 7 子域

**任务：**
1. 新建子域目录 + 文件：
   ```text
   packages/shared/src/
     platform/    Application / Pipeline / Run / Stage
     source/      Repository / Provider / Ref / Commit
     executor/    ExecutorProfile / RunEvent / StageRun / RunHandle
     registry/    ImageArtifact / RegistryProvider
     release/     ReleasePlan / ReleaseDeployment / CanaryRolloutPolicy / DeploymentTarget
     tekton/      TektonDesiredBinding / TektonObservedState / TaskSpec / PipelineSpec
     yunxiao/     PipelineRunInstance / StartPipelineRunParams + toPipelineRunInstance
     index.ts     只 re-export 公开 API
   ```
2. `ALIYUN_ACR_DEFAULT_IMAGE_ARTIFACT` 等 dev 默认值搬到 `apps/api/src/common/seed-data.ts`
3. 同步更新 `apps/api/src/**` 与 `apps/web/app/**` 的 import 路径
4. 保留 `packages/shared/src/index.ts` 作为 barrel，避免 import 路径全仓改写

**验收：**
- `wc -l packages/shared/src/*.ts` 单文件 ≤ 400
- `pnpm -r check && build` 绿
- `grep -n "ALIYUN_ACR_DEFAULT" packages/shared/src/` 0 命中

---

### T5 — ServiceConnection 抽象

**优先级：** P0（凭据收敛）
**风险等级：** L3
**预计工时：** 2 天

**证据：**
- `process.env.*` 散落 11 个 service 文件（kubernetes 13 处、local-docker 7、snapshot 7、storage 6、releases 6、code-repos/runs/tekton/executors 各 2-7）
- audit P1-2：pipeline definition 容易夹带凭据；无法按项目/环境/用户授权；服务器部署难审计

**任务：**
1. 新增 `apps/api/src/service-connections/` 模块：
   - `service-connections.module.ts`
   - `service-connections.service.ts`
   - `service-connections.controller.ts`
   - `service-connections.repository.ts`（沿用 `DEPLOYMENT_DATA_DIR`）
   - `dto/create-service-connection.dto.ts`
2. 模型：
   ```ts
   type ServiceConnection = {
     id: string;             // ULID
     name: string;
     type: "git-provider" | "registry" | "kubernetes" | "artifact-store";
     provider: "github" | "gitlab" | "gitcode" | "aliyun-acr" | "harbor" | "k8s";
     scope: { orgId?: string; projectId?: string; environment?: string };
     secretRef: { backend: "env" | "k8s-secret" | "vault" | "encrypted-file"; key: string };
     createdAt: string;
   };
   ```
3. 启动时 `apps/api/src/main.ts` 把 `.env.local` 的所有相关 key 注册成 `secretRef.backend = "env"` 的 ServiceConnection
4. 改造 `code-repos.service / local-docker.executor / kubernetes.service / releases.service / storage.service` 改为通过 `ServiceConnectionsService.resolve(id)` 取凭据
5. pipeline DTO 增加 `sourceConnectionId / registryConnectionId / deploymentConnectionId` 字段（保留旧字段 backward-compatible）

**验收：**
- 新建一条 ACR ServiceConnection → pipeline 引用 → 触发 run 能成功 push
- `grep -rn "process.env\.\(GITHUB_TOKEN\|GITLAB_TOKEN\|ACR_PASSWORD\|KUBECONFIG\)" apps/api/src` 只剩 `service-connections/*` 一处
- API 报错信息明确提示"缺少 ServiceConnection xxx"或"secretRef 解析失败"

---

### T6 — DeploymentTarget 模型 + 环境锁 + 健康检查

**优先级：** P1（继续完善 release 系统）
**风险等级：** L3
**预计工时：** 1.5 天

**证据：**
- `gray-release-system` 已加状态机 + 回滚，但 deploy 目标仍依赖全局 `K8S_DEPLOYMENT_NAME / K8S_CONTAINER_NAME` 环境变量
- audit P0-5：不能为不同环境配置不同 namespace/deployment/container/service/health check；无环境锁

**任务：**
1. 新增 `apps/api/src/environments/deployment-target.entity.ts`：
   ```ts
   type DeploymentTarget = {
     id: string;                       // ULID
     environmentId: string;
     type: "local-docker" | "kubernetes";
     namespace?: string;
     deploymentName?: string;
     containerName?: string;
     serviceName?: string;
     healthCheckUrl?: string;
     healthCheckTimeoutMs?: number;
     serviceConnectionId?: string;     // 引用 T5 的 ServiceConnection
   };
   ```
2. 环境锁：`environments` 增加 `activeReleaseId`，同环境同时只能有一条 `running`/`canarying` release；冲突时返回 409
3. 健康检查：上线后 `releases.service.ts` 调用 `healthCheckUrl`（可配 retry/timeout），失败自动 rollback
4. 前端 `release-target-panel.tsx`（来自 T3）增加 DeploymentTarget 选择器

**验收：**
- 同环境并发触发 2 条灰度 → 第二条返回 409 + 提示"环境被 release-xxx 锁定"
- healthCheckUrl 返回 503 → release 自动转 `failed` 并触发 rollback
- 不再依赖全局 `K8S_*` env，全部走 DeploymentTarget

**依赖：** T5（ServiceConnection 提供 k8s 凭据）

---

### T7 — Postgres / SQLite repository adapter

**优先级：** P1（服务器部署前置）
**风险等级：** L4
**预计工时：** 2.5 天

**证据：**
- 现状：JSON 文件持久化（`DEPLOYMENT_DATA_DIR`），单实例可用，**多实例会冲突**
- audit P0-1 + Phase 1 验收要求：API 重启后历史 run/artifact/release 在 + 多实例数据一致

**任务：**
1. 选 Prisma + SQLite (dev) / PostgreSQL (prod)，理由：schema 同源、迁移工具成熟、Nest 生态友好
2. 在 `apps/api/prisma/schema.prisma` 落 audit 推荐的 11 张表：
   ```text
   pipelines / pipeline_revisions / source_repositories / service_connections /
   runs / stage_runs / task_run_events / artifacts /
   release_plans / release_executions / environments / deployment_targets /
   audit_events / runner_profiles / runner_leases
   ```
3. 实现 `PrismaInMemoryAdapter` 让现有 `Repository<T>` 接口透传到 Prisma
4. 数据迁移：`DEPLOYMENT_DATA_DIR` 的 JSON → Prisma 的一次性迁移脚本
5. 多实例支持：`runner_leases` 在 DB 层做 `SELECT FOR UPDATE` 抢占

**验收：**
- 启动两个 API 实例（不同端口），共享同一个 DB → snapshot 数据一致 + 同一个 run 不会被两个实例同时执行
- `pnpm prisma migrate dev` + `pnpm prisma migrate deploy` 可重复
- 旧 JSON 数据可一键迁入

**依赖：** T5（schema 要先和 ServiceConnection 对齐）；建议在 T5 完成后立刻做

---

### T8 — TS 单元测试基线

**优先级：** P1（重构兜底）
**风险等级：** L1
**预计工时：** 1 天
**可与任意 T 并行**

**证据：**
- TS 侧 0 个 `.test.ts`；只有 Go bridge 2 个测试
- 任何重构（T1/T3/T5）都靠手测，回归风险高

**任务：**
1. 选 Vitest（与 Next.js 16 / Nest 11 兼容好）
2. 在 `apps/api/package.json` + `apps/web/package.json` + `packages/shared/package.json` 增加 `test` script
3. 优先覆盖：
   - `apps/api/src/code-repos/code-repos.service.ts` provider URL parser
   - `apps/api/src/executors/local-docker.executor.ts` tag template renderer
   - `apps/api/src/artifacts/artifacts.service.ts` artifact idempotency (`runId + stageKey + type + digest`)
   - `apps/api/src/common/ids.ts` ULID 生成 + 排序性
   - `apps/api/src/runs/runs.service.ts` resolvedCommit 解析
4. CI 集成：`pnpm -r test` 加入根 package.json scripts

**验收：**
- `pnpm -r test` 全绿
- 上述 5 个模块覆盖率 ≥ 70%
- Vitest config 在 monorepo 三个 package 都能跑

---

## 4. 推荐 sprint 范围

| 方案 | 包含 | 工时 | 适合场景 |
|---|---|---|---|
| **A — 清扫派** | T1 + T3 + T4 + T8 | ~3 天 | 想快速降低维护负担、不动数据模型；适合作为下次大改动前的"打地基" |
| **B — 真实化派** | T1 + T2 + T6 | ~3.5 天 | 把发布链路变成"真生产"；强化 runner / target / 环境锁 |
| **C — 收敛派** | T5 + T7 + T8 | ~5.5 天 | 准备上服务器，多人多环境；schema 一次到位 |
| **D — 全量派** | T1 → T8 顺序做 | ~12 天 | 完整覆盖 audit 的 P0+P1；建议拆 2-3 个 sprint 而非单 sprint |
| **E — 自由组合** | 用户从 T1-T8 自由勾选 | 视情况 | 已经知道想动哪块 |

**推荐顺序（如果分多 sprint）：**

```text
Sprint 1 (本轮):  T1 + T8         → 流程边界干净 + 测试兜底（基础设施）
Sprint 2:          T4 + T3         → shared/web 拆分（架构整理）
Sprint 3:          T5 + T2         → ServiceConnection + RunnerQueue（运行时收敛）
Sprint 4:          T7 + T6         → DB adapter + DeploymentTarget（服务器就绪）
```

理由：
- T1 + T8 都是 L1-L2，无依赖，立刻能做，且 T8 的测试基线是后续所有重构的安全网
- T4 + T3 是纯重构，不动行为，应该尽早做以降低后续 sprint 成本
- T5 是 T6/T7 的依赖，必须先做
- T7 + T6 一起做避免 schema 改两遍

## 5. 风险

- **T2/T5/T6/T7 都涉及数据模型，最好成对做**：单做 T2 会留 lease 表 schema、T5 单做会留 service_connection 表 schema，最后还要 T7 重做一遍。Sprint 3+4 联动可避免。
- **T3 拆 2344 行有视觉回归风险**：必须每拆一个 panel 立刻 dev server 手测，不能批量拆完再测。
- **T7 选型风险**：Prisma 有锁迁移问题；如果团队偏 TypeORM 或 drizzle，需要在 plan 阶段确认。
- **当前 0 个 TS 测试**，任何重构都靠手测；强烈建议把 T8 提前到首位。
- **T5 backward-compatible**：保留旧 env 字段 fallback；否则现有 dev 环境会全部炸。

## 6. 不做（明确拒绝）

- 不引入 Tailwind / shadcn / 新 CSS 体系（与现有 `globals.css` 冲突）
- 不替换 NestJS / Next.js 大版本
- 不做 RBAC / 多租户（依赖 T5+T7 完成后才开做）
- 不集成 Tekton Chains / SLSA provenance（先把控制面稳了）
- 不做 webhook 签名验证 / replay protection（独立 sprint）
- 不做 SBOM 生成 / cosign 签名（独立 sprint）
- 不动 `pnpm-lock.yaml` 现有依赖范围（仅追加 Prisma + Vitest）
- 不重写 Tekton bridge Go 代码（informer 已落，1780 行属于功能聚集而非缺陷；后续可拆 file 但不在本轮）

## 7. 验证策略

### 单元测试（T8 落地后）

- provider URL parser：GitHub / GitLab / GitCode HTTPS、SSH、页面 URL
- tag template renderer：`run.id`、`commit.short`、`branch`、非法字符清理
- artifact idempotency：同 `runId + stageKey + type + digest` 不重复
- ULID 生成：单调递增 + 长度 26
- resolvedCommit：branch / tag / fixed commit 三路径

### 集成测试

- `EXECUTOR=local-docker` 全链路：clone → build → docker build → push → pull → 灰度上线
- `EXECUTOR=tekton` 全链路：PipelineRun → TaskRun → result → digest → DeploymentTarget rollout
- ServiceConnection：注册 → pipeline 引用 → secret resolve → 真实命令成功
- RunnerQueue：5 并发 → 3 running + 2 queued → kill API → 重启 → lease 过期 → 自动 fail

### 端到端冒烟

```bash
# 1. 编译
pnpm -r check && pnpm -r build
cd services/tekton-bridge && go build ./... && go vet ./...

# 2. 启动
pnpm dev:api & pnpm dev:web &
(cd services/tekton-bridge && go run ./cmd/server) &

# 3. 烟测
curl http://127.0.0.1:4000/api/snapshot | jq '.overview'
curl http://127.0.0.1:4000/api/service-connections      # T5 后
curl http://127.0.0.1:4000/api/runner-leases            # T2 后
curl http://127.0.0.1:4000/api/deployment-targets       # T6 后

# 4. 浏览器手测
# 配置编辑器：T3 后所有 panel 切换正常
# 灰度发布：T6 后并发触发返回 409
```

## 8. Definition of Done（按方案）

### 方案 A 完成标准

- `grep -rn "simulateUntilGate\|mode === \"instant\"" apps/api/src` 只剩 `seed-data.ts`
- `pipeline-config-editor.tsx` ≤ 400 行
- `packages/shared/src/index.ts` 拆为 7 子域，单文件 ≤ 400 行
- `pnpm -r test` 绿，5 个核心模块覆盖率 ≥ 70%

### 方案 B 完成标准

- `grep` simulate 同上
- 5 并发 local-docker → queue 行为正确
- 同环境并发上线 → 409 + rollback 链路完整
- healthCheckUrl 集成可工作

### 方案 C 完成标准

- ServiceConnection 表 + 迁移脚本可重复运行
- `process.env` 直接读减少到 ≤ 3 个文件（main / load-env / service-connections）
- 多实例 API 共享 DB 行为一致
- 旧 JSON 数据可一键迁入

### 方案 D 完成标准

= A + B + C 全部完成 + audit DoD 全勾：
- API 重启不丢 run / artifact / release / audit
- 每个镜像 tag 都能追溯到真实 commit
- 每个 artifact 都有 digest / producer stage / copy command / retention
- 每个上线动作都有 release execution / 健康检查 / 回滚点
- UI 上 Tekton 对象对应真实集群对象
- 配置只需填仓库 / 分支 / build script / registry connection / deployment target 即可走完链路

## 9. 下一步

**用户决策点：**
1. 选方案（A / B / C / D / 自由组合）
2. 是否要先做 T8（测试基线）作为安全网
3. 是否单 sprint 还是分多 sprint

**回告示例：**
- `go A` — 进 Phase 2 Plan，按方案 A 拆任务
- `go T1,T8` — 自由组合
- `go T1+T8 single sprint, T3+T4 next sprint` — 多 sprint 顺序

**Phase 2 Plan 起步动作：**
- 读 `docs/plans/2026-05-14-project-architecture-audit.md` 的 Phase 1-5 任务列表
- 读选定 T 涉及的核心文件
- 跑 `pnpm -r check` 确认基线
