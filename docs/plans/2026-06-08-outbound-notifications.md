---
title: "出站通知（平台接入口子）"
type: sprint
status: planning
created: "2026-06-08"
updated: "2026-06-08"
checkpoints: 0
tasks_total: 6
tasks_completed: 0
tags: [sprint, feature, notifications, harness-borrow]
aliases: ["出站通知", "钉钉企微通知"]
related:
  - "[[2026-06-05-harness-gap-borrow-plan]]"
  - "[[2026-06-08-dora-metrics]]"
  - "[[feedback-control-plane-auth-jwt-role]]"
invariants:
  - "通知是旁路：dispatch 绝不 throw，单渠道失败不阻断审批/发布主流程"
  - "secret(webhook URL/加签密钥)走 SecretResolverService 读 env，不硬编码、不落库、不打印"
  - "渠道状态语义：未配置(无 webhook env)→skipped；已配置→真实发送→sent/failed。skipped≠failed"
  - "通知触发点不得改变既有事件流/状态机（事件 append-only 只读消费）"
invariant_tests:
  - apps/api/src/snapshot/snapshot.service.spec.ts
deferred: []
deadcode_until: []
---

# 出站通知（平台接入口子）

> 借鉴清单 #2（见 `2026-06-05-harness-gap-borrow-plan.md` 第 10.2 节）。
> **用户约束（已澄清）：功能要完整实现（含真实 HTTP 发送）。当前只是还没有真实渠道被正式配置接入——即代码生产可用，运行时因无 webhook env 配置而处于未激活（`isConfigured=false → skipped`），日后配上 env 即端到端工作。**

## Phase 1: 需求分析（Think · CEO/产品视角）

### 做什么（Scope）
- 出站通知**抽象层** + 三个平台**完整实现**：钉钉群机器人、企业微信群机器人、通用 webhook。每个 provider：`isConfigured()`（按 env 判断）+ payload 构造 + **真实 `deliver()`（fetch 出站，带超时）** + 结果映射（平台 errcode / HTTP 状态 → sent/failed）。
  - 钉钉：支持可选**加签**（`DINGTALK_NOTIFY_SECRET` 存在时按 timestamp+HMAC-SHA256 拼 `timestamp`/`sign` query），校验返回 `errcode===0`。
  - 企微：群机器人 webhook，markdown/text，校验 `errcode===0`。
  - 通用 webhook：POST JSON，可选 `WEBHOOK_NOTIFY_SECRET` → 加 `X-Signature` HMAC 头；2xx 视为 sent。
- `NotificationService.dispatch(message)`：按配置筛选已配置渠道 → fan-out → **单渠道失败隔离**（try-catch，绝不向主流程抛错）→ 返回 dispatch summary（每渠道 sent/failed/skipped）。
- 接线 **2 个触发点**（避免 dead code）：
  - 审批创建 `approvals.service.ts createForRun` → `approval_requested`。
  - 发布失败/回滚 `releases.service.ts recordReleaseEvent` 的 `deploy_failed`(343) / `release_rolled_back`(541) 两处 → 对应通知。
- secret（webhook URL / 加签密钥）走 `SecretResolverService` 读 env（每平台 env 存在即 `isConfigured`）。**当前无任何渠道 env 配置 → 全部 skipped（未激活但代码完整）。**

### 不做什么（Non-scope）
- 不做重试队列 / 限流 / 死信（首版基础超时 + 错误隔离即可，重试后续按需）。
- 不做富文本卡片高级模板（基础 markdown/text 足够）。
- 不做通知历史持久化 / 已读 / 前端通知中心。
- 不做入站回调（外部审批 approve/reject 属借鉴清单 #4 后续 sprint）。
- 不动其它事件类型（仅 approval + 2 个失败事件）。
- 不在本 sprint 配置真实 webhook（无渠道接入；env 留空，激活留给运维）。

### 成功标准（Success）
- `dispatch` 逻辑单测：未配置渠道 skipped、多渠道 fan-out、单渠道抛错被隔离不影响其它、全未配置返回 noop summary。
- provider 交付单测（mock `fetch`）：各平台 payload 形状正确、钉钉加签 query 正确、结果映射（errcode≠0 / 非 2xx / 超时 → failed）正确。
- 接线点真实调用 dispatch（集成路径无 ❌，非 dead code）。
- 通知失败不阻断主流程（审批创建 / 发布失败处理仍正常）。
- `pnpm check` + shared/api/web 三测 + build 全绿；不破 invariant。

