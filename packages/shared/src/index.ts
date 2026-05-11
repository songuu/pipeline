// ============================================================================
// 部署管理平台共享领域模型
//
// 本文件聚合三层概念：
//   1. 平台产品模型 (Application / Pipeline / Run / Approval / Environment)
//   2. 云效 (Aliyun Yunxiao Flow) OpenAPI 对齐 (PipelineRunInstance / Stage / Job
//      / TriggerMode / GlobalParam / PipelineSource)
//   3. Tekton 工作流模型 (Task / Step / Param / Result / Workspace / When)
//
// 旧字段保留以保持向后兼容；新字段并行存在，前后端逐步迁移。
// ============================================================================

// ----------------------------------------------------------------------------
// 1. 平台产品模型（既有，向后兼容）
// ----------------------------------------------------------------------------

export type LifecycleStageKey =
  | "source"
  | "test"
  | "build"
  | "env"
  | "package"
  | "upload"
  | "deploy"
  | "canary"
  | "approval"
  | "promote";

export type StageStatus = "pending" | "running" | "success" | "failed" | "waiting" | "skipped";
export type PipelineRunStatus = "queued" | "running" | "waiting_approval" | "success" | "failed" | "canceled";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type EnvironmentType = "dev" | "test" | "staging" | "prod";
export type GitReferenceType = "branch" | "tag";

export type LifecycleStageSpec = {
  key: LifecycleStageKey;
  title: string;
  description: string;
  adapter: string;
  required: boolean;
};

export type Application = {
  id: string;
  name: string;
  owner: string;
  repositoryId: string;
  repository: string;
  defaultBranch: string;
  language: string;
  serviceType: string;
  environments: EnvironmentType[];
};

export type SourceRepository = {
  id: string;
  name: string;
  provider: "codeup" | "github" | "gitlab" | "gitea";
  url: string;
  defaultBranch: string;
  branches: string[];
  tags: string[];
  recentCommits: SourceCommit[];
  owner: string;
};

export type SourceCommit = {
  sha: string;
  message: string;
  author: string;
  createdAt: string;
};

export type PipelineSourcePolicy = {
  allowedBranchPatterns: string[];
  allowedTagPatterns: string[];
  allowRuntimeBranch: boolean;
  allowRuntimeTag: boolean;
  allowRuntimeCommit: boolean;
};

export type PipelineDefinition = {
  id: string;
  name: string;
  applicationId: string;
  repositoryId: string;
  repository: string;
  defaultBranch: string;
  defaultRefType: GitReferenceType;
  defaultRef: string;
  sourcePolicy: PipelineSourcePolicy;
  targetEnvironment: EnvironmentType;
  strategy: "rolling" | "canary" | "blue_green";
  canaryPercent: number;
  requiresApproval: boolean;
  stages: LifecycleStageKey[];
  triggers: string[];
  owner: string;
  variables?: GlobalParam[];
  runtimeVariables?: GlobalParam[];
  caches?: PipelineCacheConfig[];
  serviceConnections?: string[];
};

export type PipelineCacheConfig = {
  key: string;
  path: string;
  restoreKeys: string[];
  enabled: boolean;
};

export type TektonComponentName =
  | "Pipelines"
  | "Triggers"
  | "Results"
  | "Chains"
  | "Dashboard"
  | "Operator"
  | "Hub";

export type TektonComponentStatus = "ready" | "degraded" | "disabled";

export type TektonComponent = {
  name: TektonComponentName;
  namespace: string;
  version: string;
  status: TektonComponentStatus;
  readyReplicas: number;
  desiredReplicas: number;
  description: string;
};

export type TektonTriggerBinding = {
  eventListener: string;
  trigger: string;
  triggerBinding: string;
  triggerTemplate: string;
  route: string;
  interceptors: string[];
};

export type TektonResolverKind = "cluster" | "git" | "bundle" | "hub";

export type TektonResolverRef = {
  resolver: TektonResolverKind;
  resourceKind: "Pipeline" | "Task";
  name: string;
  source: string;
  revision: string;
  params: GlobalParam[];
};

