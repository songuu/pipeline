---
title: "ReactFlow Sprint B - 配置页编排 + Tekton 深度观测 + Layout 持久化"
type: sprint
status: planning
created: "2026-05-18"
updated: "2026-05-18"
parent: "docs/plans/2026-05-18-reactflow-pipeline-dag-integration.md"
predecessor: "docs/plans/2026-05-18-reactflow-sprint-a.md"
tasks_total: 5
tasks_completed: 5
status: completed
checkpoints: 0
tags: [sprint, frontend, backend, reactflow, dag, tekton, supabase, sprint-b]
aliases: ["ReactFlow Sprint B", "DAG 第二刀"]
---

# ReactFlow Sprint B: 配置页编排 + 深度观测 + Layout

> 父文档: [[2026-05-18-reactflow-pipeline-dag-integration]]
> 前序: [[2026-05-18-reactflow-sprint-a]] (5/5 Task 完成)
> Sprint A 已交付: 基础组件、adapter、后端 DAG、运行详情只读 DAG、节点命令/日志

## Phase 1: 需求分析

### Sprint B 在做什么

把流水线配置页从固定列布局升级为可视化 DAG 编排（节点选中 + 启停 + 拖线 runAfter + 校验），把 Tekton TaskRun/Step/when/timeout 接到节点详情，新增 Supabase `pipeline_graph_layouts` 表存 UI 偏好，并把视觉、性能、回归测试一次性收口。

### Scope

| Task | 名称 | 风险 | 关键文件 |
|------|------|------|----------|
| Task 5 | 配置页可视化选择（选中 + 启停 + 现有面板编辑） | L2 | `apps/web/app/ui/pipeline-config/editor-core.tsx` (1848 行) |
| Task 6 | 受控依赖编辑（新增节点 + 拖线 runAfter + 校验） | L3 | editor-core + 新建 graph editor 模块 |
| Task 8 | Tekton 深度观测（TaskRun/Step/when/timeout/retries/workspaces/params） | L2 | `apps/web/app/ui/sections/pipeline-run-detail.tsx` 右侧详情面板扩展 |
| Task 9 | Supabase `pipeline_graph_layouts` 表 + zod 校验 + API + opt-in 接线 | L3 | `supabase/migrations/`、`apps/api/src/`、shared zod schema |
| Task 10 | 视觉/性能/回归验证 + pipeline-flow-node 单测 | L2 | 跨 web/api，新建 perf 测试和 jsdom 单测 |

### Non-scope

- 自由脚本编辑器（父文档明令禁止第一版做）
- 任意危险 shell 流程（受控任务模板路径不变）
- 改变 local-docker / tekton 执行器主协议
- 替换模板市场 MiniFlow（保留轻量预览）
- finally 任务编排（10 stage 当前不含 finally，Sprint C 议题）

### Success Criteria

- [ ] 配置页能在 flow tab 切换 DAG 视图，节点选中 → 现有右侧配置面板正确联动
- [ ] 用户能拖线建立 runAfter，违规依赖（环、反向跨阶段、上传前无构建）保存前被拦截
- [ ] 用户能新增审批/灰度/部署/上传预设任务节点，自动推断默认 runAfter
- [ ] 运行详情页节点详情显示 TaskRun status/reason/message、Step 列表、when/timeout/retries/workspaces/params
- [ ] Supabase `pipeline_graph_layouts` 表迁移可执行，API 层 zod 强校验拒绝畸形/超大 jsonb
- [ ] layout API 在 `DEPLOYMENT_STORAGE !== "supabase"` 时静默 no-op（不报错）
- [ ] 50 节点 DAG 首次渲染 < 200ms，1Hz 轮询不触发节点重建
- [ ] pipeline-flow-node 至少 4 项 jsdom 单测（pending/running/success/failed 状态渲染）
- [ ] check + build + test 全绿（web/api/shared/tekton-bridge 双 build）

