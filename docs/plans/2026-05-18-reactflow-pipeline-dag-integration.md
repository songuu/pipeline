---
title: "ReactFlow Pipeline DAG Integration"
type: sprint
status: planning
created: "2026-05-18"
updated: "2026-05-18"
tasks_total: 10
tasks_completed: 0
tags: [sprint, frontend, reactflow, dag, tekton, pipeline]
aliases: ["ReactFlow 流水线 DAG 接入", "流水线可视化编排"]
---

# ReactFlow Pipeline DAG Integration

## Phase 1: 需求分析

当前系统已经具备云效 Flow 风格的流水线配置页、运行详情页、模板市场和 Tekton 控制面，但流水线图形能力仍是手写 CSS 布局：

- 模板市场使用 `MiniFlow` 只展示 chips 和简单分组连线。
- 流水线配置页使用 `flow-config-board` / `flow-stage-lane` 固定列布局。
- 运行详情页使用 `run-canvas` / `pipeline-board` / `JobCard` 纵列展示阶段任务。
- Tekton 数据模型已有 `TektonTaskGraphNode.runAfter` 和 `PipelineSpec.tasks`，但后端 `buildTaskGraph` 当前仍按线性 stage 生成。

用户希望研究并落地类似 ReactFlow 的流水线场景。目标不是单纯引入一个图组件，而是将系统升级为可承载真实 CI/CD、Tekton DAG、命令详情、运行状态和后续可编辑编排的统一图能力。

## 当前证据

- `apps/web/package.json` 当前没有 `@xyflow/react` / `reactflow` 依赖。
- `apps/web/app/ui/components/primitives.tsx` 中 `MiniFlow` 是轻量模板预览，不具备拖拽、缩放、连线能力。
- `apps/web/app/ui/pipeline-config/editor-core.tsx` 的流程配置页是固定列 + button 任务选择。
- `apps/web/app/ui/sections/pipeline-run-detail.tsx` 的运行详情页是阶段列布局。
- `packages/shared/src/tekton/index.ts` 已定义 `TektonTaskGraphNode`、`PipelineTaskRef` 和 `PipelineSpec`，具备 DAG 数据基础。
- `apps/api/src/snapshot/snapshot.service.ts` 的 `buildTaskGraph` 目前按 stage 顺序生成 `runAfter`，尚未表达并行、fan-in/fan-out、when、finally。
- `docs/plans/2026-05-08-tekton-cicd-architecture.md` 曾明确规划 “DAG 可视化用 React Flow”。

## 目标范围

### In Scope

1. 引入 `@xyflow/react`，建立统一流水线图组件。
2. 新建图数据 adapter，将 `PipelineDefinition`、`PipelineRun`、`TektonTaskGraphNode` 转换成 ReactFlow nodes / edges。
3. 运行详情页优先升级为只读 DAG 视图。
4. 节点点击联动右侧详情，展示命令、日志、产物、Tekton TaskRun / Step。
5. 配置页逐步升级为可视化编排页，先支持选择、启停、预设节点，再支持依赖编辑。
6. 后端 `buildTaskGraph` 从线性 stage 升级为受控 DAG。
7. 为后续 Supabase 图布局存储预留 schema。

### Out of Scope

1. 第一版不做完全自由的任意节点脚本编辑器。
2. 第一版不允许用户任意构造危险 shell 流程，只开放受控任务模板。
3. 第一版不改变 local-docker / tekton 执行器的主执行协议。
4. 第一版不强制替换模板市场的 `MiniFlow`，模板列表保留轻量预览。

## Phase 2: 技术方案

### 依赖选择

使用 React Flow v12 的官方包：

```bash
pnpm --filter @deploy-management/web add @xyflow/react
```

不用旧 `reactflow` 包，避免后续 API 和样式迁移成本。

### 前端目录规划

新增目录：

