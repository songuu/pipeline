---
title: "CI/CD 优化 Sprint 1 — T1 + T8"
type: sprint
status: completed
created: "2026-05-15"
updated: "2026-05-15"
checkpoints: 0
tasks_total: 8
tasks_completed: 8
tags: [sprint, cleanup, test-baseline, cicd, vitest]
aliases: ["Sprint 1 清扫派 + 测试基线"]
parent: "docs/plans/2026-05-15-cicd-optimization-analysis.md"
roadmap:
  - "Sprint 1 (本轮): T1 + T8 — 流程边界 + 测试基线 ✅"
  - "Sprint 2: T4 + T3 — shared/web 拆分"
  - "Sprint 3: T5 + T2 — ServiceConnection + RunnerQueue"
  - "Sprint 4: T7 + T6 — DB adapter + DeploymentTarget"
---

# CI/CD 优化 Sprint 1 — T1 (退场死代码) + T8 (TS 测试基线)

## Phase 1: 范围

**做什么：**
- T1: 删除 `simulateUntilGate` 死代码 + `mode === "instant"` 4 处分支
- T8: Vitest 测试基线 + 4 个核心模块单测

**不做什么：**
- 不动 dev seed（已是空数组）
- 不动 controller / DTO（mode 字段本来就不在 DTO 里）
- 不写 e2e / 集成测试（先单测兜底）

**成功标准：**
- `grep -rn "simulateUntilGate\|options\.mode === \"instant\"" apps/api/src` 0 命中
- `pnpm -r check && pnpm -r build` 绿
- `pnpm -r test` 绿，4 个核心模块覆盖
- API 启动 + 触发 run 行为不变

**风险：**
- T1 改了 `runs.service.ts` 公共方法签名（移除 options 参数），需复核所有调用方
- vitest 与 Nest 11 / Next 16 兼容性；选 `vitest@^2` 配 `tsx` loader

## Phase 2: 任务拆解

### T1 — 退场 simulateUntilGate

实际状态比 audit 简化：`seed-data.ts` 已空，controller 不传 `options`，所以 `simulateUntilGate` 与 `mode === "instant"` **本就是死代码**，直接删。

- [x] **Task 1**: 删除 `apps/api/src/lifecycle/lifecycle.engine.ts` 的 `simulateUntilGate` 方法
- [x] **Task 2**: 简化 `apps/api/src/runs/runs.service.ts` — 移除 `options.mode` + 4 处 instant 分支 + `assertRealArtifactPrerequisites` 简化签名
- [x] **Task 3**: `pnpm --filter @deploy-management/api check` 绿
- [x] **Task 4**: vitest@2.1.9 装在 root + api + shared；新建 `apps/api/vitest.config.ts` 和 `packages/shared/vitest.config.ts`；`pnpm test` 走 `pnpm -r --if-present test`
- [x] **Task 5**: `apps/api/src/common/ids.spec.ts` — 6 个 case（前缀 / 唯一性 / base36 timestamp / hex 后缀 / 同毫秒区分）
- [x] **Task 6**: 直接 `export parseRemoteRepository` + `repositoryIdFor`（避免大重构）+ `apps/api/src/code-repos/remote-url.spec.ts` 13 case（GitHub HTTPS/SSH/tree/blob/releases、GitLab nested namespace、GitCode api 路径规范化、explicit provider override、错误路径）
- [x] **Task 7**: `packages/shared/src/resolve-image-artifact.spec.ts` — 12 case（tag 渲染 / 占位 fallback / sanitize / 长度限制 / latest fallback / registry URL / internal switch / namespace+imageName 清洗 / imageRef 拼装）
- [x] **Task 8**: `pnpm -r --if-present test` → 31 tests passed across 3 spec files

### 变更日志

**T1 文件改动：**
- `apps/api/src/lifecycle/lifecycle.engine.ts`
  - 删除 `simulateUntilGate(run, failureStage?)` 方法（53 行）
  - 顶部加注释说明 sprint-1 退场
- `apps/api/src/runs/runs.service.ts`
  - `trigger(pipelineId, request)` 不再接受 `options` 参数，运行强制走 realtime executor
  - 删除 4 处 `options.mode === "instant"` 分支
  - `assertRealArtifactPrerequisites(pipeline)` 简化签名，移除内部 `mode === "instant"` 检查（已不可达）
  - 注释更新："the legacy `instant` mode was retired in sprint-1"
- `apps/api/src/code-repos/code-repos.service.ts`
  - `parseRemoteRepository` 与 `repositoryIdFor` 改为 `export`
  - `export type { ParsedRemoteRepository }` 供 spec 使用

**T8 文件改动：**
- `package.json` — root 加 `"test": "pnpm -r --if-present test"`
- `apps/api/package.json` — 加 `"test": "vitest run"` + `vitest@^2.1.8` devDep
- `packages/shared/package.json` — 加 `"test": "vitest run"` + `vitest@^2.1.8` devDep
- `apps/api/vitest.config.ts` — 新增（node env，include `src/**/*.{spec,test}.ts`）
- `packages/shared/vitest.config.ts` — 新增（同上）
- `apps/api/src/common/ids.spec.ts` — 新增（6 tests）
- `apps/api/src/code-repos/remote-url.spec.ts` — 新增（13 tests）
- `packages/shared/src/resolve-image-artifact.spec.ts` — 新增（12 tests）