### 关键决策（待 Plan 阶段细化）

1. **配置页 editable 模式 vs 完全替换**: 与运行详情页一致，加 `viewMode` toggle 保留 fallback flow-config-board
2. **拖线校验在前端还是后端**: 前端校验 + 后端 zod 二次校验（防绕过）。前端用 adapter 的 `detectCycle` 复用
3. **Supabase opt-in 接线**: `DEPLOYMENT_STORAGE=supabase` 才注入 layout repository；否则 controller 直接返回 404，保持 [[project-supabase-storage-opt-in]] 既定模式
4. **Tekton 深度详情数据来源**: 沿用 Sprint A 已有的 `fetchTektonTaskRunDetail` / `fetchTektonTaskRunLogs`，只扩展节点右侧详情面板渲染
5. **TS↔Go DAG sync test 范围扩展**: Task 6 新增 stage 限制规则（"deploy 不能反向依赖 source"），如果落到 Go 一侧需要同步检测

### 风险

| # | 风险 | 缓解 |
|---|------|------|
| RB1 | editor-core.tsx 1848 行的大文件改造，容易破坏现有 tabs/panels | 用 feature flag 双轨保留 fallback；改动只新增 DAG 视图分支，不动现有 tab 逻辑 |
| RB2 | Task 6 DAG 校验逻辑放前端被绕过 | 前端 + 后端双层 zod；保存时 API 走与前端相同的 `detectCycle` |
| RB3 | Supabase layout 表可被恶意 jsonb 攻击 | zod schema 限制 nodes ≤ 500、edges ≤ 2000、总 jsonb ≤ 256KB；actor 鉴权 |
| RB4 | Task 8 Tekton 深度详情接入引发现有 pipeline-run-detail.tsx 进一步膨胀（已 1300+ 行） | 抽出 `tekton-task-run-panel.tsx` 子组件，不要再往 detail 文件里堆 |
| RB5 | Task 10 性能基准依赖 ResizeObserver / requestAnimationFrame，在 jsdom 下不稳定 | jsdom 用 happy-dom mock 或直接 vi.mock；性能测试单独跑 browser env |
| RB6 | DEFAULT_STAGE_DAG 在 Task 6 引入新限制规则（如反向跨阶段）需要双语言镜像，违反 [[feedback-ts-go-constants-sync-test]] | 限制规则也用同样 sync test 模式 |

### 审计自检（防"doc 声称已修但代码不存在"）

Sprint A 落地状态实测核对：

- [x] `apps/web/app/ui/graph/{pipeline-graph-types,pipeline-graph-adapter,pipeline-flow-canvas,pipeline-flow-node}.tsx` 实际存在
- [x] `pipeline-graph-adapter.test.ts` 7 测试可跑通
- [x] `apps/api/src/snapshot/snapshot.service.ts` 含 `DEFAULT_STAGE_DAG` export + `buildTaskGraph` 已改为 DAG
- [x] `services/tekton-bridge/internal/backend/tekton.go` 含 `defaultStageDAG`
- [x] `pipeline-run-detail.tsx` 已接入 `PipelineFlowCanvas` + `useMemo` 性能优化
- [x] Sync test 在 `snapshot.service.spec.ts` 末尾

## Phase 2: 技术方案

### Task 5: 配置页 flow tab 接入 editable 画布

`editor-core.tsx:961-1082` 现状是 `<div className="flow-config-board">` 内 6 个 `.flow-stage-lane`（source / 测试 / 构建 / 变量 / 部署 / 新阶段），每个 lane 是按钮簇绑定 `selectTask(taskName, stage)` 选中。

策略：

