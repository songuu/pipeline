import type { EnvironmentType, PackageMode, PipelineDefinition, RolloutCapability } from "../platform";

export type ReleaseStatus = "deploying" | "canarying" | "paused" | "success" | "failed" | "rolled_back";
export type ReleaseTarget = "local-docker" | "local-filesystem" | "kubernetes" | "helm";
export type CanaryStepStatus = "pending" | "active" | "success" | "failed" | "paused" | "rolled_back";
export type CanaryAnalysisStatus = "healthy" | "warning" | "failed" | "unknown";
export type ReleasePlanStatus = "draft" | "ready" | "running" | "completed" | "canceled";
export type ReleaseExecutionStatus =
  | "preflight"
  | "deploying"
  | "canarying"
  | "paused"
  | "promoting"
  | "success"
  | "failed"
  | "rolled_back";
export type EnvironmentLockStatus = "active" | "released" | "expired";
export type ReleaseEventType =
  | "release_plan_created"
  | "deployment_target_resolved"
  | "environment_lock_acquired"
  | "deploy_started"
  | "deploy_succeeded"
  | "deploy_failed"
  | "canary_advanced"
  | "canary_paused"
  | "canary_resumed"
  | "canary_promoted"
  | "release_rolled_back"
  | "environment_lock_released";
export type DeploymentTargetAdapter =
  | "local-docker"
  | "local-filesystem"
  | "kubernetes"
  | "helm"
  | "nginx-ingress"
  | "istio"
  | "argo-rollouts"
  | "aliyun-alb"
  | "cdn"
  | "ecs";

export type CanaryAnalysisSnapshot = {
  status: CanaryAnalysisStatus;
  sampledAt: string;
  requestCount: number;
  successRate: number;
  errorRate: number;
  p95LatencyMs: number;
  message: string;
};

export type CanaryTrafficRegion = {
  id: string;
  name: string;
  percent: number;
  enabled: boolean;
};

export type CanaryRolloutStepRegion = CanaryTrafficRegion & {
  targetPercent: number;
};

export type CanaryRolloutPolicy = {
  enabled: boolean;
  steps: number[];
  regions?: CanaryTrafficRegion[];
  autoPromote: boolean;
  analysisWindowSeconds: number;
  minSuccessRate: number;
  maxErrorRate: number;
  maxP95LatencyMs: number;
  rollbackOnFailure: boolean;
};

export type StaticSiteRolloutPolicy = {
  enabled: boolean;
  cohorts: string[];
  entryPath: string;
  cdnProvider: "aliyun-oss" | "cdn" | "custom";
  cacheTtlSeconds: number;
  rollbackOnFailure: boolean;
};

export type ServerPackageRolloutPolicy = {
  enabled: boolean;
  batches: number[];
  healthCheckPath: string;
  instanceSelector: string;
  maxUnavailable: number;
  rollbackOnFailure: boolean;
};

export type KubernetesRolloutPolicy = {
  enabled: boolean;
  controller: "deployment" | "ingress" | "service-mesh" | "argo-rollouts";
  workloadName: string;
  serviceName?: string;
  ingressName?: string;
  steps: number[];
  analysisWindowSeconds: number;
  rollbackOnFailure: boolean;
};

export type HelmRolloutPolicy = {
  enabled: boolean;
  releaseName: string;
  chart: string;
  namespace?: string;
  valuesPath?: string;
  steps: number[];
  rollbackOnFailure: boolean;
};

export type RolloutStrategyConfig =
  | { packageMode: "container_image"; policy: CanaryRolloutPolicy }
  | { packageMode: "static_site"; policy: StaticSiteRolloutPolicy }
  | { packageMode: "server_package"; policy: ServerPackageRolloutPolicy }
  | { packageMode: "kubernetes_manifest"; policy: KubernetesRolloutPolicy }
  | { packageMode: "helm_chart"; policy: HelmRolloutPolicy };

export type CanaryRolloutStep = {
  id: string;
  percent: number;
  status: CanaryStepStatus;
  startedAt?: string;
  finishedAt?: string;
  analysis?: CanaryAnalysisSnapshot;
  message?: string;
  label?: string;
  capability?: RolloutCapability;
  regions?: CanaryRolloutStepRegion[];
};

export type TrafficSnapshot = {
  globalPercent: number;
  regions: CanaryRolloutStepRegion[];
  cohorts?: Array<{ key: string; percent: number }>;
  rules?: Array<{ type: "header" | "cookie" | "user" | "ip" | "region"; expression: string }>;
  appliedBy: string;
  appliedAt: string;
};

