---
title: "DORA 四指标聚合层"
type: sprint
status: completed
created: "2026-06-08"
updated: "2026-06-08"
checkpoints: 0
tasks_total: 6
tasks_completed: 6
tags: [sprint, feature, metrics, dora, harness-borrow]
aliases: ["DORA 指标", "部署度量"]
related:
  - "[[2026-06-05-harness-gap-borrow-plan]]"
  - "[[project-production-deployment]]"
  - "[[feedback-control-plane-auth-jwt-role]]"

# === Anti-Drift 扩展字段 ===
invariants:
  - "DORA 是纯只读聚合层，不写入/不改 release-events 事件流"
  - "新端点双路由 /api/* + /oapi/v1/flow/*，oapi 走 ApiResponse<T> 信封"
  - "读端点 @RequireRoles viewer；actor 不参与聚合（聚合是全量统计非 per-user）"
  - "DoraMetrics 类型放 packages/shared 纯 TS，边界校验(window/env query)放 apps/api zod"
invariant_tests:
  - apps/api/src/snapshot/snapshot.service.spec.ts
deferred: []
deadcode_until: []
---

# DORA 四指标聚合层

> 借鉴清单 #1（见 `2026-06-05-harness-gap-borrow-plan.md` 第 10.2 节）。
> ROI=high，effort=M。数据源 100% 现成，纯只读聚合，零基础设施依赖。

## Phase 1: 需求分析（Think · CEO/产品视角）

### 做什么（Scope）
- 后端聚合 **DORA 四指标**：部署频率 / 变更前置时间 / 变更失败率 / MTTR。
- 数据源：`release-events`（+ `artifacts.uploadedAt` 算前置时间），不新增埋点。
- 查询维度：时间窗 `window`（如 7d/30d）+ 可选 `environment` + 可选 `applicationId` 过滤。
- 输出：四指标当前值 + 趋势点序列（按天/桶）。
- 双路由 API：`GET /api/metrics/dora` + `GET /oapi/v1/flow/metrics/dora`，viewer 可读。
- 前端看板页 `apps/web/app/metrics/`，复用现有图表/卡片风格（不引新依赖）。
- 前置改动：给 `ReleaseEventsRepository` 加全量查询视图（`listAll` / `listByApplication`）。

### 不做什么（Non-scope）
- 不接外部 BI / Grafana / 数据仓库。
- 不做 SLO / error-budget（后续与 DORA 共用事件源再扩，本 sprint 只搭底座）。
- 不改事件写入逻辑（DORA 只读，不碰 `append`）。
- 不做实时推送 / WebSocket（拉取即可）。
- 不接 LLM 洞察 / 异常归因（YAGNI）。
- 不做 per-user 维度（DORA 是团队级全量统计）。

### 成功标准（Success）
- 灌入历史事件 → 四指标计算与手算一致（单元测试覆盖每个公式）。
- 按 `env` / `window` / `applicationId` 过滤正确。
- 空数据不崩：返回 0 值 + 友好态，不抛异常。
- `pnpm check` + shared/api/web 三测全绿。
- 不破坏现有 invariant：事件流不可变、双路由、TS↔Go sync test 不挂。

### 风险（Risks）
- **R1** `release-events` 仅 `listForRelease`（按 releaseId）→ 需加全量视图；InMemory 用 `snapshot()` 全量，注意避免 N+1；Supabase 后端下全表扫描性能（首版可接受，数据量小）。
- **R2** 变更前置时间需 `artifact.uploadedAt` → `deploy_succeeded` 关联，须确认 `artifact.id` 与 `event.artifactId` 对得上（部分事件 artifactId 可选）。
- **R3** MTTR 定义边界：`release_rolled_back` → 下一个同 (env, app) 的 `deploy_succeeded` 时差；跨环境/应用必须分组，否则串味。
- **R4** 窗口/桶边界 + 时区（事件 createdAt 是 ISO8601 UTC，前端展示需一致）。
- **R5** 前端避免引入新图表库；复用现有 CSS/组件。

### Next: go → Plan

---

## Phase 2: 技术方案 + 任务拆解（Plan · 架构师视角）

### 入场扫描 - Invariants 继承（防漂移强制项 1）

