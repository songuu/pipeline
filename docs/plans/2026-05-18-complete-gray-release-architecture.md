---
title: "更完整的灰度发布方案"
type: sprint
status: in_progress
created: "2026-05-18"
updated: "2026-05-18"
checkpoints: 1
tasks_total: 8
tasks_completed: 3
tags: [sprint, release, canary, gray-release, deployment]
aliases: ["完善灰度方案", "区域百分比灰度", "Release Orchestration"]
---

# 更完整的灰度发布方案

## Phase 1: Think

### 目标

当前系统已经有 release 状态机、制品中心灰度入口、区域百分比灰度契约，但还不是完整生产级灰度。更完整的方案应该把“打包后的上线”升级为一套可审计、可观测、可回滚、可扩展到不同制品类型和不同流量控制面的 Release Orchestration。

### 必须解决的问题

- 灰度策略不能只是一组百分比，需要表达区域、用户分组、请求 Header、实例批次、CDN 分组、Kubernetes/Service Mesh 权重。
- 不同打包方式需要不同执行器：容器镜像、静态站点包、服务运行包、Kubernetes YAML、Helm Chart 的灰度语义不同。
- 灰度必须有环境锁，同一环境同一应用不能并发上线两条 release。
- 灰度必须有健康检查和指标门禁，不能只靠人工点“推进”。
- 灰度必须能自动回滚，并保留上一个稳定版本、变更原因、执行命令、网关规则和指标快照。
- 本地 `local-docker` 没有真实网关时，只能作为开发 fallback；服务器和 Kubernetes 环境必须走真实流量适配器。

### 非目标

- 不把所有网关一次性做完。先定义统一接口和至少一个可工作的 adapter。
- 不在业务代码中硬编码地域、网关、namespace、deployment 名称。它们必须来自 DeploymentTarget / ServiceConnection / ReleasePolicy。
- 不用模拟状态冒充真实流量切换。执行器不具备能力时，UI 必须显示“状态机灰度 / 未接入真实网关”。

## Phase 2: Plan

### 总体架构

```text
Artifact
  -> ReleasePlan
  -> ReleaseExecution
  -> Preflight
  -> Deploy candidate version
  -> Apply traffic rule
  -> Observe metrics/events
  -> Gate decision
  -> Advance / Pause / Promote / Rollback
```

### 领域模型

#### ReleasePlan

保存“这次上线打算怎么做”，由流水线模板、制品类型和用户配置生成。

```ts
type ReleasePlan = {
  id: string;
  artifactId: string;
  applicationId: string;
  environmentId: string;
  packageMode: PackageMode;
  strategy: "rolling" | "canary" | "blue_green";
  targetId: string;
  policy: ReleasePolicy;
  createdBy: string;
  createdAt: string;
};
```

#### ReleasePolicy

策略需要拆成基础门禁、流量目标、推进批次、回滚策略四块。

```ts
type ReleasePolicy = {
  rollout: {
    steps: number[];
    autoPromote: boolean;
    requireApprovalBeforePromote: boolean;
    maxDurationMinutes: number;
  };
  traffic: {
    regions: CanaryTrafficRegion[];
    cohorts: CanaryCohort[];
    headerRules: CanaryHeaderRule[];
    userRules: CanaryUserRule[];
  };
  analysis: {
    windowSeconds: number;
    minRequestCount: number;
    minSuccessRate: number;
    maxErrorRate: number;
    maxP95LatencyMs: number;
    customQueries: MetricQuery[];
  };
  rollback: {
    autoRollback: boolean;
    rollbackOnDeployFailure: boolean;
    rollbackOnAnalysisFailure: boolean;
    keepFailedCandidate: boolean;
  };
};
```

#### DeploymentTarget

灰度必须落到明确的部署目标上，而不是依赖全局环境变量。