export type DeploymentTarget = {
  id: string;
  name: string;
  environment: EnvironmentType;
  packageModes: PackageMode[];
  adapter: DeploymentTargetAdapter;
  namespace?: string;
  serviceConnectionId?: string;
  trafficConnectionId?: string;
  workloadName?: string;
  deploymentName?: string;
  serviceName?: string;
  ingressName?: string;
  containerName?: string;
  healthCheckUrl?: string;
  healthCheckTimeoutMs?: number;
  createdAt: string;
  updatedAt: string;
};

export type ReleasePlan = {
  id: string;
  artifactId: string;
  runId: string;
  pipelineId: string;
  pipelineName: string;
  applicationId: string;
  applicationName: string;
  environment: EnvironmentType;
  packageMode: PackageMode;
  strategy: PipelineDefinition["strategy"];
  targetId: string;
  target: ReleaseTarget;
  policy: CanaryRolloutPolicy;
  rolloutStrategy?: RolloutStrategyConfig;
  createdBy: string;
  status: ReleasePlanStatus;
  createdAt: string;
  updatedAt: string;
};

export type ReleaseStepExecution = {
  id: string;
  stepId: string;
  percent: number;
  status: CanaryStepStatus;
  traffic?: TrafficSnapshot;
  analysis?: CanaryAnalysisSnapshot;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
};

export type ReleaseExecution = {
  id: string;
  planId: string;
  releaseId: string;
  artifactId: string;
  runId: string;
  applicationId: string;
  environment: EnvironmentType;
  status: ReleaseExecutionStatus;
  stableRevision?: string;
  candidateRevision: string;
  currentTraffic?: TrafficSnapshot;
  steps: ReleaseStepExecution[];
  lockId?: string;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
  logs: string[];
};

export type EnvironmentLock = {
  id: string;
  environment: EnvironmentType;
  applicationId: string;
  releaseId?: string;
  releasePlanId?: string;
  releaseExecutionId?: string;
  reason: string;
  status: EnvironmentLockStatus;
  acquiredBy: string;
  acquiredAt: string;
  releasedAt?: string;
  expiresAt?: string;
};

export type ReleaseEvent = {
  id: string;
  releaseId: string;
  releasePlanId?: string;
  releaseExecutionId?: string;
  artifactId?: string;
  runId?: string;
  applicationId: string;
  environment: EnvironmentType;
  type: ReleaseEventType;
  message: string;
  actor: string;
  sequence: number;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type ReleaseCanaryActionRequest = {
  actor?: string;
  reason?: string;
  targetPercent?: number;
  analysis?: Partial<CanaryAnalysisSnapshot>;
};

export type DeployArtifactRequest = {
  environment?: EnvironmentType;
  actor?: string;
  strategy?: PipelineDefinition["strategy"];
  canaryPercent?: number;
  packageMode?: PackageMode;
  rolloutPolicy?: Partial<CanaryRolloutPolicy>;
  rolloutStrategy?: RolloutStrategyConfig;
  deploymentTargetId?: string;
  releasePlanId?: string;
  namespace?: string;
  serviceConnection?: string;
  target?: ReleaseTarget;
  hostPort?: number;
  containerPort?: number;
  containerName?: string;
};

export type ReleaseDeployment = {
  id: string;
  artifactId: string;
  runId: string;
  pipelineId: string;
  pipelineName: string;
  applicationId: string;
  applicationName: string;
  deploymentTargetId?: string;
  releasePlanId?: string;
  releaseExecutionId?: string;
  environment: EnvironmentType;
  namespace: string;
  target: ReleaseTarget;
  packageMode?: PackageMode;
  imageRef: string;
  imageDigest: string;
  version: string;
  strategy: PipelineDefinition["strategy"];
  canaryPercent: number;
  status: ReleaseStatus;
  actor: string;
  serviceConnection: string;
  containerName?: string;
  endpoint?: string;
  rolloutPolicy?: CanaryRolloutPolicy;
  rolloutStrategy?: RolloutStrategyConfig;
  rolloutSteps?: CanaryRolloutStep[];
  currentTrafficPercent?: number;
  currentRegionTraffic?: CanaryRolloutStepRegion[];
  stableImageRef?: string;
  rollbackImageRef?: string;
  rollbackReleaseId?: string;
  logs: string[];
  createdAt: string;
  updatedAt: string;
  deployedAt?: string;
  completedAt?: string;
};

