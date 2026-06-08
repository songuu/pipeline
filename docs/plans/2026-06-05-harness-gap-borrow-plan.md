---
title: "对标 Harness.io — 可借鉴能力落地方案"
type: design
status: in-progress
created: "2026-06-05"
updated: "2026-06-05"
tags: [design, harness, continuous-verification, gitops, dora, roadmap]
aliases: ["Harness 差距借鉴", "CV 落地方案"]
related:
  - "[[project-production-deployment]]"
  - "[[project-pipeline-default-dag]]"
  - "[[feedback-control-plane-auth-jwt-role]]"
---

# 对标 Harness.io — 可借鉴能力落地方案

> 目的：把 Harness CD 核心能力中**贴合本项目架构、ROI 高**的部分，转成可落地的代码改造清单。
> 范围只取 **CD 交集**（Continuous Verification / GitOps-drift / 模板 / 治理 / DORA），
> 不追 Harness 的相邻独立产品（Feature Flags / CCM / 混沌 / SRM / IDP）。

## 0. 现状盘点（落笔前已核对代码，非臆测）

本项目**不是空白起步**，很多 Harness 能力已有基座，缺的是"最后接线"：

| 能力 | 已有基座（真实文件） | 真实缺口 |
|------|---------------------|----------|
| 灰度阈值评估 | `releases.service.ts:1279 mergeAnalysis`（`successRate<minSuccessRate \|\| errorRate>maxErrorRate \|\| p95>maxP95LatencyMs` → status） | 输入 `successRate/errorRate/p95` 来自**客户端 `request.analysis` 补丁**，默认 100 |
| 回滚执行 | `releases.service.ts:496 rollbackRelease` + `rollbackImageRef/rollbackReleaseId` | 无"采样判定失败 → 自动触发回滚"的闭环驱动 |
| 灰度推进 | `releases.controller.ts` `canary/advance｜pause｜resume｜promote`、`rollback` 端点 | **全靠手动 POST**，无定时器自动推进（全项目无 `@nestjs/schedule`） |
| 灰度策略 | `release/index.ts CanaryRolloutPolicy`（`analysisWindowSeconds/minSuccessRate/maxErrorRate/maxP95LatencyMs/autoPromote/rollbackOnFailure`） | 策略字段齐全，但无组件**消费 analysisWindow 做周期采样** |
| 审批门 | `lifecycle.engine.ts:183/252 waiting_approval` + DAG `approval` 阶段 + `approvals/*` 模块 | 仅缺外部审批人（Slack/Jira/钉钉）回调 |
| 期望状态/Drift | `environments/deployment-targets.repository.ts`、`environment-locks.repository.ts` | 无 desired-version 记录 + 无 actual 比对 reconcile |
| 部署事件源 | `releases/release-events.repository.ts`、`runs/run-events.repository.ts` | 事件已落，但无 DORA 聚合 + 无 dashboard |
| 阶段模板 | `executors/stage-templates.ts`、中心化 `tekton/default-stage-dag.ts` | 未抽 pipeline 级可复用模板与参数化 |

**结论**：最大的"功能性差距"= **真实指标采样 + 自动验证闭环**（CV）。其余多为增量接线。

---

## 1. 【P0】Continuous Verification —— 真实指标采样 + 自动验证闭环

### 1.1 目标

把现有"客户端喂分析数据 + 手动推进灰度"升级为：
**部署后系统自主周期采样真实指标 → 比对基线/阈值 → 健康则按 `autoPromote` 推进、异常则按 `rollbackOnFailure` 自动回滚。**
对齐 Harness Continuous Verification（其招牌能力），但保持轻量、可插拔指标源。

### 1.2 设计要点

1. **指标源抽象**（provider 模式，复用项目 `executors` 的多实现单开关风格）：
   - `MetricsProvider` 接口：`sample(target, window): Promise<CanaryAnalysisSnapshot>`。
   - 实现：`prometheus`（PromQL）、`aliyun-cms`（云监控 DescribeMetricLast）、`http-probe`（兜底：周期打健康端点统计 2xx/5xx/延迟）、`simulated`（保留现有合成，做默认与测试）。
   - 单一全局开关 `METRICS_PROVIDER=simulated|prometheus|aliyun-cms|http-probe`，与 `EXECUTOR` 同范式。
