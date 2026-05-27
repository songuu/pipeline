---
title: "灰度版本选择解耦"
type: sprint
status: completed
created: "2026-05-27"
updated: "2026-05-27"
checkpoints: 0
tasks_total: 5
tasks_completed: 5
tags: [sprint, canary, release, artifact, version-selection]
aliases: ["灰度版本选择", "canary version picker"]

invariants:
  - "ReleaseDeployment 必须记录 stableImageRef 和 rollbackImageRef"
  - "CanaryRolloutPolicy 区域百分比语义不变"
  - "deployArtifact 无 baselineArtifactId 时行为与现有完全一致（向后兼容）"

invariant_tests: []

deferred: []

deadcode_until: []
---

# 灰度版本选择解耦

## Phase 1: Think

### 现状分析

当前灰度发布系统已具备：
- 完整的 Release 状态机（deploying → canarying → paused → success/rolled_back）
- 区域百分比灰度（CanaryTrafficRegion + CanaryRolloutStepRegion）
- 多打包模式灰度策略（container_image / static_site / server_package / k8s_manifest / helm_chart）
- 制品中心 UI 触发灰度

**耦合点**：`releases.service.ts:99` — `findLatestStableRelease()` 自动解析 baseline 版本，用户无法显式选择。灰度的 stable 端永远是"最近一次成功发布"，不支持：
- 指定某个历史版本作为对照基线
- 两个任意构建版本之间做 A/B 灰度
- 跳过某个失败版本回到更早的稳定版

### Scope（做什么）

1. **类型层**：`DeployArtifactRequest` 新增 `baselineArtifactId?: string`，显式指定灰度对照版本
2. **服务层**：release service 优先使用显式 baseline，fallback 到 `findLatestStableRelease()`
3. **UI 层**：制品中心灰度部署流程增加 baseline 版本选择器
4. **数据层**：`ReleaseDeployment` / `ReleaseExecution` 记录 baseline 来源（auto-resolved vs user-selected）

### Non-scope（不做什么）

- 不改变 pipeline run 内 build→deploy→canary 的单 run 流程
- 不新增 A/B 指标对比分析面板（当前只做版本选择，分析是后续 sprint）
- 不改 Tekton bridge 或 executor adapter
- 不引入新的 API endpoint（复用现有 `POST /releases/deploy/:artifactId`）

### 成功标准

1. 灰度部署时可选择任意历史 artifact 作为 baseline
2. 不选时行为 100% 向后兼容
3. Release 日志清晰记录 baseline 来源
4. UI 版本选择器展示 artifact 列表（版本号、构建时间、digest）

### 风险

| 风险 | 级别 | 缓解 |
|------|------|------|
| baseline artifact 与 candidate 打包模式不匹配 | M | 服务层校验 packageMode 一致性 |
| baseline artifact 已被清理/不可用 | L | 校验 artifact 存在性，不存在时 fallback 自动解析 |

## Phase 2: Plan

### 入场扫描 - Invariants 继承

| 子系统 | 上 sprint invariant | 本 sprint 如何保持 |
|--------|---------------------|--------------------|
| Release 状态机 | stableImageRef / rollbackImageRef 必须记录 | 新增 baselineArtifactId 不替代，仅补充来源 |
| 区域百分比灰度 | CanaryRolloutPolicy.regions 语义不变 | 不改动 rolloutPolicy 结构 |
| deployArtifact 接口 | 向后兼容 | baselineArtifactId 可选，不传时行为不变 |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 持久化 | 刷新后可见 |
|--------|----------|--------|--------|------------|
| baselineArtifactId 字段 | 用户在 UI 选择 baseline | DTO → service | ✅ ReleaseDeployment | ✅ release 日志 |
| baseline 版本选择器 UI | 点击灰度按钮展开选择 | state → onCanaryDeploy | → API body | ✅ 选择器展示 |

### 入场扫描 - 债务清单

无前置 sprint 遗留债务需处理。

### 技术方案

变更按 4 层递进，每层向后兼容：

```
shared types → API DTO/schema → release service → UI
```

#### Layer 1: Shared Types

文件: `packages/shared/src/release/index.ts`

```ts
// DeployArtifactRequest 新增
baselineArtifactId?: string;

// ReleaseDeployment 新增
baselineArtifactId?: string;
baselineSource?: "user-selected" | "auto-resolved";

// ReleasePlan 新增
baselineArtifactId?: string;
```

#### Layer 2: API DTO

