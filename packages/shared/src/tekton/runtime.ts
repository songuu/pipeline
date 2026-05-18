import type { RunHandle, StartRunInput } from "../executor";
import type { EnvironmentType } from "../platform";
import type { GlobalParam, JobStatus, StepInstance } from "../yunxiao";
import type { TektonPipelineBinding, TektonResultRecord, TektonWorkspaceBinding } from ".";

// ----------------------------------------------------------------------------
// 6. Kubernetes / Tekton 深度接入契约
// ----------------------------------------------------------------------------

export type KubernetesAuthType = "in-cluster" | "kubeconfig" | "service-account-token" | "cloud-provider";
export type KubernetesConnectionStatus = "unknown" | "ready" | "failed";
export type TektonPipelineMode = "inline" | "cluster-pipeline" | "git-resolver" | "bundle-resolver";
export type TektonBuildStrategy = "dind" | "kaniko" | "buildkit" | "buildpacks";
export type PreflightCheckStatus = "passed" | "warning" | "failed";

export type KubernetesConnection = {
  id: string;
  name: string;
  clusterName: string;
  apiServer: string;
  authType: KubernetesAuthType;
  secretRef: string;
  defaultNamespace: string;
  allowedNamespaces: string[];
  status: KubernetesConnectionStatus;
  lastCheckedAt?: string;
};

export type KubernetesNamespaceBinding = {
  connectionId: string;
  namespace: string;
  serviceAccountName: string;
  environment: EnvironmentType;
  sourcePvc?: string;
  cachePvc?: string;
  dockerConfigSecret?: string;
  kubeconfigSecret?: string;
};

export type TektonRuntimeProfile = {
  id: string;
  connectionId: string;
  namespace: string;
  serviceAccountName: string;
  pipelineMode: TektonPipelineMode;
  pipelineRef?: string;
  resolverParams?: GlobalParam[];
  sourceWorkspace: TektonWorkspaceBinding;
  cacheWorkspace?: TektonWorkspaceBinding;
  dockerConfigSecret?: string;
  buildStrategy: TektonBuildStrategy;
  resultsEnabled: boolean;
  chainsEnabled: boolean;
  triggersEnabled: boolean;
};

export type KubernetesObjectEvent = {
  type: "Normal" | "Warning";
  reason: string;
  message: string;
  timestamp: string;
  involvedObject: {
    apiVersion?: string;
    kind: string;
    namespace?: string;
    name: string;
    uid?: string;
  };
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

export type TektonChainsAttestation = {
  name: string;
  format: TektonPipelineBinding["chains"]["format"];
  storage: string;
  signed: boolean;
  digest: string;
};

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

export type TektonTaskRunDetail = {
  runId: string;
  namespace: string;
  taskRunName: string;
  pipelineTaskName: string;
  podName?: string;
  status: JobStatus;
  startedAt?: string;
  finishedAt?: string;
  steps: StepInstance[];
  results: Record<string, string>;
  events: KubernetesObjectEvent[];
};

export type TektonTaskRunLogs = {
  runId: string;
  namespace: string;
  taskRunName: string;
  podName?: string;
  stepName?: string;
  container?: string;
  source: "kubernetes-pod-log" | "simulated";
  lines: string[];
  truncated: boolean;
};

export type TektonBridgeIssue = {
  severity: PreflightCheckStatus;
  code: string;
  message: string;
  remediation?: string;
};

export type KubernetesCapabilities = {
  reachable: boolean;
  namespace: string;
  serverVersion?: string;
  error?: string;
};

export type TektonCapabilities = {
  pipelinesInstalled: boolean;
  triggersInstalled: boolean;
  resultsInstalled: boolean;
  chainsInstalled: boolean;
  resources: string[];
};

export type TektonRuntimeCapabilities = {
  sourcePvcConfigured: boolean;
  dockerSecretConfigured: boolean;
  serviceAccountName: string;
  buildStrategy: TektonBuildStrategy | "simulated" | string;
  privilegedSidecarRequired: boolean;
  clusterPipelineRef?: string;
  inlinePipelineSpecFallback: boolean;
};

export type TektonBridgeCapabilities = {
  backend: RunHandle["backend"];
  status: "unknown" | "ready" | "degraded" | "failed" | "disconnected";
  kubernetes: KubernetesCapabilities;
  tekton: TektonCapabilities;
  runtime: TektonRuntimeCapabilities;
  issues: TektonBridgeIssue[];
};

export type TektonPreflightRequest = {
  namespace?: string;
  serviceAccountName?: string;
  sourcePvc?: string;
  dockerSecret?: string;
  buildStrategy?: TektonBuildStrategy | string;
  run?: StartRunInput;
};

export type TektonPreflightCheck = {
  code: string;
  status: PreflightCheckStatus;
  message: string;
  remediation?: string;
};

export type TektonPreflightReport = {
  ok: boolean;
  backend: RunHandle["backend"];
  namespace: string;
  checks: TektonPreflightCheck[];
  capabilities: TektonBridgeCapabilities;
};