export type TektonWorkspaceBinding = {
  name: string;
  type: "persistentVolumeClaim" | "emptyDir" | "secret" | "configMap";
  mountPath: string;
  claimName?: string;
  secretName?: string;
  configMapName?: string;
  subPath?: string;
  readOnly?: boolean;
  optional?: boolean;
  description: string;
};

export type TektonTaskGraphNode = {
  name: LifecycleStageKey;
  taskRef: string;
  runAfter: LifecycleStageKey[];
  workspaces: string[];
  params: GlobalParam[];
  retries: number;
  timeoutSeconds: number;
  when?: WhenExpression[];
};

export type TektonResultRecord = {
  name: string;
  recordType: "PipelineRun" | "TaskRun" | "Log" | "SourceEvent" | "Artifact" | "CloudEvent";
  value: string;
  storedAt: string;
  summary: string;
};

export type TektonRunEvent = {
  type: "Normal" | "Warning";
  reason: string;
  message: string;
  timestamp: string;
  involvedObject: string;
};

export type TektonPipelineBinding = {
  pipelineId: string;
  namespace: string;
  pipelineName: string;
  serviceAccountName: string;
  resolver: TektonResolverKind;
  resolverRef: TektonResolverRef;
  workspaces: string[];
  workspaceBindings: TektonWorkspaceBinding[];
  params: GlobalParam[];
  taskGraph: TektonTaskGraphNode[];
  trigger: TektonTriggerBinding;
  results: {
    resultName: string;
    records: number;
    retentionDays: number;
  };
  chains: {
    format: "in-toto" | "slsa/v1" | "slsa/v2alpha3" | "slsa/v2alpha4";
    storage: string[];
    signedArtifacts: number;
  };
};

export type PipelineStageRun = {
  id: string;
  key: LifecycleStageKey;
  title: string;
  status: StageStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  logs: string[];
  metadata: Record<string, string | number | boolean>;
};

export type PipelineRun = {
  id: string;
  pipelineId: string;
  pipelineName: string;
  applicationId: string;
  applicationName: string;
  actor: string;
  repositoryId: string;
  repository: string;
  refType: GitReferenceType;
  refName: string;
  branch: string;
  tag?: string;
  commit: string;
  environment: EnvironmentType;
  status: PipelineRunStatus;
  progress: number;
  canaryPercent: number;
  createdAt: string;
  updatedAt: string;
  definitionSnapshot: PipelineDefinition;
  stages: PipelineStageRun[];
};

export type TektonTaskRunRef = {
  taskRunName: string;
  pipelineTaskName: string;
  taskRef: string;
  status: JobStatus;
  podName: string;
  retries: number;
  workspaces: string[];
  steps: StepInstance[];
  results: Record<string, string>;
  startedAt?: string;
  finishedAt?: string;
};

export type TektonRunRecord = {
  runId: string;
  namespace: string;
  pipelineRunName: string;
  status: JobStatus;
  conditionReason: string;
  conditionMessage: string;
  childReferences: Array<{
    name: string;
    kind: "TaskRun" | "Run";
    pipelineTaskName: string;
  }>;
  taskRuns: TektonTaskRunRef[];
  params: GlobalParam[];
  workspaceBindings: TektonWorkspaceBinding[];
  results: TektonResultRecord[];
  events: TektonRunEvent[];
  pipelineSpecRef?: TektonResolverRef;
  resultRecordName: string;
  logsUrl: string;
  chainsAttestation?: {
    name: string;
    format: TektonPipelineBinding["chains"]["format"];
    storage: string;
    signed: boolean;
    digest: string;
  };
};

export type TriggerRunRequest = {
  repositoryId?: string;
  refType?: GitReferenceType;
  refName?: string;
  branch?: string;
  tag?: string;
  commitSha?: string;
  actor?: string;
  environment?: EnvironmentType;
  canaryPercent?: number;
  stages?: LifecycleStageKey[];
};

export type CreatePipelineRequest = {
  name: string;
  applicationId: string;
  repositoryId: string;
  refType: GitReferenceType;
  refName: string;
  sourcePolicy?: PipelineSourcePolicy;
  targetEnvironment: EnvironmentType;
  strategy: PipelineDefinition["strategy"];
  canaryPercent: number;
  requiresApproval: boolean;
  stages: LifecycleStageKey[];
  triggers: string[];
  owner: string;
  variables?: GlobalParam[];
  runtimeVariables?: GlobalParam[];
  caches?: PipelineCacheConfig[];
  serviceConnections?: string[];
};

