import { Inject, Injectable } from "@nestjs/common";
import {
  LIFECYCLE_STAGES,
  toYunxiaoJobStatus,
  toYunxiaoRunStatus,
  type GlobalParam,
  type JobStatus,
  type LifecycleStageKey,
  type PipelineDefinition,
  type PipelineRun,
  type PlatformOverview,
  type PlatformSnapshot,
  type StepInstance,
  type TektonControlPlaneSnapshot,
  type TektonPipelineBinding,
  type TektonResultRecord,
  type TektonRunRecord,
  type TektonRunEvent,
  type TektonTaskGraphNode,
  type TektonWorkspaceBinding,
} from "@deploy-management/shared";
import { ApplicationsService } from "../applications/applications.service";
import { ApprovalsService } from "../approvals/approvals.service";
import { ArtifactsService } from "../artifacts/artifacts.service";
import { AuditService } from "../audit/audit.service";
import { CodeReposService } from "../code-repos/code-repos.service";
import { EnvironmentsService } from "../environments/environments.service";
import { PipelinesService } from "../pipelines/pipelines.service";
import { RunnersService } from "../runners/runners.service";
import { RunsService } from "../runs/runs.service";

@Injectable()
export class SnapshotService {
  constructor(
    @Inject(ApplicationsService) private readonly applications: ApplicationsService,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
    @Inject(ArtifactsService) private readonly artifacts: ArtifactsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CodeReposService) private readonly codeRepos: CodeReposService,
    @Inject(EnvironmentsService) private readonly environments: EnvironmentsService,
    @Inject(PipelinesService) private readonly pipelines: PipelinesService,
    @Inject(RunnersService) private readonly runners: RunnersService,
    @Inject(RunsService) private readonly runs: RunsService,
  ) {}

  build(): PlatformSnapshot {
    const runs = this.runs.list();
    const successRuns = runs.filter((run) => run.status === "success").length;
    const finishedRuns = runs.filter((run) =>
      ["success", "failed", "canceled"].includes(run.status),
    ).length || 1;

    const overview: PlatformOverview = {
      applications: this.applications.list().length,
      pipelines: this.pipelines.list().length,
      runningRuns: runs.filter((run) => run.status === "running").length,
      waitingApprovals: this.approvals.list().filter((approval) => approval.status === "pending").length,
      successRate: Math.round((successRuns / finishedRuns) * 1000) / 10,
      activeEnvironments: this.environments.list().filter((environment) => environment.activeRuns > 0).length,
    };

    return {
      overview,
      applications: this.applications.list(),
      repositories: this.codeRepos.list(),
      pipelines: this.pipelines.list(),
      runs,
      approvals: this.approvals.list(),
      environments: this.environments.list(),
      runnerPools: this.runners.list(),
      artifacts: this.artifacts.list(),
      auditEvents: this.audit.list(),
      tekton: buildTektonSnapshot(runs, this.pipelines.list()),
    };
  }
}

const componentDescriptions: Record<TektonControlPlaneSnapshot["components"][number]["name"], string> = {
  Pipelines: "Task、TaskRun、Pipeline、PipelineRun 控制器",
  Triggers: "EventListener、TriggerBinding、TriggerTemplate 事件入口",
  Results: "PipelineRun/TaskRun 长期历史、日志与 Record 查询",
  Chains: "SLSA provenance、in-toto attestations 与镜像签名",
  Dashboard: "Tekton 原生观测面，用于排障与 CRD 详情",
  Operator: "TektonConfig 统一安装、升级和组件治理",
  Hub: "可复用 Task/Pipeline Catalog 与远程解析",
};

function buildTektonSnapshot(
  runs: PipelineRun[],
  pipelines: PipelineDefinition[],
): TektonControlPlaneSnapshot {
  const bindings = pipelines.map((pipeline) => buildTektonBinding(pipeline));
  return {
    operator: {
      tektonConfigName: "tekton-config-yunxiao",
      status: "ready",
      profile: "all",
      targetNamespace: "tekton-pipelines",
    },
    cluster: {
      context: "ack-prod-shanghai / tekton-system",
      executorMode: process.env.EXECUTOR === "tekton" ? "tekton" : "simulated",
      namespaces: ["tekton-pipelines", "tekton-triggers", "tekton-results", "tekton-chains"],
    },
    components: [
      component("Operator", "tekton-operator", "v0.77.0", 1, 1),
      component("Pipelines", "tekton-pipelines", "v1.3.0", 2, 2),
      component("Triggers", "tekton-triggers", "v0.33.0", 2, 2),
      component("Results", "tekton-results", "v0.15.0", 2, 2),
      component("Chains", "tekton-chains", "v0.24.0", 1, 1),
      component("Dashboard", "tekton-pipelines", "v0.57.0", 1, 1),
      component("Hub", "tekton-hub", "v1.20.0", 1, 1),
    ],
    bindings,
    runRecords: runs.map((run) => buildTektonRunRecord(run, bindings)),
  };
}