```ts
type DeploymentTarget = {
  id: string;
  environmentId: string;
  packageModes: PackageMode[];
  adapter: "local-docker" | "kubernetes" | "nginx-ingress" | "istio" | "argo-rollouts" | "aliyun-alb" | "cdn" | "ecs";
  namespace?: string;
  workloadName?: string;
  serviceName?: string;
  ingressName?: string;
  containerName?: string;
  healthCheckUrl?: string;
  serviceConnectionId: string;
  trafficConnectionId?: string;
};
```

#### ReleaseExecution

保存每一次真实执行，包含命令、事件、指标、状态和回滚锚点。

```ts
type ReleaseExecution = {
  id: string;
  planId: string;
  status: "preflight" | "deploying" | "canarying" | "paused" | "promoting" | "success" | "failed" | "rolled_back";
  stableRevision?: string;
  candidateRevision: string;
  currentTraffic: TrafficSnapshot;
  steps: ReleaseStepExecution[];
  locks: EnvironmentLock[];
  startedAt: string;
  finishedAt?: string;
};
```

### 按打包方式拆灰度语义

| 打包方式 | 灰度控制对象 | 推荐 adapter | 灰度方式 |
|---|---|---|---|
| `container_image` | Deployment / Service / Gateway | Kubernetes + Istio / Nginx / Argo Rollouts | 新旧版本 ReplicaSet + 网关权重 |
| `static_site` | CDN / OSS 发布目录 / 边缘规则 | CDN adapter / OSS current symlink | 区域 CDN 路由、Header/Cookie 分流、版本目录切换 |
| `server_package` | ECS/VM 实例 / 负载均衡 | ECS + ALB/NLB adapter | 实例批次、权重、健康检查 |
| `kubernetes_manifest` | Manifest 声明对象 | Kubernetes adapter | apply candidate manifest + rollout watch |
| `helm_chart` | Helm Release / values | Helm + Kubernetes adapter | values canary override + Helm rollback |

### 流量适配器接口

所有真实灰度都必须通过统一接口。

```ts
interface TrafficAdapter {
  preflight(target: DeploymentTarget): Promise<PreflightResult>;
  deployCandidate(input: DeployCandidateInput): Promise<DeployCandidateResult>;
  applyTraffic(input: ApplyTrafficInput): Promise<TrafficSnapshot>;
  observe(input: ObserveTrafficInput): Promise<AnalysisSnapshot>;
  promote(input: PromoteInput): Promise<TrafficSnapshot>;
  rollback(input: RollbackInput): Promise<TrafficSnapshot>;
}
```

### 适配器优先级

1. `local-docker-stateful`：本地开发，只做真实镜像拉取/运行和状态机，不声称真实切流。
2. `kubernetes-deployment`：服务器第一版，patch image + rollout watch + health check。
3. `nginx-ingress-canary`：通过 Ingress annotation 支持权重/Header/Cookie。
4. `istio-virtual-service`：通过 VirtualService route weight 支持区域和百分比。
5. `argo-rollouts`：通过 Rollout CRD 支持 analysis template、pause、promote、abort。
6. `aliyun-alb` / `aliyun-cdn`：后续云厂商网关，支持区域和百分比。

## 完整灰度流程

### 1. 创建 ReleasePlan

- 用户在制品中心选择制品、环境、目标、区域和百分比。
- API 根据 `packageMode` 和 `DeploymentTarget` 生成默认策略。
- 策略保存到 `ReleasePlan`，并生成不可变 revision。

### 2. Preflight

必须检查：

- Artifact 是否存在并有 digest。
- DeploymentTarget 是否配置完整。
- ServiceConnection 是否可解析。
- Kubernetes namespace / Deployment / Service / Ingress 是否存在。
- Registry pull secret 是否存在。
- 环境是否已有活跃 release lock。
- 健康检查 URL 是否可达。

### 3. 部署候选版本

- 容器镜像：创建 candidate ReplicaSet / patch deployment image。
- 静态站点：解包到新版本目录，不切 current。
- 服务包：分发到灰度实例，不重启全量。
- Helm：执行 `helm upgrade --install` candidate values。

