---
title: "Kubernetes 与 Tekton 深度接入方案"
type: sprint-research
status: in-progress
created: "2026-05-14"
updated: "2026-05-14"
tags: [sprint, kubernetes, tekton, cicd, architecture, bridge, release]
---

# Kubernetes 与 Tekton 深度接入方案

## 需求分析

用户原话：

> 研究下如何接入 k8s，目前对于 tekton 的接入还是不够深入，这是一个很复杂的系统。

当前项目已经能通过 `local-docker` 完成真实 checkout、package build、docker build、ACR push；`tekton-bridge` 也已经具备 `go build -tags tekton` 后创建真实 `PipelineRun` 的基础能力。但这还不是完整的 K8s/Tekton 接入。现在的问题是：系统只把 Tekton 当作一个“远程执行器”，还没有把 Kubernetes 的对象、权限、事件、日志、结果、制品、安全和发布状态纳入统一控制面。

本轮目标不是立刻一次性重写所有执行逻辑，而是把正式接入路径从源头拆清楚，形成后续可以直接执行的架构方案与任务边界。

## 官方能力锚点

本方案基于当前官方文档核对后的稳定能力：

- Tekton `PipelineRun` 是运行入口；它会执行 `Pipeline`，并由控制器创建关联的 `TaskRun`。官方文档入口：https://tekton.dev/docs/pipelines/pipelineruns/
- Tekton `TaskRun` 暴露每个 Task 的 step 状态、结果和执行时间，是运行详情页点击每一步时的真实数据源。官方文档入口：https://tekton.dev/docs/pipelines/taskruns/
- Tekton Results 用于长期保存 `PipelineRun`、`TaskRun`、日志和记录，避免把所有历史都压在 etcd 或控制器实时对象上。官方文档入口：https://tekton.dev/docs/results/
- Tekton Chains 监听 TaskRun / PipelineRun 完成事件，生成 provenance / attestation 并支持签名存储。官方文档入口：https://tekton.dev/docs/chains/
- Tekton Triggers 用 `EventListener`、`TriggerTemplate`、`TriggerBinding`、Interceptor 将 Git 事件转换成 PipelineRun。官方文档入口：https://tekton.dev/docs/triggers/
- Kubernetes Watch API 支持对资源变更进行增量观察，控制面不应该长期靠全量轮询。官方文档入口：https://kubernetes.io/docs/reference/using-api/api-concepts/#efficient-detection-of-changes
- Kubernetes RBAC 通过 Role / RoleBinding / ServiceAccount 限制 namespaced 资源访问。官方文档入口：https://kubernetes.io/docs/reference/access-authn-authz/rbac/

## 当前实现快照

```text
apps/api
  TektonBridgeExecutor
    start/status/cancel/events -> HTTP 调 services/tekton-bridge

services/tekton-bridge
  SimulatedBackend
    本地模拟，用于 demo

  TektonBackend
    dynamic client
    create tekton.dev/v1 PipelineRun
    list TaskRuns by label tekton.dev/pipelineRun=<name>
    patch spec.status=PipelineRunCancelled
    events() 每 2 秒轮询 PipelineRun + TaskRun

apps/api SnapshotService
  仍会根据 pipeline/run 合成 Tekton 控制面、component、TaskRun、events、results

apps/api ReleasesService
  kubernetes target 使用 kubectl set image + rollout status
```

已有基础是有价值的：Go bridge 这个边界是正确的，因为 Kubernetes/Tekton 的 watch、log stream、动态 CRD、RBAC、in-cluster config 都更适合放在一个独立运行时里，而不是塞进 Nest 控制面。

## 核心缺口

### P0-1. 缺少一等 K8s 连接模型

现在只有环境变量：

- `TEKTON_BRIDGE_KUBECONFIG`
- `KUBECONFIG`
- `TEKTON_BRIDGE_NAMESPACE`
- `TEKTON_SOURCE_PVC`
- `TEKTON_DOCKER_SECRET`

这对本机调试够用，但不适合服务器和多环境。正式系统必须有：

- `KubernetesClusterConnection`
- `KubernetesNamespaceBinding`
- `TektonRuntimeProfile`
- `RegistryServiceConnection`
- `GitServiceConnection`
- `DeploymentTarget`

业务代码不能直接把 `KUBECONFIG`、PVC、Secret name 当成全局变量。它们必须属于某个环境或运行配置。