function component(
  name: TektonControlPlaneSnapshot["components"][number]["name"],
  namespace: string,
  version: string,
  readyReplicas: number,
  desiredReplicas: number,
): TektonControlPlaneSnapshot["components"][number] {
  return {
    name,
    namespace,
    version,
    readyReplicas,
    desiredReplicas,
    status: readyReplicas >= desiredReplicas ? "ready" : "degraded",
    description: componentDescriptions[name],
  };
}

function buildTektonBinding(pipeline: PipelineDefinition): TektonPipelineBinding {
  const namespace = pipeline.targetEnvironment === "prod" ? "apps-prod" : `apps-${pipeline.targetEnvironment}`;
  const pipelineName = sanitizeKubernetesName(pipeline.name);
  const resolver = pipeline.triggers.includes("yaml") ? "git" : "cluster";
  const sourcePolicy = pipeline.sourcePolicy ?? {
    allowedBranchPatterns: [pipeline.defaultBranch],
    allowedTagPatterns: ["v*", "release-*"],
    allowRuntimeBranch: true,
    allowRuntimeTag: true,
    allowRuntimeCommit: true,
  };
  const params: GlobalParam[] = [
    { key: "git-url", value: pipeline.repository },
    { key: "revision", value: pipeline.defaultRef },
    { key: "ref-type", value: pipeline.defaultRefType },
    { key: "branch-allowlist", value: sourcePolicy.allowedBranchPatterns.join(",") },
    { key: "tag-allowlist", value: sourcePolicy.allowedTagPatterns.join(",") },
    { key: "target-env", value: pipeline.targetEnvironment },
    { key: "canary-percent", value: String(pipeline.canaryPercent) },
    ...(pipeline.variables ?? []),
    ...(pipeline.runtimeVariables ?? []).map((param) => ({ ...param, key: `runtime.${param.key}` })),
  ];
  const workspaceBindings = buildWorkspaceBindings(pipeline, pipelineName);

  return {
    pipelineId: pipeline.id,
    namespace,
    pipelineName,
    serviceAccountName: pipeline.targetEnvironment === "prod" ? "tekton-deployer-prod" : "tekton-builder",
    resolver,
    resolverRef: buildResolverRef(pipeline, pipelineName, resolver),
    workspaces: workspaceBindings.map((workspace) => workspace.name),
    workspaceBindings,
    params,
    taskGraph: buildTaskGraph(pipeline, params, workspaceBindings),
    trigger: {
      eventListener: `${pipelineName}-el`,
      trigger: `${pipelineName}-trigger`,
      triggerBinding: `${pipelineName}-binding`,
      triggerTemplate: `${pipelineName}-template`,
      route: `https://devops.example.com/hooks/${pipeline.id}`,
      interceptors: ["github/gitlab signature", "cel branch filter", "dedupe revision"],
    },
    results: {
      resultName: `${pipelineName}-result`,
      records: pipeline.targetEnvironment === "prod" ? 128 : 54,
      retentionDays: pipeline.targetEnvironment === "prod" ? 180 : 45,
    },
    chains: {
      format: "slsa/v1",
      storage: ["tekton", "oci"],
      signedArtifacts: pipeline.requiresApproval ? 6 : 3,
    },
  };
}