| 子系统 | 既有 invariant | 本 sprint 如何保持 |
|--------|----------------|--------------------|
| 双路由 | 控制器 `/api/*` + `/oapi/v1/flow/*` 两边都要建 | DORA 同建两路由，oapi 走 `ok()` 信封 |
| 校验分层 | 业务规则放 `packages/shared` 纯 TS，边界校验放 `apps/api` zod | `DoraMetrics` 类型 + 聚合纯函数放 shared 可复用部分/类型在 shared；query 校验 zod 在 api |
| 鉴权 | 读端点 viewer，写端点 member+，前端不带 token、nginx 注入 | DORA 是只读 → `@RequireRoles("viewer")`，无 per-user（团队级全量统计，不注入 actor） |
| 事件不可变 | `release-events` append-only | DORA **只读**，不碰 `append`，不新增事件类型 |
| TS↔Go DAG sync | 动 `DEFAULT_STAGE_DAG` 必须同步 Go + sync test | 本 sprint **不动 DAG**，不触发该约束 |

### 入场扫描 - 集成路径声明（防漂移强制项 2）

| 改动点 | 触发动作 | 中间层 | 数据源 | 刷新后可见 |
|--------|----------|--------|--------|------------|
| DORA 看板 | 打开 `/metrics` 页 | `apiFetch /api/metrics/dora` → DoraController → DoraService | `ReleaseEventsRepository.listAll` + `ArtifactsRepository` | ✅ 四指标卡 + 趋势 |
| 导航入口 | topbar 链接 | next 路由跳 `/metrics` | — | ✅ 可达 |

> 全链路无 ❌：前端页面直接消费新端点，不产生 dead code。

### 入场扫描 - 半完成债务清单（防漂移强制项 3）

| 来源 sprint | 议题 | 本 sprint 决策 | deadline |
|-------------|------|----------------|----------|
| — | 无前置 deferred 债务 | DORA 是新功能；harness plan 第 10 节其余项属后续独立 sprint，非本 sprint 债务 | — |

### 技术方案

1. **shared 类型**（纯 TS）：新增 `packages/shared/src/metrics/index.ts`，导出 `DoraMetrics`（四指标当前值 + `trend` 桶序列 + `window` 元信息）、`DoraTrendPoint`、`DoraWindow`、`DoraQuery`。从 `packages/shared/src/index.ts` barrel 导出。
2. **仓库视图**：`ReleaseEventsRepository` 增 `listAll(): ReleaseEvent[]`（`snapshot()` 全量按 createdAt+sequence 排序）与 `listByApplication(applicationId)`。一次取全量，聚合在内存按 (app, env) 分组，避免 N+1。
3. **聚合纯函数**（核心逻辑，可独立单测）：`apps/api/src/metrics/dora.service.ts` 暴露 `computeDora(events, artifacts, query, now)`。各指标定义（写死并单测锁定）：
   - **部署频率** = `count(deploy_succeeded)` / 窗口天数（次/天），趋势按天分桶计数。
   - **变更前置时间** = `median(deploy_succeeded.createdAt − 关联 artifact.uploadedAt)`，按 `event.artifactId === artifact.id` 关联；artifactId 缺失或 artifact 找不到的事件跳过并计 `unmatched` 计数（透明，不静默）。
   - **变更失败率** = `(count(deploy_failed) + count(release_rolled_back)) / max(count(deploy_succeeded)+count(deploy_failed), 1)`。
   - **MTTR** = 对每个 `release_rolled_back`，在**同 (env, applicationId)** 找其后第一个 `deploy_succeeded`，取时差中位数；无后继恢复的回滚跳过并计 `unresolved`。
   - 过滤：`window`(default 7d) + 可选 `environment` + 可选 `applicationId`，在取数后内存过滤。
   - `now` 作为入参（测试注入固定时刻；控制器传 `new Date().toISOString()`）。