2. **采样调度器**：引入 `@nestjs/schedule`，新增 `CanaryWatcher`，对处于 `canarying` 状态的 release，每 `analysisWindowSeconds` 触发一次 `sample → mergeAnalysis → 决策`。
3. **决策闭环**（复用已有判定，不重写）：
   - `analysis.status === "failed"` 且 `policy.rollbackOnFailure` → 调 `rollbackRelease`。
   - `analysis.status === "healthy"` 且 `policy.autoPromote` → 调 `advanceCanary`（到下一 step），末步则 `promoteCanary`。
   - `warning` → 保持当前 step，记录事件，等下一个窗口。
4. **基线对比（borrow Harness baseline-vs-canary）**：除静态阈值外，支持"与稳定版同窗口指标比"——`successRate_canary >= successRate_baseline - tolerance`。基线数据用稳定 release 的 target 采同一指标。

### 1.3 需要修改 / 新增的文件

**新增**
```
apps/api/src/verification/                         ← 新模块
  verification.module.ts
  metrics-provider.interface.ts                    ← MetricsProvider 接口 + token
  providers/prometheus.metrics-provider.ts
  providers/aliyun-cms.metrics-provider.ts
  providers/http-probe.metrics-provider.ts
  providers/simulated.metrics-provider.ts          ← 迁移现有合成逻辑
  canary-watcher.service.ts                        ← @Cron/@Interval 驱动采样闭环
  baseline-comparator.ts                           ← canary vs stable 同窗口对比
  verification.spec.ts
```

**修改**
| 文件 | 改动 |
|------|------|
| `apps/api/src/releases/releases.service.ts:1279 mergeAnalysis` | 入参从"仅 client patch"改为"优先 MetricsProvider 采样值，patch 仅作 override/测试注入"；`successRate` 默认值不再恒 100 |
| `apps/api/src/releases/releases.service.ts:496 rollbackRelease` | 暴露可被 watcher 内部调用的路径（区分 actor=`system:canary-watcher`，写审计） |
| `apps/api/src/releases/releases.service.ts advanceCanary/promoteCanary` | 抽出"系统自动推进"入口，与手动 POST 共用核心逻辑，actor 区分 |
| `apps/api/src/releases/releases.module.ts` | import `VerificationModule`，注入 provider |
| `apps/api/src/app.module.ts` | `ScheduleModule.forRoot()` |
| `packages/shared/src/release/index.ts` | `CanaryRolloutPolicy` 增 `baselineTolerance?: number`、`metricQueries?: { successRate?: string; errorRate?: string; p95?: string }`（PromQL/指标名映射）；`CanaryAnalysisSnapshot` 增 `source: "prometheus"\|"aliyun-cms"\|"http-probe"\|"simulated"\|"client"` |
| `packages/shared/src/release/index.ts ReleaseEventType` | 增 `canary_analysis_sampled`、`canary_auto_rolled_back`、`canary_auto_promoted` |
| `apps/api/src/snapshot/snapshot.service.ts` | 快照暴露最近 N 次采样序列，供前端画指标趋势 |
| `apps/web/app/...`（release 详情视图） | 渲染采样时间线 + 阈值线 + 触发回滚标注（具体组件待 Plan 阶段定位） |
| `.env.production` / 文档 | 新增 `METRICS_PROVIDER`、`PROMETHEUS_BASE_URL`、`ALIYUN_CMS_*`、`HTTP_PROBE_INTERVAL` 配置说明 |

### 1.4 配置（env）

```bash
METRICS_PROVIDER=simulated            # simulated|prometheus|aliyun-cms|http-probe
PROMETHEUS_BASE_URL=http://prom:9090  # provider=prometheus 时必填
ALIYUN_CMS_REGION=us-east-1           # provider=aliyun-cms 时必填（复用现有 AK/SK）
HTTP_PROBE_PATH=/healthz              # provider=http-probe 兜底探活路径
```

### 1.5 风险与边界（强制人工 / L4）