- 加 `flowViewMode` state（"canvas" | "board"）+ 视图 toggle（沿用 Sprint A 的 `.pipeline-view-toggle` CSS）
- canvas 模式: 渲染 `<PipelineFlowCanvas mode="editable">`，节点 `data` 带 `stage` 和当前 `taskName`，点击节点 → 调 `selectTask`
- editable 模式下 `nodesDraggable=true`、`nodesConnectable=true`（Sprint A 已支持，仅切 mode 参数）
- 启用/禁用阶段: 用现有 `pipeline.stages` 数组增删（与现有 board 行为一致），通过 toolbar 的 "新阶段" 按钮（Task 6）

文件改动:

- `editor-core.tsx`: 加 viewMode state、import canvas、新增 toolbar、条件渲染
- 新建 `apps/web/app/ui/pipeline-config/pipeline-config-flow-canvas.tsx`: 包装 `PipelineFlowCanvas` + 处理 editable 模式特有事件（onNodeClick → selectTask）
- adapter 扩展: `pipelineDefinitionToGraph` 已存在；editable 模式下节点需要展示"已配置/未配置"标记，可通过 `taskMissingConfig(stage)` 计算 disabled 状态注入 `data.disabled`

### Task 6: DAG 编辑 + 校验

**校验规则表（前后端共用，定义在 shared）**:

| 规则 ID | 描述 |
|---------|------|
| no-cycle | 不允许 runAfter 形成环 |
| no-reverse-stage | deploy/canary/approval/promote 之间禁止反向跨阶段依赖 |
| build-before-upload | 启用 upload 必须启用 build |
| source-required | source 节点不可删除 |
| source-no-incoming | source 不可有入边 |
| stage-allowlist | runAfter 只允许指向 `DEFAULT_STAGE_DAG[stage]` 的祖先链上的 stage |

实现:

- `packages/shared/src/tekton/dag-validation.ts`: 导出 `validatePipelineGraph(graph, pipelineStages)` 返回 `{ valid: boolean; violations: ValidationViolation[] }`
- 复用 Sprint A 已有的 `detectCycle`（移到 shared 或在 shared 重写一份；优先后者避免 web → shared 反向依赖）
- 前端 `editor-core.tsx` 保存按钮 click 时调校验，violations 用 toast 列出
- 后端 `apps/api/src/pipelines/pipelines.controller.ts` 更新 pipeline 接口加 zod refinement + 同规则校验

**TS↔Go 同步**:

- DAG 校验规则只在 TS 落地（不影响 Tekton bridge 执行）；Go 侧不需要镜像，因为 Tekton 接收到的 taskGraph 已经是经过 TS 校验的快照
- 但是 `DEFAULT_STAGE_DAG` 仍由现有 sync test 守住

新增节点工具栏:

- `pipeline-config-flow-canvas.tsx` 顶部加 `<NodePalette>` 子组件，4 个预设按钮：审批 / 灰度 / 部署 / 上传
- 点击按钮 → 调 `addStageNode(stage)`，自动推断 runAfter（用 `DEFAULT_STAGE_DAG[stage]` 过滤当前已启用的 stages）
- 新增到 `pipeline.stages` 数组末尾（按 DAG 拓扑顺序），并 setSelectedTask 跳到新节点

### Task 8: tekton-task-run-panel 抽组件

`pipeline-run-detail.tsx` 已经 1300+ 行（Sprint A 加 useMemo 后），按 RB4 必须抽组件而不是继续在 detail 文件内堆。

新建 `apps/web/app/ui/sections/tekton-task-run-panel.tsx`，承接：

- TaskRun status / reason / message / conditionType 展示
- Step 列表（点击 step 拉 logs，沿用现有 `fetchTektonTaskRunLogs` API）
- when / timeout / retries / workspaces / params 展示（沿用现有 `selectedTaskRun` 数据）
- 失败节点错误摘要（沿用 Sprint A 的 `errorSummariesByStage` 输出）

`pipeline-run-detail.tsx` 修改:

- 抽出现有 tekton-run-panel 内部 JSX 到 `<TektonTaskRunPanel selectedStage={...} tektonRun={...} ... />`
- detail 文件继续 own 数据获取 effect，子组件纯展示