export type UpdatePipelineRequest = Partial<
  Pick<
    CreatePipelineRequest,
    | "name"
    | "repositoryId"
    | "refType"
    | "refName"
    | "sourcePolicy"
    | "targetEnvironment"
    | "strategy"
    | "canaryPercent"
    | "requiresApproval"
    | "stages"
    | "triggers"
    | "owner"
    | "variables"
    | "runtimeVariables"
    | "caches"
    | "serviceConnections"
  >
>;

export type ApprovalRequest = {
  id: string;
  runId: string;
  title: string;
  requester: string;
  environment: EnvironmentType;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
};

export type DeploymentEnvironment = {
  id: EnvironmentType;
  name: string;
  cluster: string;
  protection: string;
  currentVersion: string;
  status: "healthy" | "locked" | "warning";
  activeRuns: number;
};

export type RunnerPool = {
  id: string;
  name: string;
  type: "kubernetes" | "vm" | "windows" | "remote";
  online: number;
  total: number;
  queue: number;
  cpuUsage: number;
  memoryUsage: number;
};

export type Artifact = {
  id: string;
  runId: string;
  name: string;
  version: string;
  type: "image" | "package" | "sbom" | "provenance";
  digest: string;
  size: string;
  signed: boolean;
  uploadedAt: string;
};

export type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  target: string;
  createdAt: string;
};

export type PlatformOverview = {
  applications: number;
  pipelines: number;
  runningRuns: number;
  waitingApprovals: number;
  successRate: number;
  activeEnvironments: number;
};

export type PlatformSnapshot = {
  overview: PlatformOverview;
  applications: Application[];
  repositories: SourceRepository[];
  pipelines: PipelineDefinition[];
  runs: PipelineRun[];
  approvals: ApprovalRequest[];
  environments: DeploymentEnvironment[];
  runnerPools: RunnerPool[];
  artifacts: Artifact[];
  auditEvents: AuditEvent[];
  tekton: TektonControlPlaneSnapshot;
};

export type TektonControlPlaneSnapshot = {
  operator: {
    tektonConfigName: string;
    status: TektonComponentStatus;
    profile: "basic" | "lite" | "all";
    targetNamespace: string;
  };
  cluster: {
    context: string;
    executorMode: RunHandle["backend"];
    namespaces: string[];
  };
  components: TektonComponent[];
  bindings: TektonPipelineBinding[];
  runRecords: TektonRunRecord[];
};

export const LIFECYCLE_STAGES: LifecycleStageSpec[] = [
  {
    key: "source",
    title: "拉取代码",
    description: "验签 webhook，解析 revision，clone 代码并生成 source snapshot。",
    adapter: "GitSourceAdapter",
    required: true,
  },
  {
    key: "test",
    title: "测试与扫描",
    description: "执行单元测试、类型检查、SAST 和质量门禁。",
    adapter: "QualityGateAdapter",
    required: true,
  },
  {
    key: "build",
    title: "打包构建",
    description: "根据应用类型执行 npm/maven/go build 或容器构建。",
    adapter: "BuildAdapter",
    required: true,
  },
  {
    key: "env",
    title: "注入环境变量",
    description: "合并流水线变量、运行变量和密钥引用，生成任务级环境注入清单。",
    adapter: "EnvInjectionAdapter",
    required: true,
  },
  {
    key: "package",
    title: "生成制品",
    description: "生成镜像、前端静态包、SBOM 和 provenance 原始材料。",
    adapter: "ArtifactPackager",
    required: true,
  },
  {
    key: "upload",
    title: "上传制品",
    description: "推送镜像仓库、对象存储或 OCI registry，并记录 digest。",
    adapter: "RegistryUploadAdapter",
    required: true,
  },
  {
    key: "deploy",
    title: "部署环境",
    description: "渲染 Helm/Kustomize manifest 并提交给执行集群。",
    adapter: "KubernetesDeployAdapter",
    required: true,
  },
  {
    key: "canary",
    title: "灰度发布",
    description: "按流量比例渐进发布，观察错误率和延迟。",
    adapter: "CanaryRolloutAdapter",
    required: true,
  },
  {
    key: "approval",
    title: "发布审批",
    description: "生产环境进入人工审批和变更窗口门禁。",
    adapter: "ApprovalGateAdapter",
    required: false,
  },
  {
    key: "promote",
    title: "全量发布",
    description: "审批通过后扩大流量，写入部署历史和审计事件。",
    adapter: "PromotionAdapter",
    required: true,
  },
];