### 4. 切入灰度流量

按照当前 step 和区域配置生成 `TrafficSnapshot`：

```ts
type TrafficSnapshot = {
  globalPercent: number;
  regions: Array<{ id: string; name: string; percent: number }>;
  cohorts: Array<{ key: string; percent: number }>;
  rules: Array<{ type: "header" | "cookie" | "user" | "ip"; expression: string }>;
  appliedBy: string;
  appliedAt: string;
};
```

### 5. 观测与门禁

每个 step 至少保存：

- 请求量。
- 成功率。
- 错误率。
- P95/P99 延迟。
- 5xx 数量。
- Pod/实例健康。
- 最近错误事件。
- 执行器命令和输出。

门禁结果：

- `healthy`：允许自动推进或等待人工确认。
- `warning`：暂停灰度，要求人工判断。
- `failed`：自动回滚或阻断后续阶段。

### 6. 推进 / 暂停 / 全量 / 回滚

- 推进：计算下一 step，重新 apply traffic rule。
- 暂停：保持当前网关规则，停止自动推进计时器。
- 全量：把所有区域和分组切到 candidate，记录 candidate 为 stable。
- 回滚：恢复 stable revision，清理 candidate traffic rule。

## API 设计

```text
POST   /api/release-plans
GET    /api/release-plans/:id
POST   /api/release-plans/:id/start

GET    /api/releases/:id
POST   /api/releases/:id/canary/advance
POST   /api/releases/:id/canary/pause
POST   /api/releases/:id/canary/resume
POST   /api/releases/:id/canary/promote
POST   /api/releases/:id/rollback
GET    /api/releases/:id/events/stream
GET    /api/releases/:id/analysis

GET    /api/deployment-targets
POST   /api/deployment-targets
POST   /api/deployment-targets/:id/preflight
```

## UI 设计

### 制品中心

- 每个制品提供“上线”和“灰度上线”两个入口。
- 灰度上线弹窗包含：
  - 环境。
  - DeploymentTarget。
  - 打包方式对应的灰度策略模板。
  - 区域百分比表格。
  - 分组 / Header / Cookie 规则。
  - 指标门禁。
  - 回滚策略。

### Release 详情页

- 顶部：版本、环境、目标、当前状态、当前流量。
- 左侧：灰度批次时间线。
- 中间：每个批次的真实执行命令、网关规则、Kubernetes/实例事件。
- 右侧：指标门禁、操作按钮、回滚锚点。

### Tekton / Kubernetes 联动

- PipelineRun 结束后只产出 Artifact。
- ReleasePlan 使用 Artifact 触发上线。
- ReleaseExecution 订阅 Kubernetes/网关事件。
- UI 不把流水线 stage 和 release stage 混在一起，但可以互相跳转。

## Supabase / 数据库表建议

如果继续接 Supabase，建议新增或完善以下表：

```sql
release_plans(id, artifact_id, application_id, environment_id, package_mode, strategy, policy_json, created_by, created_at)
release_executions(id, plan_id, status, stable_revision, candidate_revision, current_traffic_json, started_at, finished_at)
release_steps(id, execution_id, step_index, percent, regions_json, status, analysis_json, started_at, finished_at)
deployment_targets(id, environment_id, adapter, namespace, workload_name, service_name, ingress_name, container_name, health_check_url, service_connection_id, traffic_connection_id)
environment_locks(id, environment_id, application_id, execution_id, status, expires_at, created_at)
release_events(id, execution_id, type, message, payload_json, created_at)
```

## Phase 3: 任务拆解