```text
apps/web/app/ui/graph/
  pipeline-graph-types.ts
  pipeline-graph-adapter.ts
  pipeline-flow-canvas.tsx
  pipeline-flow-node.tsx
  pipeline-flow-edge.tsx
  pipeline-flow-toolbar.tsx
```

职责划分：

- `pipeline-graph-types.ts`：前端图节点、边、模式、事件类型。
- `pipeline-graph-adapter.ts`：业务模型到 ReactFlow 模型的唯一转换入口。
- `pipeline-flow-canvas.tsx`：封装 `ReactFlow`、`Controls`、`Background`、布局和事件。
- `pipeline-flow-node.tsx`：统一节点外观，承载状态、耗时、命令数、产物数。
- `pipeline-flow-edge.tsx`：统一边样式，区分 `runAfter`、`condition`、`artifact`、`approval`、`finally`。
- `pipeline-flow-toolbar.tsx`：缩放、适配视图、显示命令、显示 Tekton 元信息等控制项。

### 图模型

优先在 web 层建立 adapter，避免直接大改 shared。稳定后再沉淀到 shared。

```ts
export type PipelineGraphMode = "readonly" | "editable" | "template-preview";

export type PipelineGraphEdgeKind =
  | "runAfter"
  | "condition"
  | "artifact"
  | "approval"
  | "finally";

export interface PipelineGraphNodeData {
  stage: LifecycleStageKey;
  title: string;
  subtitle?: string;
  status?: StageStatus;
  commandCount?: number;
  artifactCount?: number;
  durationMs?: number;
  taskRunName?: string;
  selected?: boolean;
  disabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PipelineGraphEdgeData {
  kind: PipelineGraphEdgeKind;
  label?: string;
  condition?: string;
  active?: boolean;
}
```

### 布局策略

第一版使用受控自动布局：

- x 轴按执行层级排列。
- y 轴按并行分支排列。
- source 固定在最左侧。
- finally 固定在底部或末尾独立泳道。
- canary / approval / promote 保持发布链路连续。

后续如果 DAG 复杂度上升，再评估引入 `dagre` 或 `elkjs`，但第一版不额外引入布局库，降低依赖和调试成本。

## Phase 3: 任务拆解

> **Sprint 拆分**: 10 个 Task 跨度过大，建议拆为两个 sprint：
>
> - **Sprint A (Task 1, 2, 7, 3, 4)**: ReactFlow 接入 + adapter + 后端真实 DAG + 运行详情只读 DAG + 命令详情。Task 7 提前到 Task 3 之前，避免前端拿到退化线性 DAG 验证不了并行场景。
> - **Sprint B (Task 5, 6, 8, 9, 10)**: 配置页编排 + 依赖编辑 + Tekton 深度观测 + Supabase layout + 回归验证。
>
> Task ID 保持稳定不重排，仅调整执行顺序。

### Task 1: 安装 ReactFlow 并建立基础图组件

- [ ] 安装 `@xyflow/react`。
- [ ] 在 `apps/web/app/globals.css` 或组件入口引入 ReactFlow 基础样式。
- [ ] 新增 `PipelineFlowCanvas`，支持 readonly 模式。
- [ ] 新增自定义节点 `PipelineFlowNode`。
- [ ] 新增基础边样式。

验证：

```bash
pnpm --filter @deploy-management/web check
pnpm --filter @deploy-management/web build
```

### Task 2: 建立业务模型到图模型的 adapter

- [ ] `PipelineDefinition` -> 图节点/边。
- [ ] `PipelineRun` -> 带状态的图节点/边。
- [ ] `TektonTaskGraphNode[]` -> Tekton DAG 图节点/边。
- [ ] 对缺失 `runAfter` 的节点做兜底排序。
- [ ] 对循环依赖做防御性检测并输出可读错误。

关键点：

- adapter 必须是纯函数，方便单元测试。
- 不在 React 组件里拼业务依赖关系。
- 节点 id 必须稳定，避免运行中刷新导致画布抖动。

