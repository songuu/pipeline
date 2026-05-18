---
title: "ReactFlow Sprint A - 只读 DAG 价值验证"
type: sprint
status: completed
created: "2026-05-18"
updated: "2026-05-18"
parent: "docs/plans/2026-05-18-reactflow-pipeline-dag-integration.md"
tasks_total: 5
tasks_completed: 5
checkpoints: 0
tags: [sprint, frontend, reactflow, dag, tekton, sprint-a]
aliases: ["ReactFlow Sprint A", "只读 DAG 第一刀"]
---

# ReactFlow Sprint A: 只读 DAG 价值验证

> 父文档: [[2026-05-18-reactflow-pipeline-dag-integration]]
> 完整背景、技术方案、Task 详细 checkbox 见父文档对应 Task 段落。
> 本文档只跟踪 Sprint A 的范围、决策和进度。

## Phase 1: 需求分析

### Sprint A 在做什么

把"运行详情页只读 DAG"打通到能展示真实并行/fan-in 的程度，验证 ReactFlow 路线的工程价值。
不动配置页编排、不动 layout 持久化、不动自由连线编辑。

### Scope

| Task | 名称 | 风险等级 |
|------|------|----------|
| Task 1 | 装 `@xyflow/react`，搭 PipelineFlowCanvas + PipelineFlowNode 基础组件 | L1 |
| Task 2 | adapter (PipelineDefinition/PipelineRun/TektonTaskGraphNode → ReactFlow nodes/edges) + 单元测试 | L3 |
| Task 7 | 后端 `snapshot.service.ts` + `services/tekton-bridge/internal/backend/tekton.go` 从线性 stage 升级到真实 DAG | L3 |
| Task 3 | 运行详情页 `pipeline-run-detail.tsx` 用 PipelineFlowCanvas 替换 pipeline-board，只读模式 | L2 |
| Task 4 | 节点点击展示命令/日志/产物，local-docker 和 tekton 模式都要 | L2 |

### Non-scope（Sprint B 范围，不在本 sprint 做）

- 配置页可视化选择/启停 (Task 5)
- 配置页受控依赖编辑 / 新增节点 (Task 6)
- Tekton 深度观测 TaskRun/Step/when/timeout/retries/workspaces (Task 8)
- Supabase 图布局持久化 (Task 9)
- 视觉/性能/回归验证 (Task 10)
- 任何形式的自由连线编辑

### Success Criteria

- [ ] 运行详情页能看到真实 DAG，含并行（test.scan + test.unit 同层）和 fan-in（多 build → deploy）
- [ ] 节点点击联动右侧详情，展示命令、日志、产物
- [ ] local-docker 和 tekton 两种执行器复用同一 adapter，节点摘要语义一致
- [ ] adapter 单元测试覆盖线性 / 并行 / fan-in / 循环依赖 / 缺失 runAfter 兜底 / id 稳定性
- [ ] `pnpm --filter @deploy-management/web check && build` 通过
- [ ] `pnpm --filter @deploy-management/api check && build` 通过
- [ ] `go build ./...` 和 `go build -tags tekton ./...` 在 services/tekton-bridge 都通过

### 关键决策

1. **Task 7 提前到 Task 3 之前**: 让前端 adapter 一开始就能拿到真实并行/fan-in 数据，Task 3 验收才有意义。
2. **不引入 dagre/elkjs**: 第一版用受控自动布局（x 轴按执行层级、y 轴按并行分支），降低依赖。
3. **adapter 写在 web 层不动 shared**: 稳定后再沉淀到 `packages/shared`，避免改 shared 引发跨包级联。
4. **保留旧列布局作为 fallback**: 通过 feature flag 切换，方便回滚。
5. **Task 4 只挂命令和日志，不挂 TaskRun/Step**: Step 级细节归 Task 8 (Sprint B)。

### 风险