function buildTektonRunRecord(
  run: PipelineRun,
  bindings: TektonPipelineBinding[],
): TektonRunRecord {
  const binding = bindings.find((item) => item.pipelineId === run.pipelineId);
  const namespace = binding?.namespace ?? `apps-${run.environment}`;
  const pipelineRunName = `${sanitizeKubernetesName(run.pipelineName)}-${run.id.replace("run-", "")}`;
  const status = toYunxiaoRunStatus(run.status);
  const condition = conditionForStatus(status);
  const workspaceBindings = binding?.workspaceBindings ?? buildWorkspaceBindings(run.definitionSnapshot, sanitizeKubernetesName(run.pipelineName));
  const params = buildRunParams(run, binding);
  const taskRuns = run.stages.map((stage): TektonRunRecord["taskRuns"][number] => ({
    taskRunName: `${pipelineRunName}-${stage.key}`,
    pipelineTaskName: stage.key,
    taskRef: String(stage.metadata.adapter ?? stage.key),
    status: toYunxiaoJobStatus(stage.status),
    podName: `${pipelineRunName}-${stage.key}-pod`,
    retries: stage.status === "failed" ? 1 : 0,
    workspaces: stageWorkspaces[stage.key] ?? ["source-ws"],
    steps: buildStepsForStage(stage.key, stage.logs, toYunxiaoJobStatus(stage.status)),
    results: buildTaskRunResults(stage.key, run, toYunxiaoJobStatus(stage.status)),
    startedAt: stage.startedAt,
    finishedAt: stage.finishedAt,
  }));
  const events = buildRunEvents(run, pipelineRunName, condition);
  const results = buildRunResults(run, pipelineRunName, taskRuns, events);

  return {
    runId: run.id,
    namespace,
    pipelineRunName,
    status,
    conditionReason: condition.reason,
    conditionMessage: condition.message,
    childReferences: taskRuns.map((taskRun) => ({
      name: taskRun.taskRunName,
      kind: "TaskRun",
      pipelineTaskName: taskRun.pipelineTaskName,
    })),
    taskRuns,
    params,
    workspaceBindings,
    results,
    events,
    pipelineSpecRef: binding?.resolverRef,
    resultRecordName: `${pipelineRunName}-record`,
    logsUrl: `tekton-results://${namespace}/${pipelineRunName}`,
    chainsAttestation:
      run.status === "failed"
        ? undefined
        : {
            name: `${pipelineRunName}.intoto.jsonl`,
            format: "slsa/v1",
            storage: "oci://registry.internal/provenance",
            signed: run.status === "success",
            digest: `sha256:${run.commit}${run.id.replace("run-", "")}`,
          },
  };
}

function buildResolverRef(
  pipeline: PipelineDefinition,
  pipelineName: string,
  resolver: TektonPipelineBinding["resolver"],
): TektonPipelineBinding["resolverRef"] {
  if (resolver === "git") {
    return {
      resolver,
      resourceKind: "Pipeline",
      name: pipelineName,
      source: pipeline.repository,
      revision: pipeline.defaultRef,
      params: [
        { key: "url", value: pipeline.repository },
        { key: "revision", value: pipeline.defaultRef },
        { key: "pathInRepo", value: `.tekton/pipelines/${pipelineName}.yaml` },
      ],
    };
  }

  return {
    resolver,
    resourceKind: "Pipeline",
    name: pipelineName,
    source: "cluster://tekton-pipelines",
    revision: "installed",
    params: [
      { key: "name", value: pipelineName },
      { key: "kind", value: "Pipeline" },
      { key: "namespace", value: pipeline.targetEnvironment === "prod" ? "apps-prod" : `apps-${pipeline.targetEnvironment}` },
    ],
  };
}

function buildWorkspaceBindings(pipeline: PipelineDefinition, pipelineName: string): TektonWorkspaceBinding[] {
  const cacheEnabled = pipeline.caches?.some((cache) => cache.enabled) ?? true;
  return [
    {
      name: "source-ws",
      type: "persistentVolumeClaim",
      mountPath: "/workspace/source",
      claimName: `${pipelineName}-source-pvc`,
      subPath: "$(context.pipelineRun.name)",
      description: "代码、构建上下文和阶段间共享输出。",
    },
    ...(cacheEnabled
      ? [{
          name: "cache-ws",
          type: "persistentVolumeClaim" as const,
          mountPath: "/workspace/cache",
          claimName: `${pipelineName}-cache-pvc`,
          optional: true,
          description: "依赖缓存与构建缓存，可在 PipelineRun 之间复用。",
        }]
      : []),
    {
      name: "docker-config",
      type: "secret",
      mountPath: "/tekton/home/.docker",
      secretName: "acr-push-secret",
      readOnly: true,
      description: "镜像仓库凭据，仅暴露给构建和上传任务。",
    },
    {
      name: "kubeconfig",
      type: "secret",
      mountPath: "/tekton/home/.kube",
      secretName: pipeline.targetEnvironment === "prod" ? "ack-prod-kubeconfig" : "ack-nonprod-kubeconfig",
      readOnly: true,
      description: "部署集群凭据，仅部署/灰度/全量发布任务读取。",
    },
  ];
}