4. **控制器 + 模块**：`dora.controller.ts` 双路由 `GET /api/metrics/dora` + `GET /oapi/v1/flow/metrics/dora`（后者 `ok()` 信封），`@RequireRoles("viewer")`，query 用 zod DTO 校验（`window` 枚举/正整数天、`environment` 枚举、`applicationId` 字符集长度）。`metrics.module.ts` import `ReleasesModule`(导出 ReleaseEventsRepository) + `ArtifactsModule`(导出 ArtifactsRepository)；`app.module.ts` 注册 `MetricsModule`。
5. **前端**：`apps/web/app/lib/api.ts` 加 `fetchDoraMetrics(query)`；`apps/web/app/metrics/page.tsx` 客户端页渲染四指标卡 + 简单趋势（复用 `primitives.tsx` / 现有 CSS，不引图表库，趋势用 CSS bar/sparkline）；`cloud-topbar.tsx` 加 `/metrics` 入口。

### 任务拆解

| # | Task | 风险 | 测试 |
|---|------|------|------|
| 1 | shared: `metrics/` 域类型 `DoraMetrics/DoraTrendPoint/DoraWindow/DoraQuery` + barrel 导出 | L1 | 类型编译；shared test 不回归 |
| 2 | api: `ReleaseEventsRepository.listAll/listByApplication` 视图 + 扩 spec | L2 | repo spec 断言全量排序/分应用过滤 |
| 3 | api: `dora.service.ts` 纯函数聚合（4 指标 + trend + unmatched/unresolved 透明计数） | **L3** | `dora.spec.ts` 每公式手算对拍 + 空数据 + env/app 过滤 + 边界 |
| 4 | api: `dora.controller.ts` 双路由 + zod query DTO + `metrics.module` + `app.module` 注册 + 接线 repos | L2 | controller/e2e 冒烟：两路由返回、viewer 可读、非法 query 400 |
| 5 | web: `fetchDoraMetrics` + `metrics/page.tsx` 看板 + topbar 入口 | L2 | 组件渲染/空态 smoke（vitest） |
| 6 | 验证收口: `pnpm check` + shared/api/web 三测 + `invariant_tests`(snapshot.service.spec) 全绿 | — | 全量回归 |

> Task=6 > 5 → Task 5 后自动 checkpoint 检查。

### 验证策略
- L3 的 `dora.service` 是核心：每指标至少 1 个手算对拍用例 + 空数据 + 单 env/app 过滤 + artifactId 缺失/MTTR 无后继恢复的边界。
- 每 Task 收尾跑 `invariant_tests`（`snapshot.service.spec.ts` 含 TS↔Go sync）确认未误伤。
- 收口跑 `pnpm check`（tsc 严格）+ 三 package test。

### Next: go → Work

---

## Phase 3: 变更日志（Work · 工程师视角）

6 个 Task 单轮完成，无退化信号 → 未触发 checkpoint。

| # | Task | 状态 | 产出 |
|---|------|------|------|
| 1 | shared 类型 | ✅ | `packages/shared/src/metrics/index.ts`（`DoraMetrics/DoraTrendPoint/DoraWindow/DoraSampleSizes/DoraQuery`）+ barrel `index.ts` 导出 |
| 2 | repo 全量视图 | ✅ | `release-events.repository.ts` 加 `listAll()`(createdAt+sequence 排序) / `listByApplication()` + spec 2 例 |
| 3 | 聚合纯函数 | ✅ | `apps/api/src/metrics/dora.service.ts`（`computeDora` 纯函数 + `DoraService`）；`dora.spec.ts` 8 例手算对拍 |
| 4 | 双路由控制器 | ✅ | `dora.controller.ts`(双路由+viewer) + `dto/dora-query.dto.ts`(zod, window coerce) + `metrics.module.ts` + `app.module.ts` 注册；`dora.controller.spec.ts` 4 例 |
| 5 | 前端看板 | ✅ | `metrics/page.tsx` + `metrics/format.ts`(+test 5 例) + `lib/api.ts fetchDoraMetrics` + `cloud-topbar` 入口 + `globals.css` `.dora-*` |
| 6 | 验证收口 | ✅ | 见下表 |