- [x] Task 1: 把当前 `ReleaseDeployment` 拆成 `ReleasePlan` + `ReleaseExecution`，保留兼容层。
- [x] Task 2: 增加 `DeploymentTarget` 模型和 API，去掉 release path 对全局 `K8S_*` 的依赖。
- [x] Task 3: 增加环境锁，同应用同环境只允许一个 active release。
- [ ] Task 4: 抽象 `TrafficAdapter`，先实现 `local-docker-stateful` 和 `kubernetes-deployment`。
- [ ] Task 5: 增加 `nginx-ingress-canary` 或 `istio-virtual-service` 二选一真实流量 adapter。
- [ ] Task 6: 增加指标门禁和 `release analysis` 存储。
- [ ] Task 7: 前端新增灰度上线弹窗和 Release 详情页。
- [ ] Task 8: 增加 Supabase 表迁移和回归测试。

## Phase 4: Review 预期风险

- P0: 如果没有真实网关 adapter，区域百分比只能是状态机记录，不能标记为真实流量切换。
- P0: 环境锁必须先落，否则两个 release 同时改同一个 Deployment/Ingress 会互相覆盖。
- P1: 自动回滚必须有 stable revision；第一次上线没有稳定版本时只能失败并保留 candidate。
- P1: 不同 packageMode 的灰度策略不能共用一个 UI 表单，否则用户会误配。
- P1: Supabase 表设计要保留 JSON policy，同时保留关键字段索引，避免后续无法筛选 active release。

## Phase 5: 验证策略

### 类型与构建

```powershell
pnpm --filter @deploy-management/shared build
pnpm check
pnpm build
```

### API 测试

- 创建 DeploymentTarget。
- 创建 ReleasePlan。
- Start release 后获取 active environment lock。
- Advance 后 `currentTraffic` 与 `release_steps.regions_json` 一致。
- Promote 后 stable revision 更新。
- Rollback 后 traffic 恢复 stable。

### 真实环境测试

- local-docker：真实 pull/run，但 UI 明确显示“状态机灰度”。
- Kubernetes deployment：真实 patch image + rollout status。
- Nginx/Istio：真实更新权重规则，`kubectl get ingress/virtualservice -o yaml` 可看到对应权重。

## 推荐落地顺序

```text
Sprint A: DeploymentTarget + EnvironmentLock + ReleasePlan/Execution
Sprint B: TrafficAdapter + Kubernetes deployment adapter
Sprint C: Ingress/Istio adapter + Analysis gate + 自动回滚
Sprint D: Release 详情页 + Supabase migration + E2E 验证
```

我建议下一步先做 Sprint A。因为没有目标和环境锁，后续任何真实网关灰度都会有并发覆盖风险。

## Checkpoint 1: Sprint A 已落地

### 已完成

- shared 契约新增 `DeploymentTarget`、`ReleasePlan`、`ReleaseExecution`、`EnvironmentLock`、`TrafficSnapshot`，并在 `ReleaseDeployment` 上保留 `deploymentTargetId`、`releasePlanId`、`releaseExecutionId` 兼容字段。
- API 上线入口现在会先解析或自动创建 DeploymentTarget，再创建 ReleasePlan / ReleaseExecution，并获取环境锁；同应用同环境存在 active lock 时会阻止并发上线。
- `deployArtifact` 成功、失败、灰度推进、暂停、恢复、全量、回滚都会同步 ReleaseExecution / ReleasePlan 状态；全量完成或回滚后会释放环境锁。
- 新增 DeploymentTarget、EnvironmentLock、ReleasePlan、ReleaseExecution 的 repository、snapshot 字段和只读/创建 API，后续 Supabase 会通过现有 collection store 自动落库。

### 当前边界

- `local-docker` 仍是真实 pull/run 的本地执行器，但灰度流量仍是状态机记录，不标记为真实网关切流。
- Kubernetes Deployment 仍沿用当前 `kubectl set image + rollout status` 执行路径；DeploymentTarget 已接入，下一步需要把 `deploymentName/containerName/serviceName/trafficConnectionId` 接入真实 TrafficAdapter。

### 验证

```powershell
pnpm --filter @deploy-management/shared build
pnpm --filter @deploy-management/api check
pnpm --filter @deploy-management/web check
pnpm check
```