function buildTaskGraph(
  pipeline: PipelineDefinition,
  params: GlobalParam[],
  workspaces: TektonWorkspaceBinding[],
): TektonTaskGraphNode[] {
  return pipeline.stages.map((stage, index) => ({
    name: stage,
    taskRef: `${stage}-task`,
    runAfter: index === 0 ? [] : [pipeline.stages[index - 1]],
    workspaces: (stageWorkspaces[stage] ?? ["source-ws"]).filter((name) => workspaces.some((workspace) => workspace.name === name)),
    params: params.filter((param) => stageParamKeys[stage]?.includes(param.key) ?? ["git-url", "revision", "target-env"].includes(param.key)),
    retries: stage === "upload" || stage === "deploy" ? 1 : 0,
    timeoutSeconds: stageTimeoutSeconds[stage],
    when: stage === "approval"
      ? [{ input: "$(params.target-env)", operator: "in", values: ["prod"] }]
      : undefined,
  }));
}

function buildRunParams(run: PipelineRun, binding?: TektonPipelineBinding): GlobalParam[] {
  return [
    { key: "git-url", value: run.repository },
    { key: "revision", value: run.refName },
    { key: "resolved-commit", value: run.commit },
    { key: "ref-type", value: run.refType },
    { key: "target-env", value: run.environment },
    { key: "canary-percent", value: String(run.canaryPercent) },
    ...(binding?.params.filter((param) => param.key.startsWith("runtime.") || param.key === "IMAGE_TAG" || param.key === "NODE_ENV") ?? []),
  ];
}

function buildTaskRunResults(stage: LifecycleStageKey, run: PipelineRun, status: JobStatus): Record<string, string> {
  if (status === "INIT") return {};
  const image = `registry.internal/${run.applicationName}:${run.id}`;
  const values: Record<LifecycleStageKey, Record<string, string>> = {
    source: {
      commit: run.commit,
      url: run.repository,
      revision: `${run.refType}/${run.refName}`,
    },
    test: {
      report: `tekton-results://${run.id}/junit.xml`,
      qualityGate: status === "SUCCESS" ? "passed" : "blocked",
    },
    build: {
      image,
      buildDigest: `sha256:${run.commit}${run.id.replace("run-", "")}`,
    },
    env: {
      envFile: `/workspace/source/.deploy/${run.environment}.env`,
      configHash: `cfg-${run.commit.slice(0, 7)}`,
    },
    package: {
      sbom: `${run.id}-sbom.spdx.json`,
      provenanceMaterial: `${run.id}-materials.json`,
    },
    upload: {
      imageUrl: image,
      registryDigest: `sha256:${run.commit}${run.canaryPercent}`,
    },
    deploy: {
      release: `${run.applicationName}-${run.environment}`,
      namespace: `${run.applicationName}-${run.environment}`,
    },
    canary: {
      trafficPercent: `${run.canaryPercent}%`,
      slo: "latency-p95<300ms,error-rate<1%",
    },
    approval: {
      gate: run.status === "waiting_approval" ? "pending" : status.toLowerCase(),
      approvers: "owner,sre",
    },
    promote: {
      trafficPercent: status === "SUCCESS" ? "100%" : "0%",
      releaseStatus: status === "SUCCESS" ? "stable" : "pending",
    },
  };
  return values[stage];
}

function buildRunResults(
  run: PipelineRun,
  pipelineRunName: string,
  taskRuns: TektonRunRecord["taskRuns"],
  events: TektonRunEvent[],
): TektonResultRecord[] {
  const storedAt = run.updatedAt;
  const successfulTaskRuns = taskRuns.filter((taskRun) => taskRun.status === "SUCCESS").length;
  return [
    {
      name: `${pipelineRunName}-pipelinerun`,
      recordType: "PipelineRun",
      value: run.status,
      storedAt,
      summary: `${run.pipelineName} ${run.status} at ${run.progress}%`,
    },
    {
      name: `${pipelineRunName}-source-event`,
      recordType: "SourceEvent",
      value: `${run.refType}/${run.refName}@${run.commit}`,
      storedAt,
      summary: "触发事件、代码 revision 与解析结果被归档。",
    },
    {
      name: `${pipelineRunName}-taskruns`,
      recordType: "TaskRun",
      value: `${successfulTaskRuns}/${taskRuns.length}`,
      storedAt,
      summary: "TaskRun 子对象与状态被聚合进同一个 Result。",
    },
    {
      name: `${pipelineRunName}-logs`,
      recordType: "Log",
      value: `tekton-results://${pipelineRunName}`,
      storedAt,
      summary: `${events.length} 条事件与阶段日志可长期查询。`,
    },
    {
      name: `${pipelineRunName}-artifact`,
      recordType: "Artifact",
      value: `registry.internal/${run.applicationName}:${run.id}`,
      storedAt,
      summary: "镜像、SBOM 和 provenance 记录关联到本次运行。",
    },
  ];
}