export const getLifecycleStage = (key: LifecycleStageKey): LifecycleStageSpec => {
  const stage = LIFECYCLE_STAGES.find((item) => item.key === key);
  if (!stage) {
    throw new Error(`Unknown lifecycle stage: ${key}`);
  }
  return stage;
};

// ----------------------------------------------------------------------------
// 2. 云效 (Aliyun Yunxiao Flow) 对齐
// 参考: https://help.aliyun.com/zh/yunxiao/developer-reference/
// ----------------------------------------------------------------------------

// 云效 triggerMode 编码: 1 manual, 2 scheduled, 3 code commit, 5 pipeline, 6 webhook
// 字符串化便于跨语言传输
export type TriggerMode = "manual" | "scheduled" | "code_commit" | "webhook" | "pipeline" | "openapi";

export type JobStatus = "INIT" | "QUEUED" | "RUNNING" | "SUCCESS" | "FAIL" | "SKIPPED" | "CANCELED";

export interface PipelineSource {
  id: string;
  type: SourceRepository["provider"];
  endpoint: string;
  branch?: string;
  tag?: string;
  cloneDepth?: number;
  credentialId?: string;
  webhookUrl?: string;
}

export interface GlobalParam {
  key: string;
  value: string;
  encrypted?: boolean;
  description?: string;
}

export interface StepInstance {
  id: string;
  name: string;
  image?: string;
  command?: string[];
  status: JobStatus;
  exitCode?: number;
  logsRef?: string;
}

export interface JobInstance {
  id: string;
  name: string;
  taskRef: string;
  status: JobStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  steps: StepInstance[];
  result?: Record<string, string>;
  logsRef?: string;
}

export interface StageInstance {
  index: number;
  name: string;
  status: JobStatus;
  jobs: JobInstance[];
}

export interface PipelineRunInstance {
  pipelineRunId: string;
  pipelineId: string;
  pipelineName: string;
  status: JobStatus;
  triggerMode: TriggerMode;
  creatorAccountId: string;
  modifierAccountId?: string;
  createTime: string;
  updateTime: string;
  sources: PipelineSource[];
  stages: StageInstance[];
  globalParams: GlobalParam[];
}

// Yunxiao StartPipelineRun 触发参数（params 字段对齐）
export interface StartPipelineRunParams {
  branchModeBranchs?: string[];
  envs?: Record<string, string>;
  runningBranchs?: Record<string, string>;
  runningTags?: Record<string, string>;
  comment?: string;
}

// ----------------------------------------------------------------------------
// 3. Tekton 工作流模型（控制面内部使用，与 tektoncd/pipeline schema 对齐）
// 参考: https://tekton.dev/docs/pipelines/pipelines/
// ----------------------------------------------------------------------------

export interface ParamSpec {
  name: string;
  type: "string" | "array";
  description?: string;
  default?: string | string[];
}

export interface ResultSpec {
  name: string;
  description?: string;
}

export interface WorkspaceDeclaration {
  name: string;
  description?: string;
  readOnly?: boolean;
  optional?: boolean;
}

export interface StepSpec {
  name: string;
  image: string;
  command?: string[];
  args?: string[];
  script?: string;
  env?: Array<{ name: string; value: string }>;
  workingDir?: string;
}

export interface TaskSpec {
  name: string;
  description?: string;
  steps: StepSpec[];
  params?: ParamSpec[];
  results?: ResultSpec[];
  workspaces?: WorkspaceDeclaration[];
}

export interface WhenExpression {
  input: string;
  operator: "in" | "notin";
  values: string[];
}