| # | 风险 | 缓解 |
|---|------|------|
| R1 | Task 7 改后端 snapshot 协议破坏现有 run 历史数据 | 改前先写并行/fan-in snapshot 测试基线，确保旧 stage 数据 fallback 兼容 |
| R2 | Tekton bridge 默认编译被拖入 client-go 依赖 | 必跑 `go build ./...`（默认无 tag）+ `go build -tags tekton ./...` 双 build 验证（参考 `feedback_tekton_buildtag_isolation`） |
| R3 | ReactFlow 容器在运行详情页多层滚动里塌陷 | Task 3 显式设置画布容器 `min-height` + `overflow: hidden`，用 ResizeObserver 监听父容器尺寸变化 |
| R4 | 1Hz 轮询导致节点 component 重建抖动 | `nodeTypes` 模块级常量，节点 data 浅比较友好，React DevTools Profiler 验证 |
| R5 | adapter 节点 id 不稳定导致刷新画布闪烁 | 单元测试明确验证"同一 PipelineDefinition 两次转换 id 完全一致" |

## Phase 2: 技术方案

通用片段见父文档 `docs/plans/2026-05-18-reactflow-pipeline-dag-integration.md` Phase 2 段。本节只补 Sprint A 特定的实现决策。

### 依赖与目录

- `pnpm --filter @deploy-management/web add @xyflow/react`
- 新建 `apps/web/app/ui/graph/`:
  - `pipeline-graph-types.ts` — Sprint A 只需 `PipelineGraphMode = "readonly"` 分支
  - `pipeline-graph-adapter.ts` — 纯函数
  - `pipeline-flow-canvas.tsx` — 封装 ReactFlow + Controls + Background
  - `pipeline-flow-node.tsx` — 统一节点
  - `__tests__/pipeline-graph-adapter.test.ts` — vitest
- Sprint A 不引入 `pipeline-flow-edge.tsx` / `pipeline-flow-toolbar.tsx`（留 Sprint B）

### 后端 DAG 策略（Task 7 核心）

当前 `apps/api/src/snapshot/snapshot.service.ts:413-430` 是线性：

```ts
runAfter: index === 0 ? [] : [pipeline.stages[index - 1]]
```

Tekton bridge `services/tekton-bridge/internal/backend/tekton.go:831-835` 同样线性。

升级方案：**默认 DAG 模板 + stages 子集裁剪**，不改 shared 类型。

```ts
// 默认 stage 依赖图（基于产品语义，与 stages 数组解耦）
const DEFAULT_STAGE_DAG: Record<LifecycleStageKey, LifecycleStageKey[]> = {
  source:   [],
  test:     ["source"],       // 与 build 并行
  build:    ["source"],       // 与 test 并行
  env:      ["test", "build"],// fan-in
  package:  ["env"],
  upload:   ["package"],
  deploy:   ["upload"],
  canary:   ["deploy"],
  approval: ["canary"],
  promote:  ["approval"],
};

function buildTaskGraph(pipeline, params, workspaces) {
  const stageSet = new Set(pipeline.stages);
  return pipeline.stages.map((stage) => ({
    name: stage,
    taskRef: `${stage}-task`,
    runAfter: (DEFAULT_STAGE_DAG[stage] ?? []).filter((dep) => stageSet.has(dep)),
    workspaces: ...,
    params: ...,
    retries: ...,
    timeoutSeconds: ...,
    when: ...,
  }));
}
```

兼容性保证：

- 旧数据 stages 顺序未变，runAfter 输出虽不同（test/build 现在都依赖 source 而非依赖前一个 stage），但 Tekton 执行顺序不变，只是允许并行
- pipeline 未启用某 stage（如 canary）时，DAG 自动跳过该节点的依赖
- shared 类型 `TektonTaskGraphNode.runAfter: LifecycleStageKey[]` 已支持多依赖，不需要 schema 迁移

Go bridge 镜像同步逻辑：在 `tekton.go:831-835` 附近用相同 `defaultStageDAG` map 替换线性 `input.Stages[index-1]`。

### Adapter 设计（Task 2 核心）

纯函数签名：

