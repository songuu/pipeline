---
title: "CI/CD + Tekton 系统完整性 Audit（2026-05-18）"
type: sprint-audit
status: completed
created: "2026-05-18"
updated: "2026-05-18"
tags: [audit, cicd, tekton, gray-release, supabase, observability, security, multi-tenant, sprint-planning]
aliases: ["完整性 audit", "cicd 体检", "2026-05-18 体检"]
based_on:
  - "docs/plans/2026-05-15-cicd-optimization-analysis.md"
  - "docs/plans/2026-05-15-cicd-optimization-sprint-1.md"
  - "docs/plans/2026-05-14-k8s-tekton-deep-integration.md"
  - "docs/plans/2026-05-18-complete-gray-release-architecture.md"
  - "docs/plans/2026-05-18-supabase-domain-table-storage.md"
  - "docs/plans/2026-05-15-yunxiao-template-parity.md"
  - "docs/plans/2026-05-18-multi-system-packaging-architecture.md"
parent_thread: "CI/CD 平台演进闭环"
---

# CI/CD + Tekton 系统完整性 Audit

> 本文是 `/sprint` Phase 1-5 全流程输出，**仅盘点不改代码**。
> 目标：以代码现状为准（而非 sprint 文档 frontmatter），把"已交付 / 半成品 / 缺口"摆清楚，给出下一 sprint 推荐。

---

## 0. 方法论

本次 audit 与 2026-05-15 的 `cicd-optimization-analysis` 的差异：

| 维度 | 上次 audit | 本次 audit |
|---|---|---|
| 输入 | 6 个先前 sprint 文档 | 8 个 sprint 文档 + 6 个 worker 并行扫代码 |
| 输出 | 8 项优化清单 + 4 个 sprint 方案 | 6 维矩阵 + 进度对照 + 新缺口 + 触发信号 |
| 重点 | 功能完整度 | 功能 × 安全 × 可观测 × 多租户（前次未覆盖维度） |

**调查范围（worker 已并行覆盖 6 个面）：**
1. `k8s-tekton-deep-integration` (in-progress, 6/10 task)
2. `complete-gray-release-architecture` (in_progress, 3/8 task)
3. `yunxiao-template-parity` (in-progress)
4. `supabase-domain-table-storage` / `supabase-storage-integration` / `gray-release-supabase-persistence`
5. `cicd-optimization-sprint-1` + `sprint-2`（T1-T8 roadmap）
6. 未覆盖维度：可观测 / 安全 / 多租户 / 可靠性

---

## 1. 6 维完成度矩阵

| 维度 | 评分 | 摘要 |
|---|---|---|
| **功能完整性** | 7/10 | 主链路全通；灰度真实切流缺；多租户为零 |
| **代码质量** | 7/10 | `shared` 已拆 8 子域；`pipeline-config-editor` 已瘦至 4 行 wrapper；K8s 仍 spawn kubectl |
| **测试覆盖** | 3/10 | TS 单测 31 个绿（5 spec），但只覆盖 ids/url parser/repository/release-events/image-artifact；执行器 / Nest service / 灰度 / Web 全部 0 测 |
| **文档** | 8/10 | 40+ sprint 文档结构清晰；缺**给用户看的 README**（部署/接入指南） |
| **可观测性** | 0/10 | 无 metrics / 无 trace / 无结构化日志聚合 |
| **安全 / 多租户** | 1/10 | 0 RBAC / 0 webhook 签名 / 0 租户隔离 / 凭据明文绑 workspace |

> 综合：**主链路已接近 MVP，但"上服务器 + 多人多团队使用"前还有两条腿没接好——安全/多租户、可观测性。**

---

## 2. 已完成 sprint 速览（验证过的）

| sprint | 交付 | 证据 |
|---|---|---|
| `cicd-optimization-sprint-1` | T1（退场 simulate）+ T8（TS 单测基线 5 spec / 31 tests） | `grep simulateUntilGate` 0 命中 / `apps/api/src/**/*.spec.ts` |
| `cicd-optimization-sprint-2` | T4（shared 拆 8 子域，主文件 8 行）+ T3（config-editor 瘦至 4 行 wrapper） | `packages/shared/src/{platform,source,executor,registry,release,tekton,yunxiao,api}/`、`apps/web/app/ui/pipeline-config/` |
| `package-mode-rollout` | 5 个 PackageMode 真实执行路径 + 每种 mode 独立 RolloutPolicy | `packages/shared/src/release/index.ts:80-159` |
| `multi-system-packaging-architecture` | 分析文档：PackagePlugin / BuilderEngine / 三档自定义方案，无代码改动 | `docs/plans/2026-05-18-multi-system-packaging-architecture.md` |
| `supabase-domain-table-storage` | 3 份迁移脚本 + 16 张 dm_* 表 schema + replace_dm_records RPC + SupabaseRepositoryStore | `apps/api/src/storage/`、`supabase/migrations/20260518_domain_storage_tables.sql` |