### 关键实现决策
- **样本量透明披露**：`DoraSampleSizes` 显式记录 `leadTimeUnmatched`/`mttrUnresolved`，跳过的数据不静默丢，避免指标失真（遵循"用户输入验证/不静默吞错"）。
- **中位数而非均值**：前置时间/恢复时间用 median 抗离群（DORA 习惯），字段名 `timeToRestoreMs` 注释说明取中位。
- **`now` 显式注入** `computeDora(...,now)`：纯函数确定性可测；控制器传 `new Date()`。
- **CFR 定义锁死**：`(deploy_failed + release_rolled_back) / (deploy_succeeded + deploy_failed)`，单测锁定。
- **MTTR 按 (env, applicationId) 分组**配对回滚→恢复，避免跨环境/应用串味。
- **只读**：未碰 `append`、未新增 `ReleaseEventType`、未动 DAG → 不触发 TS↔Go sync 约束。

### 验证结果

| 命令 | 结果 |
|------|------|
| `pnpm --filter @deploy-management/shared test` | ✅ 27 tests |
| `pnpm --filter @deploy-management/api test` | ✅ 66 tests（+dora 8 / +controller 4 / +repo 2；invariant `snapshot.service.spec` 7 未回归） |
| `pnpm --filter @deploy-management/web test` | ✅ 34 tests（+format 5） |
| `pnpm check`（shared/api/web tsc 严格） | ✅ Done |
| `pnpm --filter @deploy-management/web build`（Next SWC） | ✅ `/metrics` 进路由 manifest |

### Next: go → Review

---

## Phase 4: 审查结果（Review · 多视角 + 第 6 视角集成连续性）

> 注：原计划的并行审查 workflow 在上个会话中断时被 kill（output 0 字节），按 sprint 协议 inline fallback 完成 6 视角审查。

**P0：无。P1：无。**

正确性逐条核对（全部通过）：
- median 偶数长度取均值（leadTimes `[2h,4h]→3h` 已单测）；`Date.parse` NaN → 归 `unmatched` 不污染。
- 窗口 `[from,to]` 闭区间过滤；env/app 可选过滤正确。
- MTTR：同 `(env, applicationId)` + 严格 `createdAt >` + 取最早后继恢复（已测跨 app 不串味）。
- `enumerateDayKeys` 走 UTC，无 DST 问题；趋势桶覆盖全窗口含 0 值日。
- 只读：未碰 `append`、未新增 `ReleaseEventType`、未动 DAG → 第 6 视角 invariant 全保。
- DI：`MetricsModule` import `ReleasesModule`/`ArtifactsModule`（均 export 仓库）→ 可解析，无 dead code（前端真实消费）。
- 鉴权：viewer 与既有 `ReleasesController` 一致；zod query 边界（window 1-365 / env 枚举 / appId 长度）齐全。

**P2（记录不阻断，按需后续）：**

| 文件 | 问题 | 处理 |
|------|------|------|
| `dora.service.ts` | CFR 边界：`succeeded=failed=0` 但 `rolledBack>0` 时 `attemptCount=0` → 返回 0 | 避 div0 的安全选择，已注释；rollback 无任何部署属异常态，可接受 |
| `dora.service.ts` | MTTR 配对 `O(rollbacks×succeeded)` find；`listAll` 每请求全量 sort | 当前内存量级无感；Supabase 大数据量再优化（与 listAll 视图一并） |
| `metrics/page.tsx` | 趋势首桶为半天桶（窗口从 `now−Nd` 午间起） | 纯展示瑕疵，不影响指标值 |

**结论**：无必修项，可进 Compound。

### Next: → Compound

---

## Phase 5: 复利记录（Compound）

### 沉淀
- **新本能**：`feedback_shared_dist_rebuild_gate` — `packages/shared` 经 `dist/`（package.json `main`/`types` 指 dist，vitest 无 src alias）被 api/web 消费，故改 shared 后必须先 `pnpm --filter @deploy-management/shared build`，否则 api/web 的 check/test/build 看不到新导出。本 sprint 加 `metrics` 域时即因此先 build。
- **路线图更新**：`2026-06-05-harness-gap-borrow-plan.md` 第 10.2 节借鉴清单 #1 DORA 已落地（本文档），memory `project_harness_gap_roadmap` 同步标记。

### 结果
DORA 四指标聚合层（后端纯函数聚合 + 双路由 viewer API + 前端 `/metrics` 看板）落地，纯只读、零新基础设施依赖。验证全绿（shared 27 / api 66 / web 34 测试 + tsc 严格 3 包 + Next build）。

status → completed。
