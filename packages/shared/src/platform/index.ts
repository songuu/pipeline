import type { RunHandle } from "../executor";
import type { ImageArtifactConfig } from "../registry";
import type { DeploymentTarget, EnvironmentLock, ReleaseDeployment, ReleaseEvent, ReleaseExecution, ReleasePlan } from "../release";
import type { TektonControlPlaneSnapshot } from "../tekton";
import type { GlobalParam } from "../yunxiao";

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
export type VariableInjectionTiming = "build" | "runtime" | "deploy";
export type SourceRepositoryProvider = "codeup" | "github" | "gitlab" | "gitcode" | "gitea";
export type PipelineBuildRuntime = "node" | "go" | "generic";
export const PACKAGE_BUILD_COMMAND_MODES = ["script", "custom"] as const;
export type PackageBuildCommandMode = (typeof PACKAGE_BUILD_COMMAND_MODES)[number];
export const PACKAGE_MODES = ["container_image", "static_site", "server_package", "kubernetes_manifest", "helm_chart"] as const;
export type PackageMode = (typeof PACKAGE_MODES)[number];
export const PACKAGE_UPLOAD_PROVIDERS = ["local-filesystem", "oss", "static-server", "custom"] as const;
export type PackageUploadProvider = (typeof PACKAGE_UPLOAD_PROVIDERS)[number];
export const PACKAGE_UPLOAD_COMMAND_MODES = ["provider", "custom"] as const;
export type PackageUploadCommandMode = (typeof PACKAGE_UPLOAD_COMMAND_MODES)[number];
export type RolloutCapability = "traffic" | "cdn" | "instance" | "kubernetes" | "helm" | "manual";

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
  provider: SourceRepositoryProvider;
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
  imageArtifact?: ImageArtifactConfig;
  buildConfig?: PipelineBuildConfig;
  packageUpload?: PackageUploadConfig;
};

export type PipelineCacheConfig = {
  key: string;
  path: string;
  restoreKeys: string[];
  enabled: boolean;
};

export type PipelineBuildConfig = {
  packageMode?: PackageMode;
  runtime?: PipelineBuildRuntime;
  contextPath?: string;
  packageBuildCommandMode?: PackageBuildCommandMode;
  packageBuildScript: string;
  packageBuildCommand?: string;
  packageOutputPaths: string[];
};

export const DEFAULT_PIPELINE_BUILD_CONFIG: PipelineBuildConfig = {
  packageMode: "container_image",
  runtime: "node",
  contextPath: ".",
  packageBuildCommandMode: "script",
  packageBuildScript: "build",
  packageOutputPaths: [".next", "dist", "build", "out", "apps/web/.next", "apps/api/dist", "packages/shared/dist"],
};

export type PackageUploadConfig = {
  provider: PackageUploadProvider;
  customUploadCommandMode?: PackageUploadCommandMode;
  endpoint: string;
  publicBaseUrl?: string;
  accessDomain?: string;
  targetPathTemplate: string;
  serviceConnection: string;
  customUploadCommand?: string;
};

export const DEFAULT_PACKAGE_UPLOAD_CONFIG: PackageUploadConfig = {
  provider: "local-filesystem",
  customUploadCommandMode: "provider",
  endpoint: ".codex-tmp/package-uploads",
  targetPathTemplate: "${application.id}/${environment}/${run.id}/${artifact.name}",
  serviceConnection: "local-package-store",
};

export function resolvePackageBuildCommandMode(config: Pick<PipelineBuildConfig, "packageBuildCommandMode" | "packageBuildCommand">): PackageBuildCommandMode {
  return config.packageBuildCommandMode ?? (config.packageBuildCommand?.trim() ? "custom" : "script");
}

export function shouldRunCustomPackageBuildCommand(config: Pick<PipelineBuildConfig, "packageBuildCommandMode" | "packageBuildCommand">): boolean {
  return resolvePackageBuildCommandMode(config) === "custom" && Boolean(config.packageBuildCommand?.trim());
}

export function resolvePackageUploadCommandMode(config: Pick<PackageUploadConfig, "provider" | "customUploadCommandMode" | "customUploadCommand">): PackageUploadCommandMode {
  if (config.provider === "custom") return "custom";
  return config.customUploadCommandMode ?? (config.customUploadCommand?.trim() ? "custom" : "provider");
}

export function shouldRunCustomPackageUploadCommand(config: Pick<PackageUploadConfig, "provider" | "customUploadCommandMode" | "customUploadCommand">): boolean {
  return resolvePackageUploadCommandMode(config) === "custom" && Boolean(config.customUploadCommand?.trim());
}

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
  executor?: RunHandle;
};

export type TriggerRunRequest = {
  repositoryId?: string;
  refType?: GitReferenceType;
  refName?: string;
  branch?: string;
  tag?: string;
  commitSha?: string;
  repositoryAccessToken?: string;
  actor?: string;
  environment?: EnvironmentType;
  canaryPercent?: number;
  stages?: LifecycleStageKey[];
};

export type CreatePipelineRequest = {
  name: string;
  applicationId: string;
  repositoryId: string;
  repositoryUrl?: string;
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
  imageArtifact?: ImageArtifactConfig;
  buildConfig?: PipelineBuildConfig;
  packageUpload?: PackageUploadConfig;
};

export type UpdatePipelineRequest = Partial<
  Pick<
    CreatePipelineRequest,
    | "name"
    | "repositoryId"
    | "repositoryUrl"
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
    | "imageArtifact"
    | "buildConfig"
    | "packageUpload"
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
  currentImage?: string;
  currentDigest?: string;
  lastReleaseId?: string;
  activeReleaseId?: string;
  activeReleasePlanId?: string;
  activeReleaseExecutionId?: string;
  activeLockId?: string;
  deployedAt?: string;
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
  uri?: string;
  publicUrl?: string;
  storageProvider?: PackageUploadProvider | ImageArtifactConfig["registryProvider"];
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
  releases: ReleaseDeployment[];
  deploymentTargets: DeploymentTarget[];
  releasePlans: ReleasePlan[];
  releaseExecutions: ReleaseExecution[];
  releaseEvents: ReleaseEvent[];
  environmentLocks: EnvironmentLock[];
  auditEvents: AuditEvent[];
  tekton: TektonControlPlaneSnapshot;
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