export interface PipelineTaskRef {
  name: string;
  taskRef: string;
  runAfter?: string[];
  when?: WhenExpression[];
  params?: Array<{ name: string; value: string }>;
  retries?: number;
  timeoutSeconds?: number;
  onError?: "stopAndFail" | "continue";
}

export interface PipelineSpec {
  displayName?: string;
  description?: string;
  params?: ParamSpec[];
  workspaces?: WorkspaceDeclaration[];
  results?: ResultSpec[];
  tasks: PipelineTaskRef[];
  finally?: PipelineTaskRef[];
}

// ----------------------------------------------------------------------------
// 4. 通用 API 响应封装
// ----------------------------------------------------------------------------

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    requestId?: string;
  };
}

// ----------------------------------------------------------------------------
// 5. ExecutorAdapter 通信契约（Nest ↔ services/tekton-bridge）
// ----------------------------------------------------------------------------

export interface StartRunInput {
  pipelineRunId: string;
  pipelineName: string;
  applicationId: string;
  environment: EnvironmentType;
  stages: LifecycleStageKey[];
  sources: PipelineSource[];
  globalParams: GlobalParam[];
  canaryPercent: number;
  requiresApproval: boolean;
}

export interface RunHandle {
  runId: string;
  backend: "simulated" | "tekton";
}

export interface RunStatus {
  runId: string;
  status: JobStatus;
  stages: StageInstance[];
  startedAt?: string;
  finishedAt?: string;
}

export interface RunEvent {
  runId: string;
  type: "stage" | "job" | "step" | "log" | "status";
  timestamp: string;
  payload: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// 6. Yunxiao ↔ 平台模型映射工具
// ----------------------------------------------------------------------------

const STAGE_STATUS_TO_JOB: Record<StageStatus, JobStatus> = {
  pending: "INIT",
  running: "RUNNING",
  success: "SUCCESS",
  failed: "FAIL",
  waiting: "QUEUED",
  skipped: "SKIPPED",
};

const RUN_STATUS_TO_JOB: Record<PipelineRunStatus, JobStatus> = {
  queued: "QUEUED",
  running: "RUNNING",
  waiting_approval: "QUEUED",
  success: "SUCCESS",
  failed: "FAIL",
  canceled: "CANCELED",
};

export const toYunxiaoJobStatus = (status: StageStatus): JobStatus => STAGE_STATUS_TO_JOB[status];

export const toYunxiaoRunStatus = (status: PipelineRunStatus): JobStatus => RUN_STATUS_TO_JOB[status];

export const toPipelineRunInstance = (run: PipelineRun): PipelineRunInstance => ({
  pipelineRunId: run.id,
  pipelineId: run.pipelineId,
  pipelineName: run.pipelineName,
  status: toYunxiaoRunStatus(run.status),
  triggerMode: "manual",
  creatorAccountId: run.actor,
  createTime: run.createdAt,
  updateTime: run.updatedAt,
  sources: [
    {
      id: run.repositoryId,
      type: "codeup",
      endpoint: run.repository,
      branch: run.refType === "branch" ? run.refName : run.branch,
      tag: run.refType === "tag" ? run.refName : run.tag,
    },
  ],
  stages: run.stages.map((stage, index) => ({
    index,
    name: stage.title,
    status: toYunxiaoJobStatus(stage.status),
    jobs: [
      {
        id: stage.id,
        name: stage.title,
        taskRef: stage.metadata.adapter ? String(stage.metadata.adapter) : stage.key,
        status: toYunxiaoJobStatus(stage.status),
        startedAt: stage.startedAt,
        finishedAt: stage.finishedAt,
        durationMs: stage.durationMs,
        steps: stage.logs.map((line, stepIndex) => ({
          id: `${stage.id}-step-${stepIndex}`,
          name: line.split(" ").slice(0, 3).join(" "),
          status: toYunxiaoJobStatus(stage.status),
        })),
      },
    ],
  })),
  globalParams: [
    { key: "ENVIRONMENT", value: run.environment },
    { key: "CANARY_PERCENT", value: String(run.canaryPercent) },
    { key: "COMMIT", value: run.commit },
    ...(run.definitionSnapshot.variables ?? []),
    ...(run.definitionSnapshot.runtimeVariables ?? []).map((param) => ({ ...param, key: `runtime.${param.key}` })),
  ],
});