---

## 3. 未完成 sprint 真实进度（代码验证后）

### 3.1 `k8s-tekton-deep-integration` — 6/10 实落 + 2 半成品 + 2 未做

| Task | 状态 | 证据 |
|---|---|---|
| T1 KubernetesConnection 类型 | ✅ | `packages/shared/src/tekton/runtime.ts:10-27` |
| T2 Capabilities & Preflight | ✅ | `services/tekton-bridge/internal/api/handlers.go:36-60` |
| T3 KubernetesService bridge | ✅ | `apps/api/src/kubernetes/kubernetes.service.ts:17-65` |
| T4 watch 替代轮询 | ✅ | `services/tekton-bridge/internal/backend/tekton.go:24` (with `//go:build tekton`) |
| T5 run-events 持久化 | ✅ | `apps/api/src/runs/run-events.repository.ts:6-80` |
| T6 GetTaskRun + 日志 SSE | ✅ | `services/tekton-bridge/internal/api/handlers.go:111-134` |
| **T7 snapshot desired/observed 拆分** | ⚠ 半 | `TektonObservedRun` 类型已定义但 `snapshot.service.ts` 仍在 `buildTektonRunRecord` 合成模型，未真分离 |
| **T8 PipelineRef / Resolver** | ⚠ 半 | `tekton.go:749-750` 仅支持 inline pipelineRef name；无 git-resolver / bundle-resolver |
| **T9 K8s Deploy Adapter** | ❌ | `releases.service.ts:654/706` 仍 `spawn("kubectl", ["set", "image"])` + `spawn("kubectl", ["rollout"])`，未迁 client-go |
| **T10 RBAC YAML 自动化** | ❌ | 主 sprint 文档已含 RBAC 模板（lines 413-449），但缺生成脚本 / helm chart |

### 3.2 `complete-gray-release-architecture` — 3/8 实落 + 5 未做

| Task | 状态 | 证据 |
|---|---|---|
| T1 ReleasePlan + ReleaseExecution | ✅ | `packages/shared/src/release/index.ts:164-247`、`apps/api/src/releases/` |
| T2 DeploymentTarget + 去全局 K8S_* env | ✅ | `apps/api/src/environments/deployment-targets.repository.ts`，8 种 adapter：`local-docker` / `kubernetes` / `nginx-ingress` / `istio` / `argo-rollouts` / `aliyun-alb` / `cdn` / `ecs` |
| T3 EnvironmentLock | ✅ | `apps/api/src/environments/environments.service.ts:127-156` |
| **T4 TrafficAdapter 抽象 + 2 个 adapter** | ❌ | 接口未定义；仅 preflight 检查 trafficConnectionId（line 117-119 注释"区域/百分比灰度只能记录状态"） |
| **T5 nginx-ingress / istio 真实 adapter** | ❌ | 仅 DTO 出现这些枚举值，无 applyTraffic / observe / promote 实现 |
| **T6 指标门禁 + analysis 存储** | ❌ | `CanaryAnalysisSnapshot` 契约存在；无观测器、无 metric query 执行 |
| **T7 前端灰度上线弹窗 + Release 详情页** | ⚠ 半 | `artifact-center.tsx:22-100` 有 onCanaryDeploy 弹窗 + `release-event-timeline.tsx` 时间线；**缺**完整 release 详情页（批次 / 流量规则 / K8s 命令日志） |
| **T8 supabase 表 + 回归测试** | ✅ | 表 schema 已落（见 §3.4），但仍跑 JSON；测试缺位 |

**真实生产可用度：3/10** —— 状态机和锁完备，**完全缺真实流量切换**。

### 3.3 `yunxiao-template-parity` — 路由 70% + 类型 100% + 前端 0%