### Task 9: Supabase 图布局

**Migration** (`supabase/migrations/20260518_pipeline_graph_layouts.sql`):

```sql
create table if not exists public.dm_pipeline_graph_layouts (
  id uuid primary key default gen_random_uuid(),
  pipeline_id text not null,
  actor text not null,
  version integer not null default 1,
  nodes jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb,
  viewport jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dm_pipeline_graph_layouts_pipeline_actor_unique
    unique (pipeline_id, actor)
);

create trigger set_dm_pipeline_graph_layouts_updated_at
  before update on public.dm_pipeline_graph_layouts
  for each row execute function public.set_dm_records_updated_at();
```

**Zod schema** (`packages/shared/src/tekton/graph-layout-schema.ts`):

```ts
const nodePosition = z.object({ x: z.number(), y: z.number() });
const nodeEntry = z.object({
  id: z.string().max(128).regex(/^[a-zA-Z0-9._:-]+$/),
  position: nodePosition,
  data: z.record(z.string(), z.unknown()).optional(),
}).strict();
export const pipelineGraphLayoutSchema = z.object({
  pipeline_id: z.string().max(128).regex(/^[a-zA-Z0-9._-]+$/),
  actor: z.string().max(128).regex(/^[a-zA-Z0-9._@-]+$/),
  nodes: z.array(nodeEntry).max(500),
  edges: z.array(z.object({
    id: z.string().max(128),
    source: z.string().max(128),
    target: z.string().max(128),
  }).strict()).max(2000),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().min(0.1).max(4) }).optional(),
}).strict();
```

**API** (`apps/api/src/pipeline-layouts/`):

- `pipeline-layouts.module.ts`、`controller.ts`、`service.ts`、`repository.ts`
- `controller`: GET `/api/pipelines/:pipelineId/graph-layout?actor=X`、PUT 同路径
- 当 `process.env.DEPLOYMENT_STORAGE !== "supabase"`: controller 直接抛 404 (`new NotFoundException("layout 仅在 supabase 模式启用")`)
- jsonb body 大小检查: Nest 默认 100kb，需配置 raw body 上限 256KB；超过 413 由 Nest 自动处理

**Web client** (`apps/web/app/lib/api.ts`):

- `fetchPipelineGraphLayout(pipelineId, actor)`、`savePipelineGraphLayout(pipelineId, payload)`
- editor-core 在 canvas 模式下加载 layout，节点 drag 后 debounce 保存

### Task 10: 验收 + 单测 + 性能

新建文件:

- `apps/web/app/ui/graph/__tests__/pipeline-flow-node.test.tsx`: 用 happy-dom 或 jsdom + `@testing-library/react`（需要新装）
- 4 个测试: pending / running / success / failed 状态渲染断言（dot 颜色 class、err summary 显示与否）
- `apps/web/app/ui/graph/__tests__/perf-bench.test.ts`: 构造 50 节点 PipelineDefinition，跑 `pipelineDefinitionToGraph` 在 Node 环境下 < 50ms（jsdom 渲染不可靠，纯函数性能足够代表）

验收命令链:

```bash
pnpm --filter @deploy-management/shared check && build
pnpm --filter @deploy-management/shared test  # 如新增 dag-validation 测试
pnpm --filter @deploy-management/api check && build && test
pnpm --filter @deploy-management/web check && build && test
cd services/tekton-bridge && go build ./... && go build -tags tekton ./...
```

## Phase 3: 任务拆解

执行顺序（依赖链）:

```
Task 5 (canvas editable 接入)
  └─ Task 6 (拖线 + 校验 + 新增节点)
       └─ Task 9 (Supabase layout 持久化, 依赖 editable 节点位置可拖)
            └─ Task 10 (性能 + 单测 + 回归)

Task 8 (Tekton 深度详情) 与 Task 5/6/9 弱耦合，可在 Task 5 之后任意时机插入
```

任务状态:

- [x] **Task 5**: 配置页 editable 画布 — L2 ✅ check + build + 7/7 测试通过
- [x] **Task 6**: 拖线 + 新增节点 + 校验 — L3 ✅ shared 23/23 + api 37/37 + web 7/7 + DAG 下沉 shared + 后端 sync test 仍守住
- [x] **Task 8**: tekton-task-run-panel 抽组件 + 深度详情 — L2 ✅ 抽出 168 行子组件 + when/timeout/retries/workspaces/params 详情接入
- [x] **Task 9**: Supabase layout 表 + zod + API + opt-in — L3 ✅ migration + module + 10 测试 + web client
- [x] **Task 10**: 性能 + 单测 + 回归 — L2 ✅ 14 web 测试 + 全链路验证 + go 双 build

⚡ 5 task 完成后触发 checkpoint 复盘（按 /sprint 协议）

## Phase 4: 审查结果

### 范围

Sprint B 新增/改动文件（不审分支预存的不相关 diff）:

- `packages/shared/src/tekton/{default-stage-dag,dag-validation,dag-validation.spec}.ts` (新)
- `packages/shared/src/tekton/index.ts` (re-export)
- `apps/api/src/snapshot/snapshot.service.ts` (DAG 从 shared re-export)
- `apps/api/src/pipeline-layouts/{module,controller,service,repository,dto/graph-layout.dto,service.spec}.ts` (新)
- `apps/api/src/common/in-memory.repository.ts` (+collection)
- `apps/api/src/app.module.ts` (+module 注册)
- `apps/web/app/ui/graph/pipeline-flow-canvas.tsx` (onConnect)
- `apps/web/app/ui/graph/pipeline-graph-types.ts` (+PipelineFlowConnectPayload)
- `apps/web/app/ui/graph/__tests__/{pipeline-flow-node.test.tsx,perf-bench.test.ts}` (新)
- `apps/web/app/ui/pipeline-config/{pipeline-config-flow-canvas,editor-core}.tsx`
- `apps/web/app/ui/sections/{tekton-task-run-panel.tsx,pipeline-run-detail.tsx}`
- `apps/web/app/lib/api.ts` (+layout helpers)
- `apps/web/app/globals.css`
- `apps/web/{package.json,vitest.config.ts}`
- `supabase/migrations/20260519_pipeline_graph_layouts.sql` (新)

### 五视角审查

| 视角 | 结论 |
|------|------|
| 架构 | DAG 下沉 shared ✓；TS↔Go sync test 仍有效 ✓；customEdges 仅前端 state 不持久化（Sprint C 决定 schema 扩展） |
| 安全 | DEPLOYMENT_STORAGE opt-in 守住 ✓；pipeline_id/actor zod 白名单 ✓；大小上限 ✓；**`actor` 来自 query 参数不安全** |
| 性能 | adapter useMemo 已加 ✓；NODE_TYPES 模块常量 ✓；customEdges 引用稳定（React state）；shared DAG 校验 O(V+E) |
| 代码质量 | 子组件抽出（tekton-task-run-panel）✓；editor-core helpers 内嵌（已 1900+ 行）；customEdges 不持久化设计无注释 |
| 测试覆盖 | shared 11/11 + api 10/10 + web 14/14 (jsdom 5 + perf 2 + adapter 7) ✓ |

### Findings

**P0**: 无。

**P1** (安全相关，需修):

- `apps/api/src/pipeline-layouts/pipeline-layouts.controller.ts:33,41`: **`actor` 来自 query 参数允许任意客户端读他人 layout**。Alice 调 `GET /api/pipelines/pl-1/graph-layout?actor=bob` 会拿到 bob 的布局。修复: 用 `@CurrentPrincipal() principal: ControlPlanePrincipal` 注入，从 `principal.actor` 取，不接受 query。GET 可考虑仍接受 query 作 fallback 但优先用 principal；PUT 必须强制 principal。