- **自动回滚是生产破坏性动作**：上线前必须 `rollbackOnFailure` 默认值审慎（prod 默认 true 已是现状 L1312，但"自动"触发是新增行为）→ 首版加 `CANARY_AUTO_ACTION=observe-only|enabled` 总开关，先跑 observe-only（只采样+告警不动作）一段时间再放开。
- 指标源不可达时**不得静默判失败触发回滚**（会造成误回滚）→ `status="unknown"` 时保持当前 step + 告警，不动作。
- 采样窗口与 release TTL 边界、并发多 release 的调度隔离需测试覆盖。

### 1.6 验收

- [ ] `METRICS_PROVIDER=simulated` 回归：现有 canary 测试全绿（行为不回归）。
- [ ] `prometheus` provider：mock PromQL 返回 → 阈值越界 → observe-only 模式只产 `canary_analysis_sampled` 事件，不回滚。
- [ ] 放开 `enabled`：注入失败指标 → 自动 `rollbackRelease` 且写审计 actor=`system:canary-watcher`。
- [ ] 指标源 500/超时 → `status=unknown` → 不动作 + 告警事件。
- [ ] baseline 对比：canary < stable - tolerance → 判 failed。

---

## 2. 【P1】期望状态记录 + Drift 检测（GitOps 轻量版）

### 2.1 目标

我们是 imperative push（git pull + pm2，见 [[project-production-deployment]]），无人盯"线上实际版本 vs 应部署版本"。借鉴 Harness/Argo 的 desired-state，但**不引入 Argo**：只记录期望版本 + 周期比对 + 漂移告警（可选一键收敛）。

### 2.2 设计要点

- 每个 `environment × service` 记录 `desiredArtifactId / desiredImageRef`（一次成功 release 即写入）。
- `DriftDetector`（复用第 1 节引入的 `@nestjs/schedule`）周期探活目标实际运行版本：
  - local-docker：`docker inspect` 镜像 digest / 读部署 manifest。
  - local-filesystem/static：读已部署目录的 version 标记文件。
- 实际 ≠ 期望 → 产 `environment_drift_detected` 事件 + 快照标红；提供 `POST /api/environments/:id/reconcile` 手动收敛（**不默认自动**，避免与人工热修冲突）。

### 2.3 需要修改 / 新增的文件

**新增**
```
apps/api/src/environments/desired-state.repository.ts   ← 期望版本存储
apps/api/src/environments/drift-detector.service.ts     ← 周期比对
apps/api/src/environments/dto/reconcile.dto.ts
```
**修改**
| 文件 | 改动 |
|------|------|
| `apps/api/src/releases/releases.service.ts` | release 成功后写 `desiredState`（环境×服务→artifact/imageRef） |
| `apps/api/src/environments/environments.controller.ts` | 增 `GET /api/environments/:id/drift`、`POST /api/environments/:id/reconcile` |
| `apps/api/src/environments/environments.service.ts` | drift 查询 + reconcile 委派 executor 重新部署 desired 版本 |
| `packages/shared/src/release/index.ts` | 增 `EnvironmentDriftStatus`、`DesiredState` 类型；`ReleaseEventType` 增 `environment_drift_detected/environment_reconciled` |
| `apps/api/src/snapshot/snapshot.service.ts` | 快照增 per-env drift 标记 |

### 2.4 验收

- [ ] release 成功 → desiredState 落库。
- [ ] 手动改服务器版本（模拟漂移）→ detector 产 `environment_drift_detected` + 快照标红。
- [ ] `reconcile` → 重新部署 desired → drift 清除。
- [ ] reconcile 默认手动，需 member+（[[feedback-control-plane-auth-jwt-role]]）。

---

## 3. 【P1】DORA 指标 Dashboard

### 3.1 目标

Harness 有部署分析面板。我们 `release-events` / `run-events` 事件已落库——**数据源现成**，只缺聚合 + UI。低成本高信号。

### 3.2 四指标计算来源

| 指标 | 计算 | 数据源 |
|------|------|--------|
| 部署频率 | 单位时间 `deploy_succeeded` 计数 | `release-events.repository.ts` |
| 变更前置时间 | artifact 创建 → `deploy_succeeded` 时差 | artifacts + release-events |
| 变更失败率 | `deploy_failed`+`release_rolled_back` / 总部署 | release-events |
| MTTR | `release_rolled_back`→下次 `deploy_succeeded` 时差 | release-events |