| 维度 | 状态 | 数据 |
|---|---|---|
| `/oapi/v1/flow/*` 路由数 | ⚠ | 7 / ≈12 云效核心（缺 baseInfo update、template list、env vars 管理等） |
| 共享类型 | ✅ | `PipelineRunInstance` / `StartPipelineRunParams` / `toPipelineRunInstance` 完整 |
| 内置模板 | ⚠ | 17 条，**仅 Node.js / Go**；缺 Java Maven / Gradle / Docker Compose / 应用配置 |
| 前端是否调用 yunxiao API | ❌ | `yunxiaoFetch` 写了但**没人 import**；Web 仍走 legacy `/api/runs/*` |

### 3.4 supabase 持久化 — 表完备但**未开关**

- 16 张 `dm_*` 表迁移脚本就绪（pipelines / runs / artifacts / releases / deployment_targets / environment_locks / release_plans / release_executions / release_events / approvals / audit_events / runner_pools 等）
- `SupabaseRepositoryStore` 用原生 fetch（无 `@supabase/supabase-js` 依赖）
- `StorageService.health()` 暴露 `/api/storage/health` 健康检查
- **当前实际跑：JSON 文件（`DEPLOYMENT_STORAGE` 默认未设）**；切换只需 `DEPLOYMENT_STORAGE=supabase` + `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- 多实例可用度：⚠ — `replace_dm_records()` RPC + RLS 设计完备，但运行时未开

### 3.5 roadmap T1-T8 真实进度

| roadmap | 状态 | 备注 |
|---|---|---|
| T1 退场 simulate | ✅ | sprint-1 已落 |
| T2 RunnerQueue + lease 心跳 | ❌ | 全仓 0 处实现 |
| T3 拆 config-editor | ✅ | 已瘦至 4 行 wrapper；目录拆分进行中（panel 逐个迁） |
| T4 拆 shared 子域 | ✅ | 8 子域，主文件 8 行 |
| T5 ServiceConnection | ❌ | 0 代码；仅 8 docs 引用 |
| T6 DeploymentTarget | ✅ | 被灰度 sprint 顺带做了（14 文件引用） |
| T7 DB adapter | ⚠ | 选了 supabase 而非 Prisma；schema 已落但运行时未启用 |
| T8 TS 单测基线 | ✅ | 5 spec / 31 tests 全绿 |

> **roadmap 实际完成度：6/8** —— T2、T5 是真缺口，其余都已被某个 sprint 覆盖。

---

## 4. 新缺口（前次 audit 未覆盖维度）

### 4.1 可观测性 — ❌ 全无

- 无 `prom-client` / `opentelemetry` / `@opentelemetry/*` 依赖
- 无 `/metrics` endpoint；无 trace propagation（`traceparent` header）
- Tekton bridge 仅用 `log.Printf`，无结构化日志
- NestJS 用 `Logger` 但无 exporter 配置（无 ELK / Loki / Datadog 出口）

**影响：** 生产上线后无法回答「这个 run 卡哪了 / API p99 多少 / 哪条 pipeline 失败率最高」。

### 4.2 安全 — ⚠ 多项缺位

| 子项 | 状态 | 证据 |
|---|---|---|
| Webhook 签名验证 | ❌ | `snapshot.service.ts` 注释提及 "github/gitlab signature" 但**未实现** |
| Webhook 去重 / idempotency | ❌ | 无 `delivery_id` 缓存；重复 webhook 会重复 trigger |
| RBAC / 角色权限 | ❌ | `actor` 仅审计用；无 `@Roles` / 权限检查；approval.decidedBy 无角色约束 |
| 凭据加密存储 | ❌ | docker-config Secret / kubeconfig **明文绑 workspace** |
| 审计事件粒度 | ⚠ | 仅 `(actor, action, target)`；无 `requestId / source IP / changed_fields` |
| SBOM / cosign / Tekton Chains | ❌ | 0 集成 |
| ServiceConnection（secret 收敛点） | ❌ | 0 代码实现；上次 audit 统计 `process.env.*` 散落 11 个 service 文件（本次未重新统计） |

### 4.3 多租户 — ❌ 零隔离

- `runs.controller.ts:34 list()` → `runs.service.ts:48 snapshot()` 返回全量
- 任何列表 API 无 `tenantId / orgId / projectId` 过滤
- 同一 API 实例：**所有租户互相可见所有应用 / pipeline / run / approval / audit log**

**影响：** 不能多团队共用一个部署，只能"一团队一实例"，与"企业控制面"目标冲突。

### 4.4 可靠性 — ❌ 缺多项

- Webhook 无 dedup → 可被重放 / DoS
- 长时间运行无 idempotency / resumable → API 重启后 in-flight run 丢失
- Tekton bridge SSE 断裂无 replay（heartbeat 15s 但客户端无 last-event-id 续约）
- 无死信队列 / 重试策略 / 断路器
- NestJS 无 `OnModuleDestroy` graceful shutdown；Tekton bridge 有 signal handler 但无 in-flight 超时清理

---

## 5. Top 候选清单（业务价值 × 实施成本象限）

```text
                    高价值 ▲
                          │
         ┌────────────────┼────────────────┐
         │   推荐立刻做    │   战略 sprint   │
         │                │                │
   低成本 ◄ A. 安全基线   │ C. 多租户隔离   ► 高成本
         │ B. supabase 启用│ D. 真实 K8s adapter
         │                │ E. 可观测性套件
         │                │ F. TrafficAdapter
         ├────────────────┼────────────────┤
         │   待选 / 不紧迫  │   暂不做         │
         │ G. RunnerQueue │ I. SBOM/Chains  │
         │ H. 云效模板补全 │ J. Prisma 重做   │
         │                │   (supabase 已覆盖) │
         └────────────────┴────────────────┘
                          │
                    低价值 ▼
```

### A. 安全基线（Webhook 签名 + idempotency + 简易 RBAC）

**价值：** 修闭 3 个严重 P0（webhook 重放 / 跨租户偷窥 / 凭据明文）
**成本：** S（1.5-2 天）
**风险：** L2
**任务草案：**
1. Webhook signature verification（GitHub `X-Hub-Signature-256` + GitLab `X-Gitlab-Token`）
2. Webhook delivery_id 去重表（30 天 TTL）
3. 最简 RBAC：`@Roles('admin'|'member'|'viewer')` 装饰器 + 一个 JWT/session 中间件
4. ServiceConnection 雏形：把 `process.env.*` 加密读取统一进 `secret-resolver.service.ts`，仅作"接口对齐"，不强求重构所有 service

### B. supabase 启用 + JSON → DB 切换

**价值：** 启用已写好的 schema，立刻获得多实例 + 持久化
**成本：** S（1 天，主要是 env 配置 + 一次性迁移脚本）
**风险：** L3（数据迁移 + 多实例并发）
**任务草案：**
1. 部署 supabase 实例（用户已有？需确认）
2. 执行 3 份迁移脚本
3. 一次性脚本：`.deploy-data/*.json` → `dm_*` 表
4. 切 `DEPLOYMENT_STORAGE=supabase`，跑 24h 双写验证
5. 关 JSON fallback

### C. 多租户隔离

**价值：** 解锁"一控制面多团队"使用场景
**成本：** M（3-4 天，需扫所有 controller 加过滤）
**风险：** L4（漏一个就泄露）
**任务草案：**
1. 在 JWT/session payload 增加 `tenantId`
2. NestJS `TenantInterceptor` 注入到所有 controller
3. 所有 repository.list() 强制按 tenantId 过滤
4. supabase 表加 `tenant_id` 列 + RLS policy
5. 渗透测试：写脚本验证 tenant A 无法看到 tenant B 数据

### D. 真实 K8s Deploy Adapter（k8s-tekton T9）

**价值：** 替换 `spawn kubectl`，获得 client-go 的 watch / informer 能力
**成本：** M（3 天）
**风险：** L3
**任务草案：** 用 client-go 重写 `releases.service.ts` 的 deployToKubernetes；接 rollout watch；接 health check

### E. 可观测性套件（prometheus + opentelemetry）

**价值：** 上生产前必备
**成本：** M（3-4 天）
**风险：** L2
**任务草案：**
1. `prom-client`：API 自带 `/metrics`，导出 run count / duration / failure rate
2. `@opentelemetry/sdk-node`：trace propagation；Tekton bridge 也接 OTLP exporter
3. Tekton bridge 换 `zerolog`（结构化日志）
4. 接一个开源 stack（推荐 Grafana + Loki + Tempo + Prometheus）作为可选 docker-compose

### F. TrafficAdapter + 真实灰度（complete-gray-release T4+T5）

**价值：** 把灰度真实可用度从 3/10 推到 7/10
**成本：** L（5-6 天）
**风险：** L4（误切流量会影响真实用户）
**任务草案：** 先做 `kubernetes-deployment`（patch image + rollout watch），再做 `nginx-ingress-canary`（annotation 权重 / Header 规则）

### G. 待选：RunnerQueue（T2） / 云效模板补全 / 前端切云效 API

- RunnerQueue：单实例 + 多人时才需要；当前小团队可推迟
- 云效模板：Java Maven / Gradle 缺；如果用户主战场是 Node/Go，可推迟
- 前端切云效 API：纯重构，零业务价值；可在重写 Web 时一起做

---

## 6. 推荐：下一 1-2 个 sprint

### Sprint 1（强烈推荐）：**A 安全基线 + B supabase 启用**

**总工时：** 2.5-3 天
**为什么：**
- A 闭 3 个 P0（webhook / 跨租户 / 凭据），是"上服务器"硬门槛
- B 是已写好但没打开的开关，启用成本最低收益最高（多实例 + 持久化一次到位）
- 两者天然耦合：webhook 去重表 + tenantId 都要写 DB，A 启用后 B 立刻有用武之地
- 风险均低（L2 + L3），可单 sprint 完成

**触发信号：** 当前就该启动 — 主链路已 MVP，没有理由再延后。

### Sprint 2（看场景选）：**C 多租户** 或 **F TrafficAdapter**

- 选 **C** 如果接下来要"一个实例多团队 / 上 SaaS / 给别的项目用"
- 选 **F** 如果接下来要"真正在生产环境用灰度发布 / 有真实流量需要切"
- 这两个互不冲突但每个都 L4，**不要同 sprint 做**

### 不推荐现在做（写入 backlog）

- **G RunnerQueue（T2）**：单实例 + 小团队场景下，性价比低
- **H 云效模板补全 / 前端切云效 API**：业务团队没用 Java/Gradle 前不做；前端切纯重构无业务价值
- **I SBOM / Tekton Chains**：先稳定控制面，再做合规层
- **J Prisma 重做**：supabase 已覆盖；Prisma 是冗余选项

---

## 7. 风险

1. **A 安全基线的 RBAC 容易过度设计** — 强制收敛到「admin/member/viewer 三角色 + 1 个 JWT 中间件」，不引 Casbin 之类
2. **B supabase 启用要先确认实例归属** — 用户是用自有 supabase project 还是 docker-compose 本地？如果是云端，连接串 / RLS policy 必须先到位
3. **C 多租户改动面广** — 建议先用 worker agent 并行扫所有 controller，再一次性改完，避免漏过滤
4. **F 真实流量切换最危险** — local-docker / k8s deployment 先做，nginx/istio 留 sprint 3 单独做
5. **可观测性（E）不要等到出事才做** — 但优先级低于 A/B，因为缺它不会"线上挂"，只会"挂了不知道为啥"

---

## 8. 不做（明确拒绝）

- 不做 RBAC 完整模型（多对多权限 / ABAC / 资源级 ACL）—— 用最简三角色即可
- 不做 Prisma —— supabase 已覆盖
- 不重写 Tekton bridge —— `1.7k 行 Go` 是聚合不是缺陷
- 不补云效模板到 100% 对齐 —— 业务团队不在用 Java / Gradle 前不做
- 不做前端切云效 API —— 纯重构，留到 Web 重写时
- 不做 SBOM / cosign / Tekton Chains —— 控制面稳了再做合规层
- 不替换 Next.js / NestJS 大版本
- 不动 `pnpm-lock.yaml` 现有依赖范围（仅追加新需要的包：jose / @nestjs/jwt / prom-client / @opentelemetry/sdk-node 等）

---

## 9. 与其他 sprint 的关系

| sprint | 关系 |
|---|---|
| `cicd-optimization-analysis` | 本 audit 是其 6 个月后续；已交付 6/8，余 T2/T5 推到 backlog |
| `complete-gray-release-architecture` | 本 audit 把它的 Task 4-7 提炼为「Sprint F」候选 |
| `k8s-tekton-deep-integration` | Task 9 提炼为「Sprint D」候选；T7/T8 留 backlog |
| `supabase-domain-table-storage` | 表已落，本 audit 把"启用开关"提炼为「Sprint B」 |
| `yunxiao-template-parity` | 缺口低优；写入 backlog |
| `multi-system-packaging-architecture` | 提案态；Sprint S（buildArgs + 多 target）仍未触发，与本 audit 不冲突 |

---

## 10. 最终决策清单

- [x] **6 维矩阵**：功能 7 / 质量 7 / 测试 3 / 文档 8 / 可观测 0 / 安全 1
- [x] **roadmap T1-T8 实际完成度**：6/8（T2 + T5 仍缺；T6/T7 被其他 sprint 覆盖）
- [x] **3 个隐藏 P0**：webhook 重放 + 跨租户偷窥 + 凭据明文
- [x] **下 sprint 推荐**：A + B（安全基线 + supabase 启用，2.5-3 天）
- [x] **下下 sprint 二选一**：C（多租户）或 F（TrafficAdapter），按场景定
- [x] **不做清单**：完整 RBAC / Prisma / 重写 bridge / 前端切云效 / SBOM

---

## 复利记录（Phase 5 Compound）

- 文档：本文（`docs/plans/2026-05-18-cicd-tekton-completeness-audit.md`）
- 知识：6 维 audit 框架（功能/质量/测试/文档/可观测/安全）适用于本仓库后续所有 audit；不写 memory（属架构性洞察可从代码推导）
- skill 信号：本 audit 走的「6 worker 并行扫代码 + 串行汇总」模式适用于任何"sprint 文档与现状对照"任务；后续可固化为 `/audit` 命令模板

---

## 11. 2026-05-18 Follow-up 实施记录

> 本节记录本文推荐的 Sprint 1（A 安全基线 + B Supabase 启用）的第一轮落地结果。

### 11.1 已落地

| 项 | 状态 | 代码锚点 |
|---|---|---|
| 控制面 RBAC | ✅ | `apps/api/src/security/roles.guard.ts`、`roles.decorator.ts`、Runs/Pipelines/Releases/Environments/CodeRepos/Kubernetes 控制器 |
| Webhook 签名校验 | ✅ | `apps/api/src/security/webhook-security.service.ts` |
| Webhook delivery 去重 | ✅ | `apps/api/src/security/webhook-deliveries.repository.ts`、`dm_webhook_deliveries` |
| Webhook 触发 API | ✅ | `apps/api/src/security/webhooks.controller.ts` |
| SecretResolver 雏形 | ✅ | `apps/api/src/security/secret-resolver.service.ts` |
| Supabase 领域表补齐 | ✅ | `supabase/migrations/20260518_domain_storage_tables.sql` |
| JSON → Supabase 迁移脚本 | ✅ | `scripts/migrate-json-to-supabase.mjs`、`pnpm migrate:storage:supabase` |
| 用户文档 | ✅ | `README.md`、`.env.example` |

### 11.2 当前边界

- RBAC 是最小实现：`viewer` / `member` / `admin`，支持共享 token 与可选 HS256 JWT；还未做 tenantId 和资源级 ACL。
- Webhook 支持 GitHub HMAC、GitLab token、GitCode/Gitee token 或 HMAC、generic token；provider 专用 secret 和 pipeline 专用 secret 均已预留。
- Supabase 迁移脚本是一次性全量 replace，与当前 `SupabaseRepositoryStore` 的 `replace_dm_records` 语义一致；多实例并发的细粒度 upsert/append 仍属于后续 RunnerQueue/DB adapter 深化范围。
- `dm_webhook_deliveries.expiresAt` 已记录并建索引；TTL 清理 job 还未实现，建议后续作为可靠性任务补充。

### 11.3 验证记录

- `pnpm --filter @deploy-management/api check`：通过。
- `pnpm --filter @deploy-management/api test -- src/security/webhook-security.service.spec.ts src/security/roles.guard.spec.ts`：8 tests 通过。
- `$env:DRY_RUN="true"; pnpm migrate:storage:supabase`：通过，当前 `.deploy-data` 无待迁移 JSON。
- `pnpm --filter @deploy-management/api build`：通过。
- `git diff --check -- apps/api/src package.json scripts/migrate-json-to-supabase.mjs supabase/migrations/20260518_domain_storage_tables.sql README.md .env.example docs/plans/2026-05-18-cicd-tekton-completeness-audit.md`：通过。
