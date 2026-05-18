import type { RunHandle, StartRunInput } from "../executor";
import type { EnvironmentType, LifecycleStageKey } from "../platform";
import type { GlobalParam, JobStatus, StepInstance } from "../yunxiao";

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
  executorBackend?: RunHandle["backend"];
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
    pipelineRefConfigured?: boolean;
    sourcePvcConfigured?: boolean;
    dockerSecretFallbackConfigured?: boolean;
    localRegistryPasswordConfigured?: boolean;
    simulatedFallbackEnabled?: boolean;
  };
  components: TektonComponent[];
  bindings: TektonPipelineBinding[];
  runRecords: TektonRunRecord[];
};

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

export * from "./runtime";