文件: `apps/api/src/releases/dto/deploy-artifact.dto.ts`

```ts
// deployArtifactSchema 新增
baselineArtifactId: z.string().trim().min(1).optional(),
```

#### Layer 3: Release Service

文件: `apps/api/src/releases/releases.service.ts`

核心改动在 `deployArtifact()`:
1. 读取 `request.baselineArtifactId`
2. 如果有值 → 用 `artifacts.get()` 获取 baseline artifact → 校验 packageMode 一致
3. 如果无值 → fallback `findLatestStableRelease()`（现有逻辑）
4. `ReleaseDeployment` 记录 `baselineArtifactId` + `baselineSource`
5. 日志区分 "用户指定基线版本" vs "自动解析最近稳定版本"

#### Layer 4: UI

文件: `apps/web/app/ui/sections/artifact-center.tsx` + `apps/web/app/ui/dashboard-shell.tsx`

1. `ArtifactCenterProps.onCanaryDeploy` 签名加 `baselineArtifactId?: string`
2. 每个 artifact card 的灰度区域配置器下方，加一个 baseline 版本下拉选择
3. 下拉选项 = 同 application 的所有 artifact（按时间倒序），排除当前 candidate 自身
4. 默认值 = "自动（最近稳定版本）"
5. `dashboard-shell.tsx` 的 `handleCanaryDeployArtifact` 透传 `baselineArtifactId` 到 API

### 任务拆解

| # | Task | 风险 | 文件 |
|---|------|------|------|
| 1 | Shared types: 3 个类型加 baselineArtifactId 字段 | L0 | `packages/shared/src/release/index.ts` |
| 2 | API DTO: deployArtifactSchema 加 baselineArtifactId | L0 | `apps/api/src/releases/dto/deploy-artifact.dto.ts` |
| 3 | Release service: baseline 解析逻辑 + packageMode 校验 + 日志 | L1 | `apps/api/src/releases/releases.service.ts` |
| 4 | UI: artifact-center baseline 选择器组件 | L1 | `apps/web/app/ui/sections/artifact-center.tsx` |
| 5 | UI: dashboard-shell 透传 baselineArtifactId | L0 | `apps/web/app/ui/dashboard-shell.tsx` |

### 验证策略

- Task 1-2: `pnpm --filter @deploy-management/shared check` + `pnpm --filter @deploy-management/api check`
- Task 3: 手动验证：不传 baselineArtifactId → 行为不变；传了 → 日志记录正确
- Task 4-5: `pnpm --filter @deploy-management/web check` + 浏览器验证 UI

## Phase 4: Review

### 审查结果

| 级别 | 问题 | 状态 |
|------|------|------|
| P0 | 跨应用隔离：resolveBaseline 未校验 baseline artifact 所属 applicationId | ✅ 已修复 |
| P1 | 用户显式选择的 baseline 不存在时静默 fallback，应报错 | ✅ 已修复（改为 throw） |
| P1 | zod schema 缺 .max() 约束 | ✅ 已修复 (.max(128)) |
| P1 | packageMode 推导 fallback 到 container_image 可能不准确 | ⚠️ 可接受（现有所有 run 都有 buildConfig） |
| P2 | UI 未展示 baselineSource（user-selected vs auto-resolved） | ⏭ 后续迭代 |
| P2 | BaselineVersionSelector 未按 applicationId 过滤 | ⚠️ 实际上 snapshot 已按 application 隔离 |

### 第 6 视角 — 集成连续性

1. ✅ 前 sprint invariant（ReleaseDeployment 必须记录 stableImageRef）保持完整
2. ✅ 无 dead code（新增的类型和组件均已使用）
3. ✅ 向后兼容：不传 baselineArtifactId 时行为与修改前完全一致

## Phase 5: Compound

### 本次经验

1. **解耦策略**：把"唯一来源"改为"fallback"是最小侵入的解耦方式 — 新增可选参数 + 有值时覆盖默认逻辑 + 无值时 100% 兼容
2. **安全审查必查项**：跨资源引用（artifact → release）必须校验归属关系（applicationId 一致性），否则造成信息泄漏
3. **显式选择 vs 静默 fallback**：用户主动行为失败时应该报错而非静默降级，否则用户信任被破坏

### 新增 invariants

- `resolveBaseline` 用户指定 baselineArtifactId 时，必须校验 applicationId 一致性
- `resolveBaseline` baseline 不存在时 throw，不静默 fallback