**P2** (写入文档，不阻塞):

- `apps/api/src/pipeline-layouts/dto/graph-layout.dto.ts` ↔ `apps/web/app/lib/api.ts`: layout payload schema 双语言独立定义（zod in api, TS interface in web）。同 Sprint A 的 [[feedback-ts-go-constants-sync-test]] 风险，但都在 TS 内，可考虑下沉到 shared
- `apps/web/app/ui/sections/tekton-task-run-panel.tsx:55-58`: 用 `(taskRunDetail as { conditionReason?: string } | null)` 暗示 `TektonTaskRunDetail` 类型缺 conditionReason/conditionMessage 字段，Sprint C 应扩展 shared 类型
- `apps/web/app/ui/pipeline-config/editor-core.tsx`: 在 1900+ 行的大 component 内嵌 6 个 helper（PRESET_STAGES, buildPipelineGraphSnapshot, handleConnectStages, addPresetStage, reportViolations, selectStageNode）— 技术债已存在，未恶化但未减少
- `customEdges` 不持久化的设计意图无代码注释，下一个 sprint 容易被误改
- 缺 e2e/integration 测试验证 "拖线 → 校验 → 提示" 完整流程
- `apps/api/src/pipeline-layouts/pipeline-layouts.controller.ts`: `parsePipelineId` 和 `parseActor` 两处 try-catch 模板可抽小 helper（10 行节省）

### 决策与修复记录

| Finding | 状态 | 处理 |
|---------|------|------|
| P1 actor 未授权访问 | ✅ 已修 | `pipeline-layouts.controller.ts` 改用 `@CurrentPrincipal()` 注入；GET/PUT 都从 `principal.actor` 取，**移除 actor query 参数**；web client 同步去掉 actor 形参 |
| P2-1 layout schema TS 双语言重复 | ⏭ Sprint C | 下沉 shared 议题 |
| P2-2 TektonTaskRunDetail 字段缺失 | ⏭ Sprint C | 扩 shared 类型 |
| P2-3 editor-core 大 component 技术债 | ⏭ Sprint C | 重构议题 |
| P2-4 customEdges 无注释 | ⏭ Sprint C | 配合 schema 扩展时一起处理 |
| P2-5 缺 e2e 测试 | ⏭ Sprint C | 引入 playwright 议题 |
| P2-6 parsePipelineId/parseActor 模板重复 | ⏭ Sprint C | 抽 helper |

修复后验证:
- api check + 47/47 测试 全绿
- web check 全绿
- pipeline-layouts.controller 不再接受 query 中的 actor，未授权访问路径已关闭

## Phase 5: 复利记录

### 新增 memory（2 条）

| 文件 | 类型 | 触发场景 |
|------|------|----------|
| `feedback_actor_from_principal_only.md` | feedback | 设计 per-user 资源 API 时；code review 看到 `@Query("actor")` 之类时 |
| `feedback_shared_pure_ts_api_zod_split.md` | feedback | 业务规则需在 web/api 共享但不想给 shared 加 prod 依赖时 |

### 关键决策沉淀

1. **DAG 下沉到 shared 但 Go 仍独立同步**：父文档 Sprint B 原本想"放 shared 改 Go bridge 通过 JSON 加载"，最终选纯 TS 校验放 shared + DAG 模板放 shared + Go 端继续硬编码 + sync test 守住（与 Sprint A `feedback-ts-go-constants-sync-test` 同模式）。
2. **stage-allowlist 与 no-reverse-stage 语义重叠**：当前 10 stage 线性 DAG 下，stage-allowlist 几乎不能独立触发——只有"跨过启用的 gate stage"场景能用到。规则保留作未来扩展（finally / 自定义 stage）的安全网。
3. **layout 表 actor 来自 principal**：P1 安全修复确立的原则——RBAC 解答"能不能做"，归属校验解答"能不能看这条"。两层独立。
4. **customEdges 不持久化**：Sprint B 范围决定，避免扩 PipelineDefinition schema。Sprint C 决定是否引入 `pipelines.runAfter` 字段或独立 customDependencies 表。
5. **tekton-task-run-panel 增量抽出**：未替换现有 tekton-run-panel，避免对 1300+ 行的 detail 文件做整体重构。Sprint C 可继续逐块拆分。