```ts
export function pipelineDefinitionToGraph(
  pipeline: PipelineDefinition,
  mode: "readonly" | "editable" = "readonly",
): { nodes: Node<PipelineGraphNodeData>[]; edges: Edge<PipelineGraphEdgeData>[] };

export function pipelineRunToGraph(
  run: PipelineRun,
  pipeline: PipelineDefinition,
): { nodes: Node<PipelineGraphNodeData>[]; edges: Edge<PipelineGraphEdgeData>[] };

export function tektonTaskGraphToGraph(
  taskGraph: TektonTaskGraphNode[],
): { nodes: Node<PipelineGraphNodeData>[]; edges: Edge<PipelineGraphEdgeData>[] };
```

节点 id 规则：`stage:${stageKey}`（确定性、稳定、跨刷新一致）。

布局：

- x 坐标 = stage 在 DAG 拓扑层级中的位置 × 240
- y 坐标 = 同层并行分支的索引 × 120
- 不引入 dagre/elkjs，自己写 BFS 拓扑分层
- finally 节点固定单独泳道（Sprint A 实际产品里暂无 finally，但 adapter 保留分支）

循环依赖检测：DFS 三色标记法，发现回边抛 `Error` 含可读 stage 序列。

### Task 3 容器策略

`pipeline-run-detail.tsx` 主区域当前是 `pipeline-board`（行 100+ 处）。替换策略：

- 加 feature flag `enableFlowCanvas` (env 或 URL 参数)，关闭时走旧 board
- ReactFlow 容器外层 `<div className="flex-1 min-h-[480px] overflow-hidden">`，避免父滚动塌陷
- ResizeObserver 监听容器尺寸变化，触发 `reactFlowInstance.fitView({ padding: 0.1 })`

### Task 4 节点详情接线

节点 `commandCount` 来自现有 `commandCountsByStage`（已存在于 `pipeline-run-detail.tsx`）。点击节点 → `setSelectedStageKey(node.id.replace("stage:", ""))`，复用现有右侧面板的 commands/artifacts/logs 渲染逻辑，不重写。

### 验证策略

| 层 | 命令 | 期望 |
|----|------|------|
| Adapter 单测 | `pnpm --filter @deploy-management/web exec vitest run app/ui/graph` | 6/6 pass |
| Web check | `pnpm --filter @deploy-management/web check` | exit 0 |
| Web build | `pnpm --filter @deploy-management/web build` | exit 0 |
| API check | `pnpm --filter @deploy-management/api check` | exit 0 |
| API build | `pnpm --filter @deploy-management/api build` | exit 0 |
| API 测试 | `pnpm --filter @deploy-management/api test` | snapshot.service 新增 parallel/fan-in 用例 pass |
| Go default build | `cd services/tekton-bridge && go build ./...` | exit 0，无 k8s.io/client-go |
| Go tekton build | `cd services/tekton-bridge && go build -tags tekton ./...` | exit 0 |

`pnpm` 双跑遵循 `feedback_pnpm_check_vs_build_drift`（SWC 比 tsc 宽松）。

## Phase 3: 任务拆解

每个 Task 的详细 checkbox 见父文档同名段落。本节只跟踪状态。

**执行顺序（依赖链）**:

```text
Task 1 (基础组件)
  └─ Task 2 (adapter + 单测)
       └─ Task 7 (后端 DAG) ──┐
                              ├─ Task 3 (运行详情页只读 DAG)
                                   └─ Task 4 (命令/日志接线)
```

Task 7 不强依赖 Task 1/2 完成（属于后端独立工作），但必须先于 Task 3 完成以提供真实并行数据。允许 Task 7 与 Task 2 在不同 worker 上 [P] 并行。

- [x] **Task 1**: 装 ReactFlow + 基础组件 — L1 ✅ check + build 通过
- [x] **Task 2**: adapter + 单元测试 — L3 ✅ 7/7 测试 + check + build 通过
- [x] **Task 7**: 后端 taskGraph 线性 → DAG — L3 ✅ api 36/36 测试 + 双 go build 通过
- [x] **Task 3**: 运行详情页只读 DAG — L2 ✅ check + build 通过，DAG/列布局可切换
- [x] **Task 4**: 命令详情和日志挂载节点 — L2 ✅ artifactCount/errorSummary helper 接入