### 3.3 需要修改 / 新增的文件

**新增**
```
apps/api/src/metrics/dora.service.ts              ← 事件流聚合
apps/api/src/metrics/dora.controller.ts           ← GET /api/metrics/dora?window=7d&env=prod
apps/api/src/metrics/metrics.module.ts
apps/api/src/metrics/dora.spec.ts
apps/web/app/metrics/page.tsx                     ← DORA 看板（复用现有图表风格）
```
**修改**
| 文件 | 改动 |
|------|------|
| `apps/api/src/app.module.ts` | import `MetricsModule` |
| `packages/shared/src/release/index.ts` | 增 `DoraMetrics` 类型（四指标 + 时间窗 + 趋势点） |
| `apps/web/app/...` 导航 | 加入口 |

### 3.4 验收

- [ ] 灌入历史事件 → 四指标计算与手算一致（单测）。
- [ ] 按 env / window 过滤正确。
- [ ] 空数据不崩（返回 0 + 友好态）。

---

## 4. 【P2】审批门增强（外部审批人）

### 4.1 现状

审批已接：`lifecycle.engine.ts:183/252 waiting_approval`、DAG `approval` 阶段、`approvals/*` 模块。**核心已具备**，仅缺"通知外部审批人 + 外部回调批准"。

### 4.2 需要修改 / 新增的文件

**新增**
```
apps/api/src/approvals/notifiers/                  ← 审批通知（Slack/钉钉/Webhook）
  slack.notifier.ts
  webhook.notifier.ts
apps/api/src/approvals/approval-callback.controller.ts   ← 签名校验的外部回调批准/拒绝
```
**修改**
| 文件 | 改动 |
|------|------|
| `apps/api/src/approvals/approvals.service.ts` | 进入 waiting 时触发 notifier；接收外部回调更新状态 |
| `apps/api/src/lifecycle/lifecycle.engine.ts:252` | 审批通过/拒绝事件回流推进/中止 run |
| `.env` | `APPROVAL_NOTIFIER`、`SLACK_WEBHOOK_URL`、`APPROVAL_CALLBACK_SECRET` |

### 4.3 风险（强制人工）

- 外部回调端点必须**签名校验**（HMAC，复用 webhook 签名范式），豁免登录门但不豁免签名（参照 `[[feedback-control-plane-auth-jwt-role]]` 中 `/api/webhooks/` 处理）。

### 4.4 验收

- [ ] 进 approval 阶段 → 发出通知。
- [ ] 合法签名回调 approve → run 推进；reject → 中止。
- [ ] 无效签名 → 401，不改状态。

---

## 5. 【P2】Pipeline 模板化复用

### 5.1 现状与目标

`stage-templates.ts` + 中心化 `default-stage-dag.ts` 已是基座。Harness 把 step/stage/pipeline 抽成**带版本的可复用模板**。本项目可做轻量版：把"常用流水线组合 + 参数"抽成命名模板，新应用一键套用。

### 5.2 需要修改 / 新增的文件

**新增**
```
apps/api/src/pipelines/templates/                  ← 模板定义与解析
  pipeline-template.repository.ts
  template-resolver.ts                             ← 模板 + 参数 → PipelineDefinition
packages/shared/src/platform/pipeline-template.ts  ← 模板类型 + 参数 schema
```
**修改**
| 文件 | 改动 |
|------|------|
| `apps/api/src/pipelines/pipelines.service.ts` | 支持"从模板实例化" |
| `apps/api/src/pipelines/pipelines.controller.ts` | `GET /api/pipeline-templates`、`POST /api/pipelines/from-template` |
| `packages/shared/src/tekton/dag-validation.ts` | 模板实例化后仍走现有 DAG 校验（不绕过双语言同步守卫，见 [[project-pipeline-default-dag]]） |

### 5.3 验收

- [ ] 套用模板生成的 PipelineDefinition 通过 `dag-validation` + TS↔Go sync test。
- [ ] 参数缺失 → 校验报错（zod 边界，参照 shared 纯 TS / api zod 分层约定）。

---

## 6. 不借鉴（明确划界 · YAGNI）