### P0-2. 缺少 preflight 与 capability discovery

现在触发前只校验 PVC、Secret、少量参数。正式接入必须在运行前检查：

- Kubernetes API 是否可达。
- namespace 是否存在。
- ServiceAccount 是否存在且有权限。
- Tekton CRD 是否安装：`pipelineruns.tekton.dev`、`taskruns.tekton.dev`。
- 可选能力是否安装：Triggers、Results、Chains、Operator。
- PipelineRun API version 是否匹配当前桥接器支持范围。
- workspace PVC 是否可绑定。
- registry Secret 类型是否正确。
- 构建模式是否被集群允许：DinD privileged、Kaniko、BuildKit、Buildpacks 等。

这一步应该暴露为 API：

```text
GET /api/kubernetes/connections
POST /api/kubernetes/connections/:id/preflight
GET /api/tekton/capabilities?connectionId=...
```

前端页面显示“可运行 / 缺配置 / 权限不足 / 组件未安装”，而不是等 PipelineRun 创建失败。

### P0-3. 运行观察仍是轮询，不是 Kubernetes watch

`services/tekton-bridge/internal/backend/tekton.go` 当前 `Events` 每 2 秒调用 `Status()`，`Status()` 再读 PipelineRun + list TaskRuns。这个实现能跑，但不够深入：

- 事件延迟固定为轮询间隔。
- 高频运行会放大 API server 压力。
- 不能实时知道 TaskRun、Pod、Step container 的变化。
- 不能稳定输出日志流。
- API 重启后事件历史不可恢复。

目标应该是：

```text
PipelineRun watch
  -> run condition / childReferences / results

TaskRun watch
  -> pipelineTaskName / steps / results / retry / duration

Pod watch
  -> phase / containerStatuses / waiting reason / imageID / nodeName

Pod log stream
  -> step/container logs

K8s Event watch
  -> Scheduling / Pulling / Pulled / Started / Failed / BackOff 等真实原因

Tekton Results client
  -> 长期 run/task/log records
```

Nest 控制面只订阅 bridge 的标准化事件，不直接理解所有 Kubernetes 细节。

### P0-4. Snapshot 仍有合成 Tekton 对象

`SnapshotService` 目前仍能根据平台 run 合成 `TaskRun`、`Pod`、`Results`、`Events`。这会造成用户无法判断页面上看到的对象是否来自真实集群。

必须拆成两个模型：

```text
TektonDesiredBinding
  控制面希望创建的内容：
  namespace / serviceAccount / resolver / workspace / params / task graph / results/chains 策略

TektonObservedState
  集群真实观察到的内容：
  PipelineRun / TaskRun / Pod / Event / Result / Chain / log reference
```

UI 只能把 Observed 区域标记为 Tekton 实时对象；如果没有真实 bridge 返回，就展示“未连接集群”，不能合成 ready。

### P0-5. PipelineRun 创建模型还不完整

现在 inline `pipelineSpec` 能跑 smoke build，但生产使用还需要以下能力：

- `serviceAccountName`：控制 TaskRun 使用哪个 SA。
- `timeouts`：PipelineRun、Tasks、finally 分别超时。
- `taskRunTemplate` / `taskRunSpecs`：按 task 指定 podTemplate、serviceAccount、timeout、stepOverrides、sidecarOverrides。
- `params` 类型化：string / array / object。
- `workspaces`：PVC、emptyDir、Secret、ConfigMap 的运行时绑定。
- `pipelineRef`：
  - cluster-local Pipeline。
  - git resolver，从仓库读取 `.tekton/pipeline.yaml`。
  - bundle resolver，从 OCI bundle 读取 Task/Pipeline。
- `finally`：清理、通知、结果上报。
- `results`：镜像 digest、包路径、SBOM、test report、provenance 引用。
- `labels/annotations`：run-id、pipeline-id、application-id、environment、commit、artifact lineage。

建议先保留 inline smoke，但正式 pipeline 用 `pipelineRef` 或 resolver，不再长期由 Go 字符串拼接复杂 Task。

### P0-6. 日志与每一步详情还没成为一等能力

用户已经要求“Tekton 每一步都需要支持点击查看具体详情”。正式详情至少需要：