## Phase 3: 任务拆解

每个 Task 的详细 checkbox 见父文档同名段落。本节只跟踪状态。

- [ ] **Task 1**: 装 ReactFlow + 基础组件 — L1
- [ ] **Task 2**: adapter + 单元测试 — L3
- [ ] **Task 7**: 后端 taskGraph 线性 → DAG — L3
- [ ] **Task 3**: 运行详情页只读 DAG — L2
- [ ] **Task 4**: 命令详情和日志挂载节点 — L2

> Sprint A 共 5 个 Task，按 `/sprint` 协议在 Task 5 完成后触发 checkpoint 复盘，决定是否进入 Sprint B。

## Phase 4: 审查结果

### 范围

5 视角审查仅针对 Sprint A 新增/改动文件（不审同分支预存的 security/、handoff docs/、supabase migrations 等无关变更）：

- `apps/api/src/snapshot/snapshot.service.ts`（+DAG 模板，导出 buildTaskGraph）
- `apps/api/src/snapshot/snapshot.service.spec.ts`（新）
- `apps/web/app/ui/graph/*`（4 新文件）
- `apps/web/app/ui/graph/__tests__/pipeline-graph-adapter.test.ts`（新）
- `apps/web/app/ui/sections/pipeline-run-detail.tsx`（接入 canvas + helper）
- `apps/web/app/globals.css`（+ReactFlow @import + .pipeline-view 组）
- `apps/web/package.json`、`apps/web/vitest.config.ts`
- `services/tekton-bridge/internal/backend/tekton.go`（+defaultStageDAG）

### 五视角审查

| 视角 | 结论 |
|------|------|
| 架构 | adapter 纯函数 ✓；feature flag 双轨可回滚 ✓；DAG 模板在 TS + Go 双重定义存在同步风险 |
| 安全 | 无用户输入路径；adapter 输入来自服务端 PipelineDefinition；errorSummary 80 字符截断；React 文本渲染无 XSS |
| 性能 | adapter id 稳定 ✓；NODE_TYPES 模块级常量 ✓；**`pipelineRunToGraph` 在 JSX 内联调用，1Hz SSE 刷新会每次重建 nodes/edges** |
| 代码质量 | 类型严格 ✓；无 console.log；无注释垃圾；artifact/errorSummary 启用启发式映射但已文档化 |
| 测试覆盖 | adapter 7/7、snapshot 6/6 覆盖 parallel/fan-in/cycle/id 稳定/缺失上游/默认链 ✓ |

### Findings

**P0**: 无。

**P1**:

- `apps/web/app/ui/sections/pipeline-run-detail.tsx:接入处`: perf: `pipelineRunToGraph(run, {...})` + `artifactCountsByStage(...)` + `errorSummariesByStage(...)` 内联在 JSX，每次 render（包括 1Hz SSE liveRunEvents 更新）都重建。**对应风险 R4**。修复: 用 `useMemo` 包装这三个计算，依赖项为 `run`, `runArtifacts`, `commandCountsByStage`, `tektonRun?.taskRuns`。
- `apps/api/src/snapshot/snapshot.service.ts:DEFAULT_STAGE_DAG` 与 `services/tekton-bridge/internal/backend/tekton.go:defaultStageDAG`: design: 同一份 DAG 在两个语言定义，未来产品改 lifecycle 易漂移。修复方向（任选一）：(a) Sprint B 中将 DAG 移到 shared 包 + Go bridge 通过 JSON 配置加载；(b) 加 CI 同步检测脚本；(c) 暂接受现状，写在文档里。

**P2**（写入 doc，不阻塞 Compound）:

- `pipeline-run-detail.tsx:errorSummariesByStage`: regex `/error|fail|exception|×|✗/i` 不覆盖中文 "错误/失败/异常"。中文日志的 failed stage 会落到 "logs 末尾行" 分支，仍可用但不精准。
- `pipeline-run-detail.tsx:artifactCountsByStage`: image/package/sbom 到 stage 的映射是启发式（image→upload or build）。Sprint B 引入 Tekton TaskRun results 后应改为按 task result 精准归属。
- `pipeline-flow-node.tsx`: UI 组件未单测。Sprint B Task 10 视觉/性能验收覆盖。
- `apps/web/app/globals.css`: 新 `.pipeline-view-toolbar` 样式没有暗色系（codeup-shell）对应分支。Sprint B Task 10 视觉一致性段处理。

### 决策与修复记录

用户要求"全部修了"，本 sprint 处理 P1 + 可低成本完成的 P2。

| Finding | 状态 | 处理 |
|---------|------|------|
| P1-1 useMemo 优化 | ✅ 已修 | `pipeline-run-detail.tsx` 包裹 `pipelineFlowGraph` + 4 个中间 map 计算，依赖 run/runArtifacts/tektonRun.taskRuns/liveRunEvents |
| P1-2 TS↔Go DAG 同步 | ✅ 已修 | 在 `snapshot.service.spec.ts` 新增 sync test，用 regex 解析 `tekton.go` 的 `defaultStageDAG` 字面量并与 `DEFAULT_STAGE_DAG` 比对；任一侧漂移即测试失败 |
| P2-1 errorSummary 中文 | ✅ 已修 | regex 扩展为 `/error\|fail\|exception\|×\|✗\|错误\|失败\|异常\|未通过\|超时/i` |
| P2-2 codeup-shell 暗色 toolbar | ✅ 已修 | globals.css 加 `.codeup-shell .pipeline-view-toolbar/.pipeline-view-toggle/.pipeline-flow-shell` 暗色覆盖 |
| P2-3 pipeline-flow-node 单测 | ⏭ 留 Sprint B | 需 jsdom 环境，归到 Task 10 视觉/性能验收 |
| P2-4 artifactCountsByStage 启发式映射 | ⏭ 留 Sprint B | Tekton TaskRun results 接入后改为精准归属（Task 8 范围） |

修复后验证：
- web check + build + test (7/7 adapter) 全绿
- api test 37/37 全绿（snapshot 7 测试含 sync test）
- go default + tekton 双 build 仍绿


## Phase 5: 复利记录

### 新增 memory（3 条）

| 文件 | 类型 | 触发场景 |
|------|------|----------|
| `project_pipeline_default_dag.md` | project | 改 stage 拓扑 / 新增 stage / 评估 DAG 修改 |
| `feedback_ts_go_constants_sync_test.md` | feedback | 任何"业务规则需双语言镜像"的场景，先想 sync test 不要先想 codegen |
| `feedback_reactflow_perf_guardrails.md` | feedback | 接 ReactFlow（或同类图组件）时性能纪律 |

### 关键决策沉淀

1. **TS↔Go DAG 同步方案选 sync test 而非 codegen / shared 包**: 单测 regex 解析对方源码，零额外 build artifact，CI 已跑 vitest 无需新配置
2. **adapter 写在 web 层而非 shared**: 父文档预定的"稳定后再沉淀"策略验证有效；shared 类型 `TektonTaskGraphNode.runAfter: LifecycleStageKey[]` 已能装 DAG，不需要 schema 迁移
3. **feature flag 用 useState toggle 而非 env**: 第一版只在客户端切换，避免 SSR / build 复杂度

### 留给 Sprint B 的设计议题

- adapter 是否下沉到 shared（依赖图组件抽象层评估）
- artifactCountsByStage 从启发式映射改为 Tekton TaskRun results 精准归属
- pipeline-flow-node 单测（需 jsdom 环境）
- 性能基准测试 + 50 节点渲染指标

## 变更日志

- 2026-05-18: 从父文档拆出 Sprint A，覆盖 Task 1, 2, 7, 3, 4
- 2026-05-18: 全部 5 Task 完成 + Phase 4 review P1/P2 修复 + 3 条 memory 沉淀，status → completed