单元测试（L3 核心逻辑，必须有）：

- [ ] 线性 DAG: source -> build -> deploy 正确转换
- [ ] 并行分支: test.scan + test.unit 同层，runAfter 都指向 source
- [ ] fan-in: deploy 依赖多个 upload，edges 正确聚合
- [ ] 循环依赖检测: A->B->A 抛可读错误，不卡死
- [ ] 缺失 runAfter 兜底: 按 stage 顺序补默认依赖
- [ ] 节点 id 稳定性: 同一 PipelineDefinition 两次转换 id 完全一致

放在 `apps/web/app/ui/graph/__tests__/pipeline-graph-adapter.test.ts`，vitest 跑。

### Task 3: 运行详情页接入只读 DAG

> 前置依赖: Task 7 必须先完成，否则后端仍输出线性 runAfter，前端无法验证并行/fan-in 场景。

- [ ] 在 `pipeline-run-detail.tsx` 中使用 `PipelineFlowCanvas` 替换主区域 `pipeline-board`。
- [ ] 保留旧列布局作为 fallback，方便快速回滚。
- [ ] 节点点击后同步 `selectedStageKey`。
- [ ] 节点展示执行状态、耗时、命令数和产物数。
- [ ] 运行中节点增加轻量状态动画。
- [ ] 画布容器高度策略文档化: 使用 ResizeObserver 或固定 vh，避免 ReactFlow 尺寸塌陷。
- [ ] 右侧详情面板展开/收起时画布触发 fitView 自适应。
- [ ] 多层滚动边界显式 `overflow: hidden` + `min-height`，验证窄屏不出白色原生滚动条。

验收：

- 成功、失败、运行中、等待、跳过状态都能正确显示。
- 点击节点后右侧 Tekton / Artifacts / Params 面板定位正确。
- 长命令不挤压节点，只在详情里展示。
- 并行节点 (test.scan + test.unit) 在 y 轴正确分层，不重叠。

### Task 4: 命令详情和日志挂载到节点

- [ ] 节点摘要展示 “N 条命令”。
- [ ] 节点点击后展示该 stage 的固定命令和流式命令。
- [ ] local-docker 模式展示真实命令输出。
- [ ] tekton 模式展示 TaskRun / Step / Pod logs。
- [ ] 失败节点展示首个错误摘要和查看详情入口。

### Task 5: 流水线配置页接入可视化选择

- [ ] 在 `editor-core.tsx` 的 `flow` tab 接入 editable 模式画布。
- [ ] 点击节点选中并联动现有右侧配置面板编辑。
- [ ] 支持启用/禁用已有阶段（不删除）。
- [ ] 保留现有 `flow-stage-lane` 布局为 fallback。

第一版只做"节点选中 + 启停 + 现有面板编辑"。**新增节点和依赖编辑放到 Task 6**，避免 5/6 边界糊。

### Task 6: 配置页支持受控依赖编辑

- [ ] 支持新增预设任务：审批、灰度、部署、上传（从工具栏拖入或点击添加）。
- [ ] 新增节点自动按 stage 推断默认 runAfter，不需用户手动拉线。
- [ ] 支持拖线建立 `runAfter`。
- [ ] 支持删除非必需边和非必需节点。
- [ ] source 节点不可删除。
- [ ] deploy / canary / approval / promote 按发布规则限制依赖（不能反向跨阶段）。
- [ ] 保存前做 DAG 校验：无环、无孤儿关键节点、上传前必须构建镜像。

### Task 7: 后端 taskGraph 从线性升级为 DAG

修改：

- `apps/api/src/snapshot/snapshot.service.ts`
- `services/tekton-bridge/internal/backend/tekton.go`

目标：

- `source -> test.scan + test.unit -> build`
- `build -> env -> package -> upload`
- `upload -> deploy -> canary -> approval -> promote`
- `finally -> result / chains / cleanup`

需要同时兼容：