- Stage -> PipelineTask -> TaskRun。
- TaskRun -> Pod。
- Pod -> Step container。
- 每个 Step 的：
  - image / command / args / env 摘要
  - status / exitCode / reason
  - startedAt / finishedAt / duration
  - logs
  - result
  - waiting reason，例如 ImagePullBackOff、ErrImagePull、CreateContainerConfigError
- 相关 K8s Events。
- workspace mount 与 secret/configMap 引用。

这意味着 shared 模型要从 `StageInstance.jobs[].steps[]` 扩展为可表达 Kubernetes 对象引用。

### P0-7. 发布上线仍是 kubectl 命令，不是 Kubernetes deploy adapter

`ReleasesService.deployToKubernetes()` 当前直接 spawn `kubectl set image`。这可以做本机验证，但不是平台架构：

- 凭据依赖全局 `KUBECONFIG`。
- deployment/container/service/namespace 依赖全局环境变量或简单推断。
- 没有 rollout watch、ReplicaSet 记录、Pod 健康、失败事件、回滚点。
- 不能支持 Helm、Kustomize、Argo Rollouts、Canary、BlueGreen。

正式上线应由独立 deploy adapter 处理：

```text
KubernetesDeployAdapter
  preflight target deployment/service/ingress
  patch image or apply rendered manifest
  watch deployment rollout
  collect new ReplicaSet / Pods / Events
  health check endpoint
  write ReleaseExecution
  support rollback
```

## 目标架构

```text
apps/web
  Pipeline Config
    Desired Tekton binding
    K8s connection / namespace / service account / workspace / secret preflight

  Run Detail
    real-time SSE
    PipelineRun / TaskRun / Pod / Step / Logs / Results / Events

  Tekton Control Plane
    cluster capabilities
    component health
    CRD versions
    namespace resources

  Artifact & Release
    image digest
    provenance
    release plan
    rollout status

apps/api
  Platform Control Plane
    pipelines/runs/artifacts/releases/audit
    service connections
    event store
    snapshot aggregation

  ExecutorAdapter
    simulated
    local-docker
    tekton-bridge

  KubernetesConnectionService
    service connection registry
    preflight
    capabilities

services/tekton-bridge
  HTTP/SSE API to Nest

  KubeClientFactory
    in-cluster config
    kubeconfig secret/file
    impersonation optional

  TektonControllerAdapter
    create/cancel/get PipelineRun
    watch PipelineRun/TaskRun/Pod/Event
    stream Pod logs
    read Results/Chains when installed

  DeployAdapter
    Deployment rollout
    optional Helm/Kustomize/Argo later

Kubernetes cluster
  namespaces
  service accounts
  RBAC
  Tekton Pipelines / Triggers / Results / Chains
  PVC / Secrets / Registry credentials
```

## 领域模型补充

建议在 `packages/shared` 拆分后新增以下模型。

### Kubernetes 连接

```ts
export type KubernetesConnection = {
  id: string;
  name: string;
  clusterName: string;
  apiServer: string;
  authType: "in-cluster" | "kubeconfig" | "service-account-token" | "cloud-provider";
  secretRef: string;
  defaultNamespace: string;
  allowedNamespaces: string[];
  status: "unknown" | "ready" | "failed";
  lastCheckedAt?: string;
};
```

### Tekton runtime profile

```ts
export type TektonRuntimeProfile = {
  id: string;
  connectionId: string;
  namespace: string;
  serviceAccountName: string;
  pipelineMode: "inline" | "cluster-pipeline" | "git-resolver" | "bundle-resolver";
  pipelineRef?: string;
  resolverParams?: GlobalParam[];
  sourceWorkspace: TektonWorkspaceBinding;
  cacheWorkspace?: TektonWorkspaceBinding;
  dockerConfigSecret?: string;
  buildStrategy: "dind" | "kaniko" | "buildkit" | "buildpacks";
  resultsEnabled: boolean;
  chainsEnabled: boolean;
  triggersEnabled: boolean;
};
```

### Observed state