| Harness 模块 | 不做原因 |
|------|------|
| Delegate 全架构 | 单机自托管无需无入站隧道；http-probe/直连足够 |
| Cloud Cost Management | 与 CD 无关，独立产品 |
| 混沌工程 / SRM | 规模不匹配，投入产出比差 |
| Feature Flags | 应用层关注点，非部署平台职责 |
| Internal Developer Portal | 团队规模不需要门户层 |
| Policy as Code 完整 OPA | 首版用硬编码 policy gate（第 4 节审批 + 简单规则）替代，OPA 过重 |

---

## 7. 实施顺序建议

```
P0  第 1 节 CV（observe-only 先行 → 验证稳定 → 放开 auto-action）   ← 差异化核心，单开一个 /sprint
P1  第 2 节 Drift 检测（复用 P0 引入的 scheduler）
P1  第 3 节 DORA（数据源现成，最便宜，可并行）
P2  第 4 节 审批通知 / 第 5 节 模板（增量增强，按需）
```

> 依赖关系：第 2/3 节复用第 1 节引入的 `@nestjs/schedule` + `ScheduleModule`，建议 P0 先落，避免重复引入。

## 8. 跨切关注点（全程遵守现有纪律）

- **双语言同步**：任何动 `DEFAULT_STAGE_DAG` / 阶段语义的改动，必须同步 `services/tekton-bridge` 并由 `snapshot.service.spec.ts` sync test 守住（[[project-pipeline-default-dag]]）。
- **鉴权**：所有新写端点（reconcile/promote/审批回调）走 member+；前端不带 token，nginx 注入（[[feedback-control-plane-auth-jwt-role]]）。
- **校验分层**：业务规则放 `packages/shared`（纯 TS），边界校验放 `apps/api`（zod）。
- **不可逆动作**：自动回滚、reconcile 重部署——首版均提供 observe-only / 手动门，灰度放开。

---

## 9. 2026-06-05 执行记录（P0 CV 后端闭环）

### 计划审查修正

| 原计划点 | 审查结论 | 执行调整 |
|----------|----------|----------|
| 引入 `@nestjs/schedule` | 当前 `apps/api/package.json` 未依赖，临时引包会放大变更面 | 首版用 Nest `OnModuleInit/OnModuleDestroy + setInterval`，后续若已有依赖再替换 |
| 自动回滚 | 生产破坏性动作，不能默认启用 | 新增 `CANARY_AUTO_ACTION=observe-only\|enabled`，默认 observe-only |
| 指标源不可达 | 不得当失败处理 | provider 异常统一 `status="unknown"`，不触发自动动作 |
| baseline-vs-canary | P0 有价值，但应轻量接线 | 支持 `baselineTolerance`，稳定版采样失败时不阻断 candidate 静态阈值 |

### 已完成

- 新增 `apps/api/src/verification/` 模块：
  - `CanaryWatcherService` 周期扫描 `canarying` release，按 `analysisWindowSeconds` 采样。
  - `MetricsProvider` 抽象 + `simulated` / `prometheus` / `http-probe` / `aliyun-cms` provider。
  - `simulated` 默认 provider；`prometheus` 走 `PROMETHEUS_BASE_URL` + `metricQueries`；`http-probe` 走 release endpoint；`aliyun-cms` 首版明确返回 unknown，避免假接入。
- `ReleasesService` 新增系统采样写回和自动事件记录入口。
- `CanaryAnalysisSnapshot` 增 `source`；`CanaryRolloutPolicy` 增 `baselineTolerance`、`metricQueries`。
- 新增事件：`canary_analysis_sampled`、`canary_auto_promoted`、`canary_auto_rolled_back`。
- 前端 release event timeline 增新事件 label/tone/icon，至少可见采样/自动动作事件流。

### 未完成 / 后续

- Release 详情指标趋势图、阈值线、回滚标注尚未做成专门图表；当前通过事件 timeline payload 可追溯。
- Aliyun CMS provider 只留安全 unknown stub，未做 OpenAPI 签名请求。
- P1 Drift、P1 DORA、P2 审批通知、P2 模板化尚未开始。

### 验证