### 留给 Sprint C 的设计议题

- PipelineDefinition schema 是否扩展承载 customEdges
- TektonTaskRunDetail 类型补 conditionReason / conditionMessage
- layout payload schema 是否下沉 shared（消除 web TS interface ↔ api zod 双语言重复）
- editor-core 大 component 拆分（提 6 个 helper 到独立文件 / 自定义 hook）
- 引入 playwright e2e 测试覆盖 "拖线 → 校验 → 提示 → 保存" 完整流程
- finally 任务编排（10 stage 当前不含 finally）
- artifactCountsByStage 启发式映射 → Tekton TaskRun results 精准归属
- Layout API ↔ UI 接线（P0-2 暂搁，依赖 customEdges 持久化决策）
- adapter 是否下沉 shared（半下沉问题：DAG / 校验在 shared, adapter 还在 web）

## Phase 6 (后增): 跨 Sprint 综合审查 + P0 修复

2026-05-19 跨 Sprint A+B 综合审查发现 9 项问题，本会话立即修复 4 项 (P0×2 + P2 + P3)：

| # | 问题 | 严重度 | 状态 |
|---|------|--------|------|
| 1 | customEdges 静默丢失 (saveDraft 校验通过但 patch 不含 customEdges) | P0 | ✅ 加预览 banner + saveDraft confirm 阻断 |
| 2 | Layout API 完全 dead code | P0 | ⏭ Sprint C (依赖 customEdges 持久化决策) |
| 3 | invalidStagesSet 每渲染新 Set 破坏 useMemo | P0 | ✅ 包 useMemo (依赖 taskMissingConfig 的所有 state) |
| 4 | 半下沉 shared (adapter 还在 web) | P1 | ⏭ Sprint C |
| 5 | editor-core 1900+ 行未拆 | P1 | ⏭ Sprint C |
| 6 | 缺 integration / e2e | P2 | ⏭ Sprint C |
| 7 | dev principal "RO" fallback 漏到生产 | P2 | ✅ NODE_ENV=production 且 principal.authenticated=false 抛 401 |
| 8 | stage-allowlist 错误消息不清晰 | P3 | ✅ 补充原因 "中间已启用 stage 必须经过" |
| 9 | migration 时间戳与开发日期不一致 | P3 | 仅文档说明：20260519_pipeline_graph_layouts.sql 在 2026-05-19 创建 |

### 修复后验证

- shared 23/23
- api 47/47
- web 14/14
- go default + tekton build OK

### 修复涉及文件

- `apps/web/app/ui/pipeline-config/editor-core.tsx` (P0-3 useMemo + P0-1 confirm + banner)
- `apps/web/app/globals.css` (custom-edges-preview-banner 样式 + 暗色)
- `apps/api/src/pipeline-layouts/pipeline-layouts.controller.ts` (P2-7 生产环境拒绝 fallback)
- `packages/shared/src/tekton/dag-validation.ts` (P3-8 错误消息)

## 变更日志

- 2026-05-18: 从父文档拆出 Sprint B，覆盖 Task 5, 6, 8, 9, 10
- 2026-05-19: 全部 5 Task 完成 + Phase 4 review P1 安全修复 + 2 条 memory 沉淀，status → completed
- 2026-05-19 (后增): 跨 Sprint A+B 综合审查 + P0×2/P2×1/P3×1 即时修复 (P0-3 useMemo / P0-1 customEdges banner / P2-7 生产 fallback / P3-8 错误消息); P0-2/P1×2/P2-6/P3-9 归 Sprint C 议题