### 风险（Risks）
- **R1** `releases.service.ts` 是大文件（1300+ 行）：注入 `NotificationService` + 2 处 hook 必须 surgical，勿误伤现有逻辑/测试。
- **R2** `dispatch` **绝不 throw**——通知是旁路，失败不能炸主发布/审批流（memory：失败 try-catch 吞掉）。出站 fetch 必须带超时（AbortController），避免慢渠道拖垮主流程。
- **R3** secret 只读 env，不落库、不打印日志（避免泄露 webhook URL/加签密钥）。
- **R4** 真实出站 HTTP 是跨用户副作用——本 sprint 靠 `isConfigured`（无 env→skipped）天然门控，无渠道接入即不外发；激活（配 env）的决定权留给运维，代码侧默认安全。
- **R5** DI 方向：`NotificationsModule` 导出 `NotificationService`，被 Approvals/Releases import；`NotificationsModule` import `SecurityModule`(SecretResolver)。security 不依赖 releases → 无循环依赖。
- **R6** 钉钉加签算法正确性（timestamp 毫秒 + `\n` 拼接 + HMAC-SHA256 + base64 + urlencode）需单测锁定，错签会被钉钉拒。

### Next: go → Plan

---

## Phase 2: 技术方案 + 任务拆解（Plan · 架构师视角）

### 入场扫描 - Invariants 继承（防漂移强制项 1）

| 子系统 | 既有 invariant | 本 sprint 如何保持 |
|--------|----------------|--------------------|
| shared→api 构建 | 改 `packages/shared` 必须先 build（[[feedback-shared-dist-rebuild-gate]]） | 加 `notifications` 域后先 `pnpm --filter shared build` 再跑 api |
| secret 管理 | 不硬编码、走 env（[[feedback-zod-security-first-pass]] / 全局 security 规则） | webhook URL/加签密钥经 `SecretResolverService` 读 env |
| 校验分层 | 业务类型放 shared 纯 TS，边界校验放 api | 通知类型在 shared；provider/dispatch 在 api |
| 事件流 | `release-events` append-only 只读 | 通知只读消费事件语义，不改 `recordReleaseEvent` 行为，仅在其后旁路 dispatch |
| 旁路稳定性 | 失败 try-catch 吞掉不阻断主流程（plan #2 + 全局错误处理） | `dispatch` 绝不 throw；出站 fetch 带超时 |

### 入场扫描 - 集成路径声明（防漂移强制项 2）

| 改动点 | 触发动作 | 中间层 | 出站 | 结果可见 |
|--------|----------|--------|------|----------|
| 审批创建 | `approvals.createForRun` | `NotificationService.dispatch(approval_requested)` | 已配置渠道→真实 fetch / 未配置→skipped | ✅ dispatch summary（运行时当前全 skipped，因无渠道 env，非 dead code） |
| 发布失败/回滚 | `releases.recordReleaseEvent(deploy_failed\|release_rolled_back)` 后 | `NotificationService.dispatch(...)` | 同上 | ✅ 同上 |

> 全链路无 ❌：触发点真实调用 dispatch，provider 真实实现 deliver。"当前无渠道接入" = 运行时 `isConfigured=false→skipped`（配置态），**不是** dead code（代码路径完整、被单测+接线覆盖）。

### 入场扫描 - 半完成债务清单（防漂移强制项 3）

| 来源 sprint | 议题 | 本 sprint 决策 | deadline |
|-------------|------|----------------|----------|
| — | 无前置 deferred | 新功能；入站审批回调属 #4 后续 sprint，不在本 sprint 范围 | — |

### 技术方案

1. **shared 类型**（`packages/shared/src/notifications/index.ts`）：`NotificationChannelKind`(`dingtalk\|wecom\|webhook`)、`NotificationEventType`(`approval_requested\|deploy_failed\|release_rolled_back`)、`NotificationMessage`(event/title/text(markdown)/link?/context)、`NotificationDeliveryStatus`(`sent\|failed\|skipped`)、`NotificationResult`、`NotificationDispatchSummary`。barrel 导出。
2. **provider 抽象 + 三平台实现**（`apps/api/src/notifications/`）：
   - `notification-channel.interface.ts`：`NotificationChannel { kind; isConfigured(); send(message):Promise<NotificationResult> }` + `NOTIFICATION_CHANNELS` 注入 token。
   - `notification-http.ts`：`postJson(url, body, timeoutMs, headers?)` 用 `AbortController` 超时（默认 `NOTIFY_TIMEOUT_MS`=5000），`getErrorMessage(unknown)`。
   - `signing.ts`：纯函数 `signDingtalk(secret, timestamp)`（`${ts}\n${secret}` → HMAC-SHA256 → base64 → urlencode）、`hmacHex(secret, payload)`（通用 webhook 签名），用 `node:crypto`。
   - `providers/dingtalk.notifier.ts`：env `DINGTALK_NOTIFY_WEBHOOK`(+可选 `DINGTALK_NOTIFY_SECRET` 加签)，`msgtype:markdown`，校验 `res.ok && json.errcode===0`。
   - `providers/wecom.notifier.ts`：env `WECOM_NOTIFY_WEBHOOK`，`msgtype:markdown`，校验 `errcode===0`。
   - `providers/webhook.notifier.ts`：env `WEBHOOK_NOTIFY_URL`(+可选 `WEBHOOK_NOTIFY_SECRET`→`X-Signature: sha256=<hex>` 头)，2xx→sent。
   - 每个 `isConfigured()` = 对应 webhook env 存在；未配置时 `send` 也返回 `skipped`（双保险）。