function buildRunEvents(
  run: PipelineRun,
  pipelineRunName: string,
  condition: { reason: string; message: string },
): TektonRunEvent[] {
  const events: TektonRunEvent[] = [
    {
      type: "Normal",
      reason: "PipelineRunCreated",
      message: `Created PipelineRun ${pipelineRunName}`,
      timestamp: run.createdAt,
      involvedObject: pipelineRunName,
    },
  ];

  run.stages.forEach((stage) => {
    if (!stage.startedAt) return;
    const objectName = `${pipelineRunName}-${stage.key}`;
    events.push({
      type: stage.status === "failed" ? "Warning" : "Normal",
      reason: stage.status === "running" ? "Started" : stage.status === "waiting" ? "Waiting" : toYunxiaoJobStatus(stage.status),
      message: `${stage.title} ${stage.status}`,
      timestamp: stage.finishedAt ?? stage.startedAt,
      involvedObject: objectName,
    });
  });

  events.push({
    type: run.status === "failed" ? "Warning" : "Normal",
    reason: condition.reason,
    message: condition.message,
    timestamp: run.updatedAt,
    involvedObject: pipelineRunName,
  });

  return events.slice(-8);
}

function buildStepsForStage(stageKey: string, logs: string[], status: JobStatus): StepInstance[] {
  const stepNames = stageStepNames[stageKey] ?? ["run"];
  return stepNames.map((name, index) => ({
    id: `${stageKey}-step-${index}`,
    name,
    image: stageImages[stageKey] ?? "build-steps/alinux3",
    status,
    command: ["/bin/sh", "-c"],
    logsRef: logs[index] ? `line:${index}` : undefined,
  }));
}

function conditionForStatus(status: JobStatus): { reason: string; message: string } {
  if (status === "SUCCESS") return { reason: "Succeeded", message: "Tasks Completed: all tasks succeeded" };
  if (status === "FAIL") return { reason: "Failed", message: "Tasks Completed: failed task blocks downstream tasks" };
  if (status === "CANCELED") return { reason: "Cancelled", message: "PipelineRun was cancelled by user" };
  if (status === "QUEUED") return { reason: "Pending", message: "PipelineRun is waiting for approval or runner capacity" };
  return { reason: "Started", message: "PipelineRun has been picked up by the controller" };
}

function sanitizeKubernetesName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52);
}

const stageStepNames: Record<string, string[]> = {
  source: ["resolve-revision", "clone", "checkout"],
  test: ["install", "unit-test", "sast"],
  build: ["compile", "container-build"],
  env: ["merge-vars", "project-secrets", "write-env"],
  package: ["sbom", "provenance-material"],
  upload: ["push-image", "write-digest"],
  deploy: ["render-manifest", "kubectl-apply"],
  canary: ["route-traffic", "observe-slo"],
  approval: ["wait-approval"],
  promote: ["promote-stable", "record-release"],
};

const stageImages: Record<string, string> = {
  source: "alpine/git:2.45",
  test: "node:20-alpine",
  build: "gcr.io/kaniko-project/executor:v1.23.2",
  env: "build-steps/alinux3",
  package: "anchore/syft:v1.4.1",
  upload: "buildpacksio/crane:latest",
  deploy: "bitnami/kubectl:1.30",
  canary: "istio/istioctl:1.22",
  approval: "busybox:1.36",
  promote: "bitnami/kubectl:1.30",
};

const stageWorkspaces: Record<LifecycleStageKey, string[]> = {
  source: ["source-ws"],
  test: ["source-ws", "cache-ws"],
  build: ["source-ws", "cache-ws", "docker-config"],
  env: ["source-ws"],
  package: ["source-ws"],
  upload: ["source-ws", "docker-config"],
  deploy: ["source-ws", "kubeconfig"],
  canary: ["kubeconfig"],
  approval: [],
  promote: ["kubeconfig"],
};

const stageParamKeys: Partial<Record<LifecycleStageKey, string[]>> = {
  source: ["git-url", "revision", "ref-type", "branch-allowlist", "tag-allowlist"],
  env: ["target-env", "NODE_ENV", "runtime.RELEASE_NOTE"],
  deploy: ["target-env", "canary-percent", "DEPLOY_NAMESPACE"],
  canary: ["target-env", "canary-percent"],
};

const stageTimeoutSeconds: Record<LifecycleStageKey, number> = {
  source: 300,
  test: 900,
  build: 1_200,
  env: 180,
  package: 300,
  upload: 600,
  deploy: 900,
  canary: 1_800,
  approval: 86_400,
  promote: 900,
};