- server package
- container image
- static site
- local-docker
- tekton

Tekton bridge 改动必须保持 build-tag 隔离（参考 `feedback_tekton_buildtag_isolation`）：

- [ ] `go build ./...`（默认 tag，无 tekton）不引入 client-go / k8s 依赖
- [ ] `go build -tags tekton ./...` 通过
- [ ] CI 两个 build 都跑

snapshot.service.ts 改动验收：

- [ ] 现有 snapshot 测试全绿
- [ ] 新增并行场景测试: 一个 PipelineDefinition 含两个独立 test stage，输出的 taskGraph 中两个节点 runAfter 都指向 source
- [ ] fan-in 测试: deploy 依赖多个 build 节点

### Task 8: Tekton 深度观测接入节点详情

- [ ] 从 Tekton TaskRun 反查 pipelineTaskName。
- [ ] 节点详情展示 TaskRun status / reason / message。
- [ ] 节点详情展示 Step 列表。
- [ ] 点击 step 拉取 logs。
- [ ] 显示 `when`、`timeout`、`retries`、`workspaces`、`params`。

### Task 9: Supabase 图布局预留

新增迁移候选：

```sql
create table if not exists pipeline_graph_layouts (
  id uuid primary key default gen_random_uuid(),
  pipeline_id text not null,
  version integer not null default 1,
  nodes jsonb not null default '[]',
  edges jsonb not null default '[]',
  viewport jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

原则：

- 执行 DAG 仍以业务配置和 Tekton taskGraph 为准。
- Supabase layout 只存 UI 位置、缩放和显示偏好。
- 不允许 layout 覆盖真实执行依赖。
- Supabase 是 opt-in（参考 `project_supabase_storage_opt_in`），默认走 JSON 存储，仅当 `DEPLOYMENT_STORAGE=supabase` 时启用此表。

安全校验（第一版就要到位，参考 `feedback_zod_security_first_pass`）：

- [ ] 定义 zod schema: `pipelineGraphLayoutSchema`
  - `pipeline_id`: 长度 ≤ 128，字符集 `[a-zA-Z0-9._-]`
  - `nodes`: 数组上限 500，每个节点 jsonb 序列化后 ≤ 8KB
  - `edges`: 数组上限 2000
  - `viewport`: `{ x: number, y: number, zoom: 0.1-4 }`
- [ ] 写入 API 用 zod 强校验，拒绝超大或畸形 jsonb
- [ ] 读取 API 加上 actor 鉴权（不允许跨用户读 layout）
- [ ] 总 jsonb 大小上限 256KB，超过返回 413

### Task 10: 视觉、交互和回归验证

视觉与交互：

- [ ] 画布在暗色系统中保持一致视觉。
- [ ] 节点不重叠。
- [ ] 宽屏、窄屏、右侧详情面板都可用。
- [ ] 缩放、拖动、fit view 可用。
- [ ] 页面无白色原生滚动条。

性能（参考风险 5）：

- [ ] 50 节点 DAG 首次渲染 < 200ms（chrome perf 录制）
- [ ] 1Hz 状态轮询不触发 node component 重建（React DevTools Profiler 验证）
- [ ] `nodeTypes` / `edgeTypes` 用模块级常量或 `useMemo` 稳定引用
- [ ] 节点 props 用浅比较友好的结构，避免每帧 re-render

构建验证（按 `feedback_pnpm_check_vs_build_drift`，check 和 build 都要跑）：

```bash
pnpm --filter @deploy-management/shared check
pnpm --filter @deploy-management/shared build
pnpm --filter @deploy-management/api check
pnpm --filter @deploy-management/api build
pnpm --filter @deploy-management/web check
pnpm --filter @deploy-management/web build
git diff --check -- apps packages services docs
```

## Phase 4: 风险与审查重点

### 风险 1: ReactFlow 尺寸塌陷

ReactFlow 容器必须有稳定宽高。运行详情页当前有多层滚动和右侧面板，接入时要显式设置画布容器高度、`min-height` 和 `overflow` 边界。

### 风险 2: 图布局与业务执行顺序混淆

拖动节点位置不能改变执行顺序。执行顺序只能来自 `runAfter` / `when` / `finally` 等业务字段。

### 风险 3: 过早开放自由编排

任意连线会引入大量校验复杂度。第一版只做只读 DAG 和受控启停，第二版再做依赖编辑。

### 风险 4: Tekton 与 local-docker 语义不一致

local-docker 可能只有 stage 级命令，Tekton 有 TaskRun / Step。adapter 必须统一成节点详情模型，不能让页面分叉太多。

### 风险 5: 性能问题

ReactFlow 节点数据需要稳定引用，运行中轮询刷新不能每秒重建所有 node type 和 handler。

## 推荐执行顺序（已修订）

**Sprint A（约 5 个 Task，~5 工作日）**:

1. Task 1：装 ReactFlow + 基础图组件
2. Task 2：adapter + 单元测试
3. **Task 7：后端 taskGraph 线性 → DAG（提前）** — 让 adapter 有真实并行/fan-in 数据可消费
4. Task 3：运行详情页只读 DAG
5. Task 4：命令详情和日志挂载到节点

**Sprint A checkpoint，先复盘真实价值再决定是否继续 Sprint B。**

**Sprint B（约 5 个 Task）**:

6. Task 5：配置页可视化选择（节点启停 + 现有面板）
7. Task 6：受控依赖编辑（新增节点 + 拖线 runAfter）
8. Task 8：Tekton 深度观测接入节点详情
9. Task 9：Supabase 图布局（opt-in + zod 校验）
10. Task 10：视觉/性能/回归验证

修订原因：

- Task 7 必须先于 Task 3，否则前端拿到的是退化线性 DAG，验收无法覆盖并行场景
- 10 个 Task 跨度过大，触发 `/sprint` 协议的 checkpoint 阈值，拆为两个 sprint 降低上下文压力

## 验收标准

- 运行详情页能看到真实 DAG，不再只是静态列布局。
- 每个节点都能点击查看对应执行详情。
- 命令、日志、产物、TaskRun / Step 能和节点准确关联。
- 配置页能通过图节点选择并编辑对应任务配置。
- DAG 能表达串行、并行、条件、审批、灰度、finally。
- local-docker 和 tekton 两种执行器都能复用同一图组件。
- 构建和类型检查通过。

## 下一 Phase 预热（Phase 3: Work — Sprint A）

关键文件: `apps/web/package.json`（先装 `@xyflow/react`）、`apps/api/src/snapshot/snapshot.service.ts`（Task 7 提前）、`services/tekton-bridge/internal/backend/tekton.go`
执行命令: `pnpm --filter @deploy-management/web add @xyflow/react`、`grep -rn "buildTaskGraph" apps/api`、`go build -tags tekton ./...`（在 services/tekton-bridge）
风险预判: Task 7 提前到 Task 3 之前，需确认 snapshot 协议改动不破坏现有 run 数据；adapter 单测必须先行，否则前端验证无依据。

## 修订记录

- 2026-05-18: 基于 sprint 文档分析补丁修订（共 8 处）
  - Sprint 拆分: Task 1-4 → Sprint A, Task 5-10 → Sprint B
  - 执行顺序: Task 7 提前到 Task 3 之前
  - Task 2: 新增 6 项 adapter 单元测试 checkbox
  - Task 3: 新增容器高度策略、fitView 自适应、并行节点验收
  - Task 5: 收紧范围为"选择 + 启停"
  - Task 6: 接管"新增节点"，新增默认 runAfter 推断
  - Task 7: 新增 build-tag 隔离验证、snapshot 并行/fan-in 测试
  - Task 9: 标注 Supabase opt-in、补 zod schema 安全校验
  - Task 10: 新增 3 项性能指标