| 命令 | 结果 |
|------|------|
| `pnpm check` | pass |
| `pnpm --filter @deploy-management/shared test` | pass，27 tests |
| `pnpm --filter @deploy-management/api test` | pass，58 tests |
| `pnpm --filter @deploy-management/web test` | pass，29 tests |

---

## 10. 2026-06-08 全产品面重审（delta · 已核对当前真实代码）

> 第二轮对标：不再局限 CD 交集，**12 个 Harness 产品模块全面 web 调研 + 逐条比当前源码**（非 06-05 旧记忆）。
> 核心变化：旧分析判的"唯一真功能差距 = CV"**基座已闭合**；最高 ROI 借鉴点重排为 DORA + 出站通知 + CV 精修。

### 10.1 已闭合（旧差距，勿再当缺口）

| 能力 | 代码证据 |
|------|----------|
| CV 抽象 + 4 provider | `verification/` 真实存在；`simulated/prometheus/http-probe` 真采样（prometheus 真查 `/api/v1/query`）；`aliyun-cms` 仍占位永远返回 unknown |
| 周期采样调度 | `canary-watcher.service.ts:23` `setInterval+timer.unref()`（刻意不引 `@nestjs/schedule`，确认 0 命中），已挂 `app.module.ts:40` |
| 自动回滚闭环 | `canary-watcher.service.ts:82` `enabled` 时真调 `rollbackRelease`（:496 重部署稳定制品+流量归零+释放锁+审计） |
| observe-only 安全门 | `canary-watcher.service.ts:192` `CANARY_AUTO_ACTION`，默认只采样不开火 |
| baseline-vs-canary | `applyBaselineComparison:112`（**仅 successRate 单维**，errorRate/p95 仍走绝对阈值 → 见 10.2 #4） |
| DORA 数据源 | `release-events.repository` append-only + 单调 sequence + 15 种事件，四指标输入字段齐备（**缺聚合层**，`apps/api/src/metrics` 确认不存在） |

### 10.2 可直接借鉴清单（排序 · 已代入单机/无 k8s/imperative-push/云效约束）

| # | 借鉴项 | ROI | 工作量 | 落点 |
|---|--------|-----|--------|------|
| 1 | **DORA 四指标聚合层** | high | M | 新增 `apps/api/src/metrics/dora.service.ts`+`dora.controller.ts` 双路由(`/api/metrics/dora`+`/oapi/v1/flow/metrics/dora`，viewer)；先给 `ReleaseEventsRepository` 加 `listAll/byApplication` 视图避免 N+1。频率=count(deploy_succeeded)/窗口；前置时间=artifact.uploadedAt→deploy_succeeded 中位数；失败率=(deploy_failed+rolled_back)/总；MTTR=rolled_back→下个 deploy_succeeded |
| 2 | **出站通知（钉钉/企微群机器人 webhook）** | high | S | 新增 `apps/api/src/notifications/notification.service.ts`，挂 `approvals.service.ts:32 createForRun` + `releases` 的 `deploy_failed/rolled_back`。全 `apps/api/src` 零出站通知。URL 走 `secret-resolver` 不硬编码；失败 try-catch 吞掉不阻断主流程。国内宜钉钉/企微非 Slack |
| 3 | **Pin-as-Baseline + 敏感度三档** | medium | S | `CanaryRolloutPolicy` 加 `sensitivity?:'high'\|'medium'\|'low'`+`pinnedBaselineReleaseId?`；`canary-watcher:131` tolerance 由单值改按 sensitivity 映射倍数；`resolveBaseline:667` 优先取 pinned。当前基线随每次发布漂移，固定已知良好版本是 ML CV 务实平替。新增 `POST .../releases/:id/pin-baseline` 双路由(member) |
| 4 | **baseline 扩三维**（errorRate/p95 也比基线） | medium | S | `applyBaselineComparison:112` 当前只比 successRate；`CanaryAnalysisSnapshot` 字段已有。注意反向越界：`candidate.errorRate > baseline.errorRate + tolerance` 才降级。**与 #3 同文件一次 PR 做完** |
| 5 | **AuditEvent 增强**（+result/sourceIp/diff） | medium | S | 现仅 actor/action/target/createdAt（`audit.service.ts:14`）。`webhook-deliveries.repository` 已采 sourceIp 可复用模式。改 `record` 签名是破坏性，~50 调用点给默认值兼容；双路由一起改 |
| 6 | **部署漂移探测**（observe-only 单机退化版） | medium | M | 复用 `canary-watcher` `setInterval` + `http-probe` provider 比对真实版本 vs `environments` 记录 currentDigest，不一致写 `environment_drift_detected`。**非 GitOps**，默认不自动 reconcile；新事件枚举需 TS↔Go 同步 |
| 7 | **本机依赖缓存接线**（CI Cache 单机版） | high | M | `PipelineCacheConfig` 基座在但 `local-docker.executor` 没读，每次 `pnpm install --frozen-lockfile` 全量。指向固定 `LOCAL_DOCKER_CACHE_DIR` 的 `pnpm --store-dir`/`go env -w GOMODCACHE`。对 1.8GB 机器价值高，须设容量上限+保守失效 |
| 8 | **审批人名单 allowedApprovers** | medium | S | 现谁点谁是 actor（`approvals.service.ts:36 decide`）无限定。`ApprovalRequest` 加 `allowedApprovers?:string[]`，decide 校验 principal 在名单内；为空退化兼容。与 #2 配合成完整审批闭环 |