## Phase 4: 审查结果

### P0
无。

### P1（pre-existing，非本 sprint scope）
- `apps/api/src/executors/local-docker.executor.ts:473` — pushEvent 用 `type: "command"` 但 shared 的 `RunEvent` 类型 union 不含 `"command"`。`pnpm api check` 通过，但 `pnpm -r check` 失败。
  - **修复建议：** shared `RunEvent.type` 加入 `"command"` literal（5 分钟）。
- `apps/web/app/ui/sections/pipeline-run-detail.tsx` — 引用 6 个未定义函数（`countCommandEventsByStage` / `eventStageKey` / `commandEventsToExecutionCommands` / `plannedExecutionCommandsForStage` / `executionScript` / `executionCommandStatusLabel`），mid-refactor 残留。
  - **修复建议：** 单独 follow-up sprint 补齐 command-event 派发的前端展示链路（建议挂在 Sprint 2 的 T3 配置编辑器拆分一起做，因为都涉及 web 重构）。
- `pnpm -r check` 因上述 web 错误失败，但 `pnpm -r build` 全绿（Next.js SWC 比 tsc 宽松）。

### P2
- `vitest@2.1.x` 提示 "CJS build of Vite's Node API is deprecated" — 不影响功能；后续升 vitest@3 可消除。
- 当前 root `pnpm test` 跑了 19+12=31 用例，没覆盖 web 端；待 web 重构后补 React Testing Library。

### 验证

- `pnpm --filter @deploy-management/api check` ✅
- `pnpm --filter @deploy-management/shared check` ✅
- `pnpm -r build` ✅（all 4 workspace projects）
- `pnpm -r --if-present test` ✅ — 31 tests passed
  - `packages/shared/src/resolve-image-artifact.spec.ts`: 12 / 12
  - `apps/api/src/common/ids.spec.ts`: 6 / 6
  - `apps/api/src/code-repos/remote-url.spec.ts`: 13 / 13
- `grep -rn "simulateUntilGate" apps/api/src` → 仅剩 1 行注释，无代码引用
- `grep -rn 'options\.mode === "instant"' apps/api/src` → 0 命中

## Phase 5: 复利记录

### 可沉淀经验

1. **Audit 文档要看实际状态而非纸面 P0**：audit P0-2 列了 4 处 `mode === "instant"` 死代码，但 `seed-data.ts` 已空 + controller 不传 `options`，实际删除工作量从预估 0.5 天降到 30 分钟。**结论：** sprint plan phase 必须先扫一遍代码，不能只读 audit。
2. **vitest 不需要 pnpm hoist 也能跑**：在 monorepo 各 package 单独装 + 配自己的 `vitest.config.ts`，`pnpm -r --if-present test` 直接串起来。`--if-present` 让没有 test script 的 package（apps/web）静默跳过。
3. **抽函数测试 vs export 已有函数**：本来计划"抽 `parseRemoteRepository` 到独立文件"，实际改为 `export` 现有函数 + spec 直接 import。**收益：** 0 行业务逻辑改动，spec 文件 + 2 行 export 即完成；保留了重构的灵活度（后续真要拆模块时再做）。
4. **`pnpm -r check` vs `pnpm -r build` 行为差异**：Next.js `next build` 用 SWC，比 `tsc --noEmit` 宽松。本仓库存在 build 绿但 check 红的 pre-existing 状态。**结论：** sprint 完成度判断应同时跑两者，不能只看其中一个。

### 知识沉淀路径

- 经验 1 → `docs/plans/2026-05-15-cicd-optimization-analysis.md` 已用类似思路（"现状对照表"先于 audit P0），可以反过来固化为 `/sprint plan` 的强制 step
- 经验 2 → 加入 memory `feedback_vitest_monorepo_pattern.md`
- 经验 4 → 加入 memory `feedback_pnpm_check_vs_build_drift.md`

### 下一步（Sprint 2 预热）

按 roadmap 进入 **Sprint 2: T4 + T3**（shared/web 拆分）。

**Sprint 2 起点：**
- 关键文件：`packages/shared/src/index.ts`（1389 行 → 7 子域）+ `apps/web/app/ui/sections/pipeline-config-editor.tsx`（2344 行 → 6 panel）
- 顺序建议：先 T4（shared 拆分）再 T3（web 拆分），因为 web 拆分会大量 import shared 的子模块
- 顺手：Sprint 2 内可以一起修本 sprint Phase 4 的 P1 列表（local-docker `"command"` event 类型 + pipeline-run-detail 6 个缺函数）

**Sprint 2 风险预判：**
- T3 拆 2344 行有视觉回归风险，必须 panel-by-panel 启动 dev server 手测
- T4 拆 shared 后，所有 import 路径要批量替换；保留 `index.ts` 作为 barrel 可降低风险