3. **dispatch 服务**（`notification.service.ts`）：`@Inject(NOTIFICATION_CHANNELS)` 注入渠道数组；`dispatch(message)`：`Promise.all` 遍历——未配置→skipped，已配置→try `send` / catch→failed（**绝不抛**）→ `summarize(event, results)`。
4. **消息构造**（`notification-messages.ts` 纯函数）：`buildApprovalRequestedMessage(approval)`、`buildReleaseFailureMessage(release, eventType, detail)`（从 `ReleaseDeployment` 取 app/env/actor/release 链接）。
5. **模块**（`notifications.module.ts`）：providers = `[NotificationService, SecretResolverService(本地提供，无状态 env 读取，避免 import SecurityModule 引入 guard/降低耦合), Dingtalk/Wecom/Webhook Notifier, { provide: NOTIFICATION_CHANNELS, useFactory:(d,w,h)=>[d,w,h], inject:[...] }]`；exports `NotificationService`。
6. **接线**：
   - `ApprovalsModule` import `NotificationsModule`；`ApprovalsService` 注入 `NotificationService`，`createForRun` prepend 后 `await dispatch(buildApprovalRequestedMessage(approval))`。
   - `ReleasesModule` import `NotificationsModule`；`ReleasesService` 注入 `NotificationService`，在 `deploy_failed`(343)/`release_rolled_back`(541) 的 `recordReleaseEvent` 后 `await dispatch(buildReleaseFailureMessage(...))`。

> DI 无环：`NotificationsModule` 本地提供 `SecretResolverService`（不 import `SecurityModule`）→ 仅被 Approvals/Releases 单向 import。

### 任务拆解

| # | Task | 风险 | 测试 |
|---|------|------|------|
| 1 | shared: `notifications/` 类型 + barrel | L1 | 类型编译；shared test 不回归 |
| 2 | api: interface + token + `notification-http` + `signing`(纯) + 3 provider(真实 deliver) + provider spec | **L3** | mock `fetch`：各平台 payload 形状、钉钉加签 query、结果映射(errcode≠0/非2xx/超时→failed)、未配置→skipped |
| 3 | api: `NotificationService.dispatch` + `NOTIFICATION_CHANNELS` + `notification-messages` 构造 + `notifications.module` + dispatch spec | **L3** | 跳过未配/fan-out/单渠道抛错隔离/全空 noop/builders 输出 |
| 4 | api: 接线 `approvals.createForRun` + `ApprovalsModule` import | L2 | approvals spec：createForRun 调 dispatch 且不因通知失败而抛 |
| 5 | api: 接线 `releases` deploy_failed/rolled_back + `ReleasesModule` import | L2 | releases 现有 spec 不回归；dispatch 被调 |
| 6 | 验证收口：先 build shared → shared/api/web 三测 + `pnpm check` + web build + `invariant_tests` | — | 全量回归 |

> Task=6 > 5 → Task 5 后自动 checkpoint 检查。

### 验证策略
- L3 provider：mock 全局 `fetch`，断言 URL（钉钉 sign query）、body（msgtype/markdown）、headers（webhook X-Signature）、结果映射；签名用固定 timestamp 对拍。
- L3 dispatch：fake channels 覆盖 configured/unconfigured/throwing 组合，断言 summary 计数 + 绝不 throw。
- 接线后跑 releases/approvals 现有 spec 确认主流程不回归。
- 收口按 [[feedback-shared-dist-rebuild-gate]] 先 build shared；按 [[feedback-pnpm-check-vs-build-drift]] check + build 都跑。

### Next: go → Work