**附带 1h 小修**：`EnvironmentLock.expiresAt` 字段在但 `status='expired'` 从不被设置 → 崩溃残留死锁。挂进 `canary-watcher` 已有 `setInterval` 顺手清理。

### 10.3 仍开放但靠后（remaining）

- `aliyun-cms` provider 仍占位 → 若主用阿里云监控，接 CMS OpenAPI 签名客户端是 CV 真实指标源最高 ROI 一笔（effort M-L），但 prometheus/http-probe 已可用、不阻塞 enabled 切换。
- Pipeline 级可复用模板/VariableSet（`pipelines.service.ts` 确认 absent）—— 小团队当前流水线数量未必值得，等重复痛点明显再做。
- applications 只读（仅 GET 双路由）缺 create/update —— IDP 软件目录最低成本一步，优先级低于 metrics。
- SLO/error-budget 轻量版（部署成功率 SLO）—— 与 DORA 共用事件源，DORA 之后合并扩展；request-based SLO skip（无稳定请求指标流）。
- 失败根因规则版摘要（对 `run-events` failed stage 抽 command/log 匹配 OOM/pnpm-sharp/go-PATH/ff-only 已知坑）—— 不接 LLM 的规则版可先做。
- 轻量安全扫描（gitleaks + osv/govulncheck）接 `local-docker` test 阶段，结果落 Finding artifact，只扫不自动 PR。
- SBOM 真实生成（syft 单二进制）替换 snapshot 展示占位 —— 优先级低于 DORA/通知/CV 完善。

### 10.4 明确不做（补充 06-05 第 6 节 · 单机硬冲突）