```ts
export type TektonObservedRun = {
  runId: string;
  connectionId: string;
  namespace: string;
  pipelineRunName: string;
  uid: string;
  generation: number;
  resourceVersion: string;
  status: JobStatus;
  conditionReason: string;
  conditionMessage: string;
  startedAt?: string;
  finishedAt?: string;
  pipelineRunResults: Record<string, string>;
  taskRuns: TektonObservedTaskRun[];
  events: KubernetesObjectEvent[];
  resultsRecords: TektonResultRecord[];
  chainsAttestations: TektonChainsAttestation[];
};

export type TektonObservedTaskRun = {
  taskRunName: string;
  uid: string;
  pipelineTaskName: string;
  podName?: string;
  status: JobStatus;
  steps: TektonObservedStep[];
  results: Record<string, string>;
  events: KubernetesObjectEvent[];
};

export type TektonObservedStep = {
  name: string;
  containerName: string;
  image?: string;
  imageId?: string;
  status: JobStatus;
  reason?: string;
  exitCode?: number;
  startedAt?: string;
  finishedAt?: string;
  logsRef?: string;
};
```

## Bridge API 需要扩展

现有：

```text
GET  /healthz
POST /v1/runs
GET  /v1/runs/:id
POST /v1/runs/:id/cancel
GET  /v1/runs/:id/events
```

建议扩展：

```text
GET  /v1/capabilities
POST /v1/preflight

GET  /v1/runs/:id/observed
GET  /v1/runs/:id/taskruns
GET  /v1/runs/:id/taskruns/:taskRunName
GET  /v1/runs/:id/taskruns/:taskRunName/logs?step=<step>
GET  /v1/runs/:id/events?sinceResourceVersion=<rv>

POST /v1/releases
GET  /v1/releases/:id
GET  /v1/releases/:id/events
POST /v1/releases/:id/rollback
```

`/events` 只传标准化事件；详细对象走 `/observed` 或 taskrun/log 端点，避免 SSE payload 过大。

## Kubernetes 权限最小集

如果 bridge 部署在集群里，建议为每个运行 namespace 绑定最小 Role。

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: deploy-management-tekton-bridge
  namespace: apps-test
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deploy-management-tekton-runner
  namespace: apps-test
