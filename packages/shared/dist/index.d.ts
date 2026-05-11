export type LifecycleStageKey = "source" | "test" | "build" | "env" | "package" | "upload" | "deploy" | "canary" | "approval" | "promote";
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
export type TektonComponentName = "Pipelines" | "Triggers" | "Results" | "Chains" | "Dashboard" | "Operator" | "Hub";
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
export type UpdatePipelineRequest = Partial<Pick<CreatePipelineRequest, "name" | "repositoryId" | "refType" | "refName" | "sourcePolicy" | "targetEnvironment" | "strategy" | "canaryPercent" | "requiresApproval" | "stages" | "triggers" | "owner" | "variables" | "runtimeVariables" | "caches" | "serviceConnections">>;
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
export declare const LIFECYCLE_STAGES: LifecycleStageSpec[];
export declare const getLifecycleStage: (key: LifecycleStageKey) => LifecycleStageSpec;
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
export interface StartPipelineRunParams {
    branchModeBranchs?: string[];
    envs?: Record<string, string>;
    runningBranchs?: Record<string, string>;
    runningTags?: Record<string, string>;
    comment?: string;
}
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
    env?: Array<{
        name: string;
        value: string;
    }>;
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
    params?: Array<{
        name: string;
        value: string;
    }>;
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
export declare const toYunxiaoJobStatus: (status: StageStatus) => JobStatus;
export declare const toYunxiaoRunStatus: (status: PipelineRunStatus) => JobStatus;
export declare const toPipelineRunInstance: (run: PipelineRun) => PipelineRunInstance;
//# sourceMappingURL=index.d.ts.map