| Harness 能力 | 不做原因 |
|------|------|
| 真 Blue-Green/Rolling | 单机 1.8GB 跑不起双生产环境+无 LB；`blue_green`/`rolling` 服务层是 stub（`releases.service.ts:1103`）退化为全量直发，回切已被 `rollbackRelease` 覆盖 → 文档标注或删枚举 |
| GitOps pull / Argo / Delegate / K8s Orchestrator / Karpenter | 无 k8s（k3s disable），push 非 pull，Delegate 三前提(SaaS控制面+跨网执行+多副本HA)全不成立 |
| OPA/Rego/Cloud Custodian 策略引擎 | 对单机重依赖；现有硬编码治理(RBAC+sourcePolicy allowlist+审批+环境锁)对单租户已够；要可配置用轻量 zod/TS 谓词不引 Rego runtime |
| CCM 全套(Perspectives/AutoStopping/Commitment/Budgets/rightsizing) | 单台固定 ECS 无云账单 OpenAPI、无弹性资源可停起；本项目方向是升配不是省钱（与 FinOps 缩容相反） |
| 混沌全套(LitmusChaos/Resilience Score/ChaosHub/GameDay) | 需 k8s operator；单机自压测拖垮唯一生产实例 OOM；唯一可借的"声明阈值→采样→机判→observe-only→自动动作"范式已在 CV 落地 |
| Feature Flags 运行时评估引擎/targeting/SDK | 求值需在被部署业务应用运行时，本控制面不在请求链路；真需要接开源 Unleash 不自写 |
| IaCM 多引擎/State/Module Registry/成本预估 | 部署制品到已存在单机，不声明/供给云资源，无 .tf/state 概念，纯 YAGNI |
| Database DevOps(Schema/迁移编排/AI 迁移) | 无 DB 变更场景；有则用应用自带 ORM migration 在 deploy 阶段跑 |
| CI Test Intelligence/Build Intelligence/用例级并行 | TI 需 instrument agent 常驻回本太慢；栈是 pnpm/go 无 Gradle/Bazel cache 协议；2 vCPU 无横向并行空间；非 GitHub 生态无 GH Actions 资产 |
| STO/SCS 高级项(可达性/EPSS/AI 修复 PR/keyless cosign+Rekor/SLSA L3/跨工具去重) | 自研引擎护城河自建不现实；SLSA L3 需隔离托管构建(单机 build+签名同机达不到)；keyless 需 OIDC 身份源(自托管拿不到)；单引擎下去重降噪无意义 |
| AI 重型(DevOps Agent NL→YAML/AI Test 浏览器集群/Knowledge Graph 图库/Dashboard Intelligence) | 1.8GB 跑不动本地推理/向量库；接外部 LLM 属付费跨用户副作用(auto-mode 强制人工)。若未来接 LLM 统一"用户自带 Key+env 注入+不落库+推理后即弃"，不自动改 YAML/开 PR |
| 细粒度 RBAC 矩阵/Account-Org-Project 多作用域/ABAC/Resource Group | 单租户单团队，三级 rank(viewer/member/admin)+各 service 归属校验已恰当；多作用域是多租户 SaaS 治理结构 |
| Composite SLO/SRM 统计显著性(SAX/ML/SII 节点归因)/日志聚类 | 单机无多节点(SII 不存在，基线改用时间维度)；无大流量样本(显著性统计不成立)；无日志聚合管道，run-events log 是 CI 构建日志非 runtime 错误流 |
| MCP Server/Multi-Service 编排/环境向前传播/IDP Scaffolder/TechDocs/Environment Blueprints | 多服务级联是大组织诉求(本项目单 deploy stage)；脚手架建库对单团队低频；文档放 README。MCP 只读暴露 ROI 不低但碰生产路径，列可选后置非必做 |

### 10.5 落地顺序（与已落 P0 CV 衔接、复用 setInterval 调度）

```
阶段一(零风险高信号·互不依赖可并行):
  #1 DORA 聚合层（先加 ReleaseEventsRepository.listAll 视图——SLO/scorecard/变更归因共同底座）
  #2 出站通知（独立 notification.service，挂 approvals + deploy_failed/rolled_back）
阶段二(CV 精修·同文件一次做完):
  #3 Pin-as-Baseline+sensitivity 与 #4 baseline 三维 合并（改 shared CanaryRolloutPolicy + canary-watcher:112 + resolveBaseline:667）
  ↳ 并行小修: EnvironmentLock 过期清理（复用 canary-watcher setInterval）
  ↳ 做完后才有资格在指标源可信(prometheus 接好或 aliyun-cms 落地)后把 CANARY_AUTO_ACTION 切 enabled
阶段三(治理增量):
  #5 AuditEvent 增强（破坏性接口变更，~50 调用点单独排期）→ #8 审批人名单
阶段四(按实际痛点启动):
  #7 本机依赖缓存接线（改 local-docker.executor，谨慎做失效+磁盘上限）
  #6 漂移探测（依赖 release endpoint 可探测，排最后）
```

> 关键依赖链：DORA 的 `listAll` 视图是 SLO/scorecard 前置；`canary-watcher` 的 `setInterval` 是 EnvironmentLock 过期清理/DriftWatcher/未来 ScheduledTrigger 的共享调度基座（全项目刻意不引 `@nestjs/schedule`，新定时任务一律复用此模式）；`aliyun-cms` provider 落地是 CV 在阿里云生态真正可信的前提，但不阻塞 enabled 切换。