rules:
  - apiGroups: ["tekton.dev"]
    resources: ["pipelineruns", "taskruns"]
    verbs: ["get", "list", "watch", "create", "patch", "delete"]
  - apiGroups: [""]
    resources: ["pods", "pods/log", "events", "persistentvolumeclaims", "secrets", "configmaps"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: deploy-management-tekton-runner
  namespace: apps-test
subjects:
  - kind: ServiceAccount
    name: deploy-management-tekton-bridge
    namespace: apps-test
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: deploy-management-tekton-runner
```

说明：

- 如果只运行 PipelineRun，不做发布，可以先去掉 `apps/deployments` 权限。
- 如果 Secret 内容不需要读取，只做存在性检查，可以保留 `get`，不要给 `create/update`。
- 多 namespace 时每个 namespace 建 RoleBinding；不要一开始就给 ClusterRole 全集群权限。

## 构建策略选择

当前 inline Tekton 用 `docker:27-dind` sidecar，需要 privileged。它适合本地或自控集群烟测，但生产集群可能禁止 privileged。

建议把构建策略配置化：

| 策略 | 优点 | 风险 | 适合阶段 |
|---|---|---|---|
| `dind` | 最接近本机 Docker，改动最小 | 需要 privileged，安全边界弱 | 本地/测试集群第一版 |
| `kaniko` | 不需要 Docker daemon | Dockerfile 兼容性需验证 | 普通 K8s 集群 |
| `buildkit` | 性能好，可缓存，可 rootless | 部署复杂一些 | 生产推荐 |
| `buildpacks` | 不写 Dockerfile | 对 Next/Nest monorepo 需规范化 | 未来可选 |

第一版可以保留 `dind`，但 UI 和 preflight 必须明确提示“当前 namespace 是否允许 privileged sidecar”。后续把 upload task 从硬编码 DinD 改成 `BuildStrategyAdapter`。

## 实施路线

### Phase 1: K8s 连接与 preflight

目标：先让系统知道自己连接的是哪个集群、namespace 有哪些能力、缺什么权限。

任务：

- 新增 `KubernetesConnection` / `TektonRuntimeProfile` shared 类型。
- API 新增 service connection 存储或先用本地持久化 registry。
- bridge 新增 `/v1/capabilities`：
  - Kubernetes server version。
  - Tekton CRD discovery。
  - namespace exists。
  - PVC/Secret/ServiceAccount exists。
  - Results/Chains/Triggers availability。
- bridge 新增 `/v1/preflight`，返回结构化缺失项，不只是一条错误字符串。
- 前端 Tekton 控制面页展示真实 preflight 结果。

验收：

- 没有 K8s 时显示“未连接”，不再显示 7/7 Ready。
- 缺 PVC/Secret/SA 时能指出缺哪个 namespace/name。
- bridge simulated 时真实运行入口仍拒绝。

### Phase 2: Watch 驱动的真实运行状态

目标：把轮询状态改成对象 watch + 事件存储。

任务：

- bridge 增加 PipelineRun watcher。
- bridge 增加 TaskRun watcher。
- bridge 增加 Pod watcher。
- bridge 增加 K8s Event watcher。
- Nest 新增 RunEvent append-only repository。
- `TektonBridgeExecutor.events()` 接收 bridge SSE 后写入 RunEvent。
- Snapshot 只读聚合状态，不负责实时细节。

验收：

- UI 每个阶段状态来自真实 TaskRun。
- 用户点击某个任务能看到真实 TaskRun name、Pod name、step 状态。
- 运行中刷新页面不丢失事件历史。

### Phase 3: Step 日志和 Results

目标：每一步详情可排障，而不是只看“success/failed”。

任务：

- bridge 增加 Pod log stream。
- 标准化 `logsRef`，支持按 run/task/step 获取日志。
- 解析 TaskRun results：
  - `package-path`
  - `package-digest`
  - `image-digest`
  - `sbom-ref`
  - `test-report`
- 如果安装 Tekton Results，接入 Results API 或至少生成 Results URL。
- 前端运行详情页 task panel 增加 logs/results/events tabs。

验收：

- `docker push` 失败时能看到具体 registry 错误。
- `npm run build` 失败时能看到对应 step 日志。
- 镜像 digest 从 TaskRun result 进入 Artifact，不再从 UI 合成。

### Phase 4: 正式 PipelineRef / Resolver

目标：从 inline smoke 过渡到可维护的 Tekton 资源。

任务：

- 支持 cluster Pipeline：`TEKTON_PIPELINE_REF` 变成 runtime profile 字段。
- 支持 git resolver：从业务仓库 `.tekton/pipeline.yaml` 或平台模板仓库读取。
- 支持 bundle resolver：将平台标准 Task/Pipeline 发布为 OCI bundle。
- 将当前 Go 字符串拼接 inline task 降级为 smoke/debug fallback。
- Pipeline 配置页可以选择 pipeline mode。

验收：

- 同一条流水线可以选择 inline / cluster pipeline / git resolver。
- 实际创建出的 PipelineRun spec 可在 UI 查看。
- Resolver 参数进入审计记录。

### Phase 5: Kubernetes 发布适配器

目标：上线过程也进入 K8s 控制面，而不是本机 `kubectl`。

任务：

- 新增 `DeploymentTarget` 模型。
- bridge 或 API deploy adapter 使用 Kubernetes client patch Deployment。
- watch Deployment rollout、ReplicaSet、Pod。
- 记录 release events。
- 支持 rollback 到上一版 image digest。
- 后续扩展 Helm/Kustomize/Argo Rollouts。

验收：

- 上线后可看到 Deployment、ReplicaSet、Pod 状态。
- 失败时展示 rollout 失败原因和 Pod event。
- rollback 不依赖手工复制旧镜像地址。

### Phase 6: 安全与多环境治理

目标：从“能跑”变成“能上线给多人用”。

任务：

- ServiceConnection 引入 secretRef，明文密码不进入 pipeline definition。
- namespace/environment 绑定。
- RBAC 权限预检查。
- 审计记录保存 connection、namespace、serviceAccount、commit、artifact digest。
- Chains attestation 与 artifact 绑定。
- Results retention 与日志存储策略。

验收：

- 一个 pipeline 不能越权跑到未授权 namespace。
- artifact/release 可以追溯到 commit、PipelineRun、TaskRun、image digest、操作者。
- Secret 字段不会出现在前端 snapshot 或 run logs 中。

## 当前代码建议修改点

### 1. `services/tekton-bridge` 拆层

当前 `internal/backend/tekton.go` 已经过大，建议拆成：

```text
internal/kube/
  config.go
  discovery.go
  rbac.go
  watches.go
  logs.go

internal/tekton/
  pipelinerun.go
  taskrun.go
  results.go
  chains.go
  resolver.go
  preflight.go

internal/backend/
  tekton.go      只编排 adapter，不直接堆所有 unstructured 解析
```

### 2. `apps/api/src/snapshot/snapshot.service.ts` 停止合成 observed state

改成：

- Desired: 仍由 pipeline definition 计算。
- Observed: 来自 `runs` 中持久化的 Tekton observed snapshot 或 bridge query。
- 没有 observed 时显示 disconnected/pending，不合成 ready。

### 3. `packages/shared/src/index.ts` 拆分模型

K8s/Tekton 会继续扩展，如果仍放在一个 `index.ts`，复杂度会迅速失控。建议最晚在 Phase 1 后拆。

```text
packages/shared/src/platform
packages/shared/src/source
packages/shared/src/executor
packages/shared/src/kubernetes
packages/shared/src/tekton
packages/shared/src/registry
packages/shared/src/release
packages/shared/src/yunxiao
```

### 4. `ReleasesService` 从 kubectl spawn 迁移到 adapter

本地 `kubectl` 可以保留为 dev fallback，但正式 `target=kubernetes` 应使用 Kubernetes client：

- dry-run/preflight。
- patch Deployment。
- watch rollout。
- collect events。
- write release execution。

## 第一版最小可落地配置

如果先接本机 kubeconfig 或服务器 kubeconfig，至少需要：

```powershell
$env:EXECUTOR = "tekton"
$env:TEKTON_BRIDGE_URL = "http://127.0.0.1:5050"
$env:TEKTON_BRIDGE_KUBECONFIG = "C:\Users\songyu\.kube\config"
$env:TEKTON_BRIDGE_NAMESPACE = "apps-test"
$env:TEKTON_SOURCE_PVC = "deploy-management-source-pvc"
$env:TEKTON_DOCKER_SECRET = "aliyun-acr-deploy-secret"
```

Bridge：

```powershell
cd services\tekton-bridge
go run -tags tekton .\cmd\server
```

K8s 侧资源：

```powershell
kubectl create namespace apps-test
kubectl -n apps-test create serviceaccount tekton-builder
kubectl -n apps-test create pvc deploy-management-source-pvc --storage=20Gi
kubectl -n apps-test create secret docker-registry aliyun-acr-deploy-secret `
  --docker-server=crpi-yjy3pqx1wqed2s2s.cn-hangzhou.personal.cr.aliyuncs.com `
  --docker-username=songyu19960525 `
  --docker-password=<ACR_PASSWORD>
```

注意：`kubectl create pvc` 在某些版本/集群里可能需要通过 YAML 指定 storageClass；最终脚本应生成 YAML 而不是只依赖命令行简写。

## 验证策略

风险等级：L4。原因是它会碰执行器、集群权限、凭据、制品、发布和实时观测。

分层验证：

- L1：无集群时 API/Web 不误报 Ready。
- L2：bridge simulated 与 tekton backend health 检查清晰区分。
- L3：接入一个真实 namespace，preflight 能识别 PVC/Secret/SA/CRD。
- L4：真实 PipelineRun 完成 checkout/build/push，UI 每一步可点开看到 TaskRun/Pod/Step/log/result。
- L4：用一个真实 image artifact 执行 Kubernetes rollout，并能看到 Deployment/Pod 事件。

命令：

```powershell
pnpm --filter @deploy-management/shared check
pnpm --filter @deploy-management/api check
pnpm --filter @deploy-management/web check
pnpm --filter @deploy-management/api build
pnpm --filter @deploy-management/web build
cd services\tekton-bridge
go test ./...
go build -tags tekton ./...
```

真实集群冒烟：

```powershell
kubectl api-resources | findstr /i "pipelinerun taskrun"
kubectl -n apps-test get sa,pvc,secret
Invoke-RestMethod http://127.0.0.1:5050/v1/capabilities
Invoke-RestMethod -Method Post http://127.0.0.1:5050/v1/preflight -Body '{}' -ContentType 'application/json'
```

## Sprint 任务拆解

- [x] Task 1: 新增 Kubernetes/Tekton connection、runtime profile、observed state 类型。
- [x] Task 2: bridge 新增 kube discovery/preflight/capabilities API。
- [x] Task 3: API 新增 Kubernetes connection service，并把 preflight 暴露给前端。
- [x] Task 4: bridge 从轮询事件改为 watch/informer 风格事件汇聚。
- [x] Task 5: run event 持久化，前端运行详情改成 SSE + event history。
- [x] Task 6: 接 Pod log 和 TaskRun results，每个 Tekton step 可点击查看详情。
- [ ] Task 7: Snapshot 拆 Desired/Observed，停止合成 Tekton Ready/TaskRun/Pod。
- [ ] Task 8: 支持 cluster PipelineRef / git resolver / bundle resolver。
- [ ] Task 9: Kubernetes 发布 adapter 替代 `kubectl set image`。
- [ ] Task 10: 补 RBAC、Secret、namespace、service account 的文档和自动生成脚本。

## 变更日志

- 2026-05-14: 新增 shared Kubernetes/Tekton connection、runtime profile、observed run/task/step、bridge capabilities/preflight 契约。
- 2026-05-14: `services/tekton-bridge` 新增 `GET /v1/capabilities` 与 `POST /v1/preflight`；simulated backend 会明确返回不可真实执行，tekton backend 会通过 Kubernetes discovery 检查 API server、Tekton CRD、namespace、ServiceAccount、PVC、docker-registry Secret 和关键运行参数。
- 2026-05-14: `apps/api` 新增 Kubernetes module，暴露 `/api/kubernetes/capabilities`、`/api/kubernetes/preflight`、`/api/tekton/capabilities`、`/api/tekton/preflight`；bridge 不可达时返回结构化 disconnected/preflight failed。
- 2026-05-14: `apps/web/app/lib/api.ts` 新增 `fetchTektonCapabilities` 与 `runTektonPreflight`，供页面后续接入真实 preflight 状态。
- 2026-05-14: `apps/api` 新增持久化 `run-events` 集合，`RunsService` 在 executor 状态同步时记录 status/stage/job/step 变化；新增 `/api/runs/:runId/events` 和 `/api/runs/:runId/events/stream`。
- 2026-05-14: 运行详情页新增 Realtime Events 区域，启动时读取事件历史，并通过 SSE 订阅后续事件。
- 2026-05-14: `services/tekton-bridge` 的 `/v1/runs/:runId/events` 从 2 秒轮询升级为 PipelineRun、TaskRun、Pod、Kubernetes Event watch 汇聚；首次连接时仍发送当前 status/stage 快照，避免用户打开详情页时空白。
- 2026-05-14: `services/tekton-bridge` 新增 `GET /v1/runs/:runId/taskruns/:taskRunName` 与 `GET /v1/runs/:runId/taskruns/:taskRunName/logs?step=`，通过 TaskRun 的 `status.podName` 读取 `pods/log`，并返回 TaskRun results/events。
- 2026-05-14: `apps/api` 新增 `/api/tekton/runs/:runId/taskruns/:taskRunName` 与 `/api/tekton/runs/:runId/taskruns/:taskRunName/logs` 代理，前端运行详情页点击 TaskRun/step 会拉取真实详情和 Pod step 日志。

## 审查结论

当前 Tekton 接入方向是对的：`services/tekton-bridge` 作为独立 Go bridge 是合适边界。现在已经补齐 capabilities/preflight、事件存储、watch 汇聚、TaskRun 详情和 Pod step 日志入口，下一层缺口主要集中在 Desired/Observed 快照分离、Resolver 模式、发布 rollout 和 RBAC/Secret 自动化。

下一步最应该先做 `Phase 1 + Phase 2`：

1. 先把 K8s connection、preflight、capabilities 做出来，让系统不再假装集群 ready。
2. 拆分 Snapshot Desired/Observed，停止在 snapshot 中合成 Tekton Ready/TaskRun/Pod。
3. 补 cluster PipelineRef / git resolver / bundle resolver，减少 inline PipelineSpec 的维护压力。

这三步完成后，Tekton 才会从“执行器按钮”变成平台的一等运行内核。

## 复利记录

本轮关键经验：接入 Tekton 不能只等同于“创建一个 PipelineRun”。真正的接入边界应该是 Kubernetes 对象生命周期：desired spec、observed state、watch events、pod logs、results、chains、RBAC 和 release rollout。只有把这套对象关系打通，前端看到的流水线才是实时、可排障、可审计的正式流程。
