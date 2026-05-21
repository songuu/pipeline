"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, CheckCircle2, Copy, GitBranch, Plus, Rocket, XCircle } from "lucide-react";
import {
  DEFAULT_PIPELINE_BUILD_CONFIG,
  DEFAULT_PACKAGE_UPLOAD_CONFIG,
  PACKAGE_MODES,
  PACKAGE_UPLOAD_PROVIDERS,
  defaultImageArtifactConfig,
  ensureArtifactUploadStage,
  IMAGE_REGISTRY_PRESETS,
  type EnvironmentType,
  type GitReferenceType,
  type GlobalParam,
  type ImageArtifactConfig,
  type ImageRegistryProvider,
  type LifecycleStageKey,
  type PackageMode,
  type PackageBuildCommandMode,
  type PackageUploadConfig,
  type PackageUploadCommandMode,
  type PackageUploadProvider,
  type PipelineBuildConfig,
  type PipelineBuildRuntime,
  type PipelineDefinition,
  type PipelineSourcePolicy,
  type PlatformSnapshot,
  resolveImageArtifact,
  type SourceRepository,
  type SourceRepositoryProvider,
  type UpdatePipelineRequest,
  type VariableInjectionTiming,
  resolveStageRunAfter,
  resolvePackageBuildCommandMode,
  resolvePackageUploadCommandMode,
  validatePipelineGraph,
  type DagViolation,
} from "@deploy-management/shared";
import { fetchRepositoryRefs, resolveRepository } from "../../lib/actions";
import { Field, Switch, VariableTable, WebhookField } from "../components/primitives";
import type { PipelineConfigTab } from "../data/templates";
import { environmentOptions } from "../data/templates";
import { BasicPanel } from "./basic-panel";
import { PipelineConfigFlowCanvas } from "./pipeline-config-flow-canvas";
import {
  STAGE_LABELS,
  TASK_DEFINITIONS,
  VARIABLE_TIMING_LABELS,
  VARIABLE_TIMING_OPTIONS,
  buildConfigFromPipeline,
  buildSourcePolicy,
  defaultInjectionTimingForKey,
  defaultTargetStagesForVariable,
  defaultTagPatterns,
  imageArtifactFromPipeline,
  normalizeOutputPathText,
  normalizePipelineVariables,
  normalizeRegistryHost,
  normalizeRepositoryUrl,
  normalizeVariable,
  packageModeHelp,
  packageModeLabel,
  packageUploadFromPipeline,
  parseOutputPathText,
  providerFrom,
  repositoryIdentityFrom,
  repositoryNameFrom,
  stageLabelForPackageMode,
  splitVariablesByTiming,
  taskDefinitionForPackageMode,
  taskDefinitionsForPackageMode,
  type RunConfig,
  uniqueRefs,
  upsertImageTagVariable,
  variablesForStage,
} from "./model";

const REGISTRY_PROVIDER_OPTIONS = Object.values(IMAGE_REGISTRY_PRESETS);
const REGISTRY_SERVICE_CONNECTION_OPTIONS = REGISTRY_PROVIDER_OPTIONS.map((preset) => ({
  value: preset.defaults.serviceConnection,
  label: preset.label,
}));
const PACKAGE_UPLOAD_PROVIDER_LABELS: Record<PackageUploadProvider, string> = {
  "local-filesystem": "本地发布目录",
  oss: "OSS / 对象存储",
  "static-server": "自建静态服务器",
  custom: "自定义上传",
};
const RUNTIME_VARIABLE_TARGET_STAGES: LifecycleStageKey[] = ["deploy", "canary", "approval", "promote"];

export type { RunConfig } from "./model";

function runtimeRowsFromPipeline(pipeline: PipelineDefinition): string[][] {
  const rows = pipeline.runtimeVariables?.length
    ? pipeline.runtimeVariables
    : [
        {
          key: "RELEASE_NOTE",
          value: "manual run",
          description: "运行时发布说明",
        },
      ];
  return rows.map((variable) => [
    variable.key,
    variable.value,
    variable.description ?? (variable.key === "RELEASE_NOTE" ? "运行时发布说明" : "运行时变量"),
    variable.key === "RELEASE_NOTE" ? "manual run / release tag" : "",
  ]);
}

function runtimeVariableValueFromRows(rows: string[][]): string {
  return rows.find((row) => row[0] === "RELEASE_NOTE")?.[1] ?? rows[0]?.[1] ?? "manual run";
}

function runtimeRowsToParams(rows: string[][], releaseNoteValue: string): GlobalParam[] {
  return rows
    .map((row) => ({
      key: row[0]?.trim() ?? "",
      value: row[0] === "RELEASE_NOTE" ? releaseNoteValue : row[1] ?? "",
      description: row[2]?.trim() || undefined,
      injectionTiming: "runtime" as const,
      targetStages: RUNTIME_VARIABLE_TARGET_STAGES,
    }))
    .filter((variable) => variable.key);
}

function variableGroupRowsFromVariables(variables: GlobalParam[]): string[][] {
  return variables.map((variable) => {
    const timing = variable.injectionTiming ?? defaultInjectionTimingForKey(variable.key);
    const timingLabel = VARIABLE_TIMING_OPTIONS.find((option) => option.key === timing)?.label ?? VARIABLE_TIMING_LABELS[timing];
    return [
      variable.key,
      variable.value,
      variable.description ?? "",
      variable.encrypted ? "是" : "否",
      timingLabel,
      "已启用",
    ];
  });
}

function timingFromTableValue(value: string): VariableInjectionTiming {
  const normalized = value.trim();
  return VARIABLE_TIMING_OPTIONS.find((option) => option.key === normalized || option.label === normalized)?.key ?? "runtime";
}

function encryptedFromTableValue(value: string): boolean {
  return ["1", "true", "yes", "y", "是", "私密", "加密"].includes(value.trim().toLowerCase());
}

interface PipelineConfigEditorProps {
  snapshot: PlatformSnapshot;
  pipeline: PipelineDefinition;
  runConfig: RunConfig;
  setRunConfig: (config: RunConfig) => void;
  activeTab: PipelineConfigTab;
  setActiveTab: (tab: PipelineConfigTab) => void;
  onBack: () => void;
  onSavePipeline: (patch: UpdatePipelineRequest) => Promise<PipelineDefinition>;
  onSaveRun: (pipeline?: PipelineDefinition, config?: RunConfig) => void;
  onDeletePipeline: () => Promise<void>;
  onCopy: (value: string, label: string) => void;
  onNotify: (message: string) => void;
}

export function PipelineConfigEditor({
  snapshot,
  pipeline,
  runConfig,
  setRunConfig,
  activeTab,
  setActiveTab,
  onBack,
  onSavePipeline,
  onSaveRun,
  onDeletePipeline,
  onCopy,
  onNotify,
}: PipelineConfigEditorProps) {
  const [basicSide, setBasicSide] = useState("basic");
  const [sourceSide, setSourceSide] = useState("repository");
  const [triggerSide, setTriggerSide] = useState("webhook");
  const [variableSide, setVariableSide] = useState("variables");
  const [pipelineName, setPipelineName] = useState(pipeline.name);
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [concurrencyEnabled, setConcurrencyEnabled] = useState(false);
  const [selectedTask, setSelectedTask] = useState("JavaScript 代码扫描");
  const [flowViewMode, setFlowViewMode] = useState<"canvas" | "board">("canvas");
  const [customEdges, setCustomEdges] = useState<Array<{ from: LifecycleStageKey; to: LifecycleStageKey }>>([]);
  const [savedAt, setSavedAt] = useState("");
  const [enabledStages, setEnabledStages] = useState<LifecycleStageKey[]>(pipeline.stages);
  const [triggers, setTriggers] = useState(pipeline.triggers.join("\n"));
  const [stringVariables, setStringVariables] = useState<GlobalParam[]>(() =>
    normalizePipelineVariables(pipeline.variables, pipeline.targetEnvironment, pipeline.applicationId),
  );
  const [runtimeVariable, setRuntimeVariable] = useState(() => runtimeVariableValueFromRows(runtimeRowsFromPipeline(pipeline)));
  const [repositoryUrl, setRepositoryUrl] = useState(pipeline.repository);
  const [repositoryProvider, setRepositoryProvider] = useState<SourceRepositoryProvider>(() => providerFrom(pipeline.repository));
  const [repositoryAccessToken, setRepositoryAccessToken] = useState("");
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [remoteTags, setRemoteTags] = useState<string[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState("");
  const [cachePath, setCachePath] = useState(pipeline.caches?.[0]?.path ?? "node_modules/.pnpm-store");
  const [buildCluster, setBuildCluster] = useState("vpc");
  const [buildNode, setBuildNode] = useState("linux-amd64");
  const [containerImage, setContainerImage] = useState("build-steps/alinux3");
  const [buildRuntime, setBuildRuntime] = useState<PipelineBuildRuntime>(() => buildConfigFromPipeline(pipeline).runtime ?? "node");
  const [packageMode, setPackageMode] = useState<PackageMode>(() => buildConfigFromPipeline(pipeline).packageMode ?? "container_image");
  const [packageBuildCommandMode, setPackageBuildCommandMode] = useState<PackageBuildCommandMode>(() =>
    resolvePackageBuildCommandMode(buildConfigFromPipeline(pipeline)),
  );
  const [packageBuildScript, setPackageBuildScript] = useState(() => buildConfigFromPipeline(pipeline).packageBuildScript);
  const [packageBuildCommand, setPackageBuildCommand] = useState(() => buildConfigFromPipeline(pipeline).packageBuildCommand ?? "");
  const [packageOutputPaths, setPackageOutputPaths] = useState(() => buildConfigFromPipeline(pipeline).packageOutputPaths.join("\n"));
  const [packageUploadProvider, setPackageUploadProvider] = useState<PackageUploadProvider>(() => packageUploadFromPipeline(pipeline).provider);
  const [packageUploadEndpoint, setPackageUploadEndpoint] = useState(() => packageUploadFromPipeline(pipeline).endpoint);
  const [packageUploadPublicBaseUrl, setPackageUploadPublicBaseUrl] = useState(() => packageUploadFromPipeline(pipeline).publicBaseUrl ?? "");
  const [packageUploadAccessDomain, setPackageUploadAccessDomain] = useState(() => packageUploadFromPipeline(pipeline).accessDomain ?? "");
  const [packageUploadTargetPath, setPackageUploadTargetPath] = useState(() => packageUploadFromPipeline(pipeline).targetPathTemplate);
  const [packageUploadServiceConnection, setPackageUploadServiceConnection] = useState(() => packageUploadFromPipeline(pipeline).serviceConnection);
  const [packageUploadCommandMode, setPackageUploadCommandMode] = useState<PackageUploadCommandMode>(() =>
    resolvePackageUploadCommandMode(packageUploadFromPipeline(pipeline)),
  );
  const [packageUploadCommand, setPackageUploadCommand] = useState(() => packageUploadFromPipeline(pipeline).customUploadCommand ?? "");
  const [privateRegistry, setPrivateRegistry] = useState(true);
  const [serviceConnection, setServiceConnection] = useState(pipeline.serviceConnections?.[1] ?? "aliyun-acr-deploy");
  const [registryProvider, setRegistryProvider] = useState<ImageRegistryProvider>(
    () => imageArtifactFromPipeline(pipeline).registryProvider ?? "aliyun-acr",
  );
  const [registryRegion, setRegistryRegion] = useState(() => imageArtifactFromPipeline(pipeline).region ?? "cn-hangzhou");
  const [registryUrl, setRegistryUrl] = useState(() => imageArtifactFromPipeline(pipeline).registryUrl);
  const [internalRegistryUrl, setInternalRegistryUrl] = useState(() => imageArtifactFromPipeline(pipeline).internalRegistryUrl ?? "");
  const [useInternalRegistry, setUseInternalRegistry] = useState(() => imageArtifactFromPipeline(pipeline).useInternalRegistry ?? false);
  const [registryNamespace, setRegistryNamespace] = useState(() => imageArtifactFromPipeline(pipeline).namespace);
  const [imageName, setImageName] = useState(() => imageArtifactFromPipeline(pipeline).imageName);
  const [imageTagTemplate, setImageTagTemplate] = useState(() => imageArtifactFromPipeline(pipeline).tagTemplate);
  const [registryUsername, setRegistryUsername] = useState(() => imageArtifactFromPipeline(pipeline).registryUsername ?? "");
  const [dockerConfigSecret, setDockerConfigSecret] = useState(() => imageArtifactFromPipeline(pipeline).dockerConfigSecret ?? "");
  const [dockerfilePath, setDockerfilePath] = useState(() => imageArtifactFromPipeline(pipeline).dockerfilePath);
  const [buildContextPath, setBuildContextPath] = useState(() => imageArtifactFromPipeline(pipeline).contextPath);
  const [downloadMode, setDownloadMode] = useState("all");
  const [useLocalEslint, setUseLocalEslint] = useState(false);
  const [timerSchedule, setTimerSchedule] = useState("daily");
  const [maxConcurrency, setMaxConcurrency] = useState(1);
  const [tagValue, setTagValue] = useState("nodejs");
  const [groupValue, setGroupValue] = useState("backend");
  const [taskSteps, setTaskSteps] = useState<string[]>([]);
  const [runtimeRows, setRuntimeRows] = useState<string[][]>(() => runtimeRowsFromPipeline(pipeline));
  const [allowedBranchPatterns, setAllowedBranchPatterns] = useState(
    (pipeline.sourcePolicy?.allowedBranchPatterns ?? [pipeline.defaultBranch]).join("\n"),
  );
  const [allowedTagPatterns, setAllowedTagPatterns] = useState((pipeline.sourcePolicy?.allowedTagPatterns ?? ["v*"]).join("\n"));
  const [allowRuntimeBranch, setAllowRuntimeBranch] = useState(pipeline.sourcePolicy?.allowRuntimeBranch ?? true);
  const [allowRuntimeTag, setAllowRuntimeTag] = useState(pipeline.sourcePolicy?.allowRuntimeTag ?? true);
  const [allowRuntimeCommit, setAllowRuntimeCommit] = useState(pipeline.sourcePolicy?.allowRuntimeCommit ?? true);

  const repositoryIdentity = repositoryIdentityFrom(
    repositoryUrl || pipeline.repository,
    runConfig.repositoryId || pipeline.repositoryId || "draft-repository",
    repositoryProvider,
  );
  const selectedStaticRepository = snapshot.repositories.find((item) => item.id === runConfig.repositoryId);
  const usesStaticRepository =
    Boolean(selectedStaticRepository) &&
    normalizeRepositoryUrl(repositoryUrl) === normalizeRepositoryUrl(selectedStaticRepository?.url ?? "");
  const draftRefName = runConfig.refName || pipeline.defaultRef || pipeline.defaultBranch || "main";
  const draftRepository: SourceRepository = {
    id: repositoryIdentity.id,
    name: repositoryIdentity.name,
    provider: repositoryProvider,
    url: repositoryUrl || pipeline.repository,
    defaultBranch: runConfig.refType === "branch" ? draftRefName : pipeline.defaultBranch || "main",
    branches: uniqueRefs([runConfig.refType === "branch" ? draftRefName : undefined, pipeline.defaultBranch || "main"]),
    tags: uniqueRefs([runConfig.refType === "tag" ? draftRefName : undefined]),
    recentCommits: [],
    owner: repositoryIdentity.owner || pipeline.owner || "未配置",
  };
  const hasRealRepositories = snapshot.repositories.length > 0;
  const repository = usesStaticRepository ? selectedStaticRepository ?? draftRepository : draftRepository;
  const registryPreset = IMAGE_REGISTRY_PRESETS[registryProvider] ?? IMAGE_REGISTRY_PRESETS.custom;
  const recentCommits = repository.recentCommits ?? [];
  const selectedCommit = recentCommits.find((commit) => commit.sha === runConfig.commitSha);
  const refOptions = runConfig.refType === "branch" ? repository.branches : repository.tags;
  const remoteRefOptions = runConfig.refType === "branch" ? remoteBranches : remoteTags;
  const selectableRefOptions = usesStaticRepository
    ? refOptions.length > 0 ? refOptions : [draftRefName]
    : remoteRefOptions.length > 0 ? remoteRefOptions : [draftRefName];
  const displayRepositoryUrl = repositoryUrl || repository.url || "未配置仓库地址";
  const sourcePolicy = buildSourcePolicy(
    allowedBranchPatterns,
    allowedTagPatterns,
    allowRuntimeBranch,
    allowRuntimeTag,
    allowRuntimeCommit,
    repository.defaultBranch,
  );
  const variableGroupRows = useMemo(() => variableGroupRowsFromVariables(stringVariables), [stringVariables]);
  const title = pipeline.name.startsWith("流水线") ? pipeline.name : "流水线 2026-05-08";
  const effectivePackageUploadCommandMode: PackageUploadCommandMode =
    packageUploadProvider === "custom" ? "custom" : packageUploadCommandMode;
  const taskDefinitions = useMemo(() => taskDefinitionsForPackageMode(packageMode), [packageMode]);
  const buildCommandMissing = packageBuildCommandMode === "custom"
    ? !packageBuildCommand.trim()
    : !packageBuildScript.trim();
  const packageUploadCommandMissing =
    effectivePackageUploadCommandMode === "custom" && !packageUploadCommand.trim();
  const incompleteCount = [
    !pipelineName.trim(),
    !runConfig.repositoryId,
    !runConfig.refName,
    sourcePolicy.allowedBranchPatterns.length === 0,
    runConfig.refType === "tag" && sourcePolicy.allowedTagPatterns.length === 0,
    enabledStages.length < 2,
    !buildCluster,
    enabledStages.includes("upload") && packageMode === "container_image" && !serviceConnection,
    enabledStages.includes("upload") && packageMode === "container_image" && !registryUrl.trim(),
    enabledStages.includes("upload") && packageMode === "container_image" && !registryNamespace.trim(),
    enabledStages.includes("upload") && packageMode === "container_image" && !imageName.trim(),
    enabledStages.includes("upload") && packageMode === "container_image" && !imageTagTemplate.trim(),
    enabledStages.includes("upload") && packageMode === "container_image" && privateRegistry && !dockerConfigSecret.trim(),
    enabledStages.includes("upload") && packageMode !== "container_image" && !packageUploadEndpoint.trim(),
    enabledStages.includes("upload") && packageMode !== "container_image" && !packageUploadTargetPath.trim(),
    enabledStages.includes("upload") && packageMode !== "container_image" && !packageUploadServiceConnection.trim(),
    enabledStages.includes("build") && buildCommandMissing,
    enabledStages.includes("build") && parseOutputPathText(packageOutputPaths).length === 0,
    enabledStages.includes("upload") && packageMode !== "container_image" && packageUploadCommandMissing,
    !cachePath.trim(),
    triggers.trim().length === 0,
  ].filter(Boolean).length;
  const tektonBinding = snapshot.tekton.bindings.find((item) => item.pipelineId === pipeline.id);
  const selectedTaskFallbackStage = TASK_DEFINITIONS.find((item) => item.name === selectedTask)?.stage;
  const selectedTaskDefinition =
    taskDefinitions.find((item) => item.name === selectedTask) ??
    (selectedTaskFallbackStage ? taskDefinitions.find((item) => item.stage === selectedTaskFallbackStage) : undefined) ??
    taskDefinitions[1] ??
    TASK_DEFINITIONS[1];
  const taskStageMap = useMemo<Record<string, LifecycleStageKey>>(
    () => Object.fromEntries(taskDefinitions.map((task) => [task.name, task.stage])),
    [taskDefinitions],
  );
  const selectedTaskGraph = tektonBinding?.taskGraph.find((task) => task.name === selectedTaskDefinition.stage);
  const selectedWorkspaceNames = selectedTaskGraph?.workspaces ?? selectedTaskDefinition.workspaces;
  const selectedWorkspaces = (tektonBinding?.workspaceBindings ?? []).filter((workspace) =>
    selectedWorkspaceNames.includes(workspace.name),
  );
  const selectedParams =
    selectedTaskGraph?.params ??
    (tektonBinding?.params ?? []).filter((param) => selectedTaskDefinition.paramKeys.includes(param.key));
  const stageScopedVariables = variablesForStage(stringVariables, selectedTaskDefinition.stage);
  const timingBuckets = splitVariablesByTiming(stringVariables);
  const allTaskSteps = [...selectedTaskDefinition.steps, ...taskSteps];
  const selectedTaskCopyPayload = {
    task: selectedTaskDefinition.name,
    stage: selectedTaskDefinition.stage,
    taskRef: selectedTaskDefinition.taskRef,
    workspaces: selectedWorkspaceNames,
    params: selectedParams.map((param) => ({
      key: param.key,
      value: param.value,
      injectionTiming: param.injectionTiming,
      targetStages: param.targetStages,
    })),
  };

  useEffect(() => {
    if (taskDefinitions.some((task) => task.name === selectedTask)) return;
    const fallbackStage = selectedTaskFallbackStage ?? selectedTaskDefinition.stage;
    const nextTask = taskDefinitions.find((task) => task.stage === fallbackStage) ?? taskDefinitions[1];
    if (nextTask) {
      setSelectedTask(nextTask.name);
    }
  }, [selectedTask, selectedTaskDefinition.stage, selectedTaskFallbackStage, taskDefinitions]);

  const tabs: Array<{ key: PipelineConfigTab; label: string }> = [
    { key: "basic", label: "基本信息" },
    { key: "source", label: "流水线源" },
    { key: "flow", label: "流程配置" },
    { key: "trigger", label: "触发设置" },
    { key: "variables", label: "变量和缓存" },
  ];

  const buildRemoteRequest = (refType: GitReferenceType) => ({
    url: repositoryUrl.trim(),
    provider: repositoryProvider,
    accessToken: repositoryAccessToken.trim() || undefined,
    refType,
  });

  const loadRemoteRefs = async (refType: GitReferenceType, applyDefault = false) => {
    if (!repositoryUrl.trim()) {
      onNotify("请先填写仓库地址");
      return;
    }
    setRemoteLoading(true);
    setRemoteError("");
    try {
      const result = await fetchRepositoryRefs(buildRemoteRequest(refType));
      setRepositoryProvider(result.provider);
      if (refType === "branch") {
        setRemoteBranches(result.refs);
      } else {
        setRemoteTags(result.refs);
      }
      if (applyDefault && result.defaultRef) {
        setRunConfig({
          ...runConfig,
          repositoryId: result.repositoryId,
          refType,
          refName: result.defaultRef,
          commitSha: undefined,
        });
      } else {
        setRunConfig({
          ...runConfig,
          repositoryId: result.repositoryId,
          refType,
          refName: result.refs.includes(runConfig.refName) ? runConfig.refName : result.defaultRef ?? runConfig.refName,
          commitSha: undefined,
        });
      }
      if (result.warnings?.[0]) {
        setRemoteError(result.warnings[0]);
        onNotify(result.warnings[0]);
      } else {
        onNotify(`已从 ${result.provider} 拉取 ${result.refs.length} 个${refType === "branch" ? "分支" : "Tag"}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "远程仓库接口调用失败";
      setRemoteError(message);
      onNotify(message);
    } finally {
      setRemoteLoading(false);
    }
  };

  const resolveRemoteSource = async () => {
    if (!repositoryUrl.trim()) {
      onNotify("请先填写仓库地址");
      return;
    }
    setRemoteLoading(true);
    setRemoteError("");
    try {
      const result = await resolveRepository({
        url: repositoryUrl.trim(),
        provider: repositoryProvider,
        accessToken: repositoryAccessToken.trim() || undefined,
      });
      setRepositoryProvider(result.provider);
      setRemoteBranches(result.branches);
      setRemoteTags(result.tags);
      setRepositoryUrl(result.url);
      setRunConfig({
        ...runConfig,
        repositoryId: result.repositoryId,
        refType: "branch",
        refName: result.defaultBranch,
        commitSha: undefined,
      });
      setAllowedBranchPatterns([result.defaultBranch, "release/*", "hotfix/*"].join("\n"));
      setAllowedTagPatterns(defaultTagPatterns(result.tags, result.name).join("\n"));
      if (result.warnings?.[0]) {
        setRemoteError(result.warnings[0]);
        onNotify(result.warnings[0]);
      } else {
        onNotify(`已解析 ${result.provider}/${result.name}，分支 ${result.branches.length} 个，Tag ${result.tags.length} 个`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "仓库解析失败";
      setRemoteError(message);
      onNotify(message);
    } finally {
      setRemoteLoading(false);
    }
  };

  const updateRunRefType = (refType: GitReferenceType) => {
    const nextRemoteRefs = refType === "branch" ? remoteBranches : remoteTags;
    const nextRefName =
      nextRemoteRefs[0] ??
      (refType === "branch" ? repository.defaultBranch : repository.tags[0] ?? runConfig.refName ?? repository.defaultBranch);
    setRunConfig({
      ...runConfig,
      refType,
      refName: nextRefName,
      commitSha: undefined,
    });
    if (repositoryUrl.trim()) {
      void loadRemoteRefs(refType, true);
    }
  };

  useEffect(() => {
    setPipelineName(pipeline.name);
    setEnabledStages(pipeline.stages);
    setTriggers(pipeline.triggers.join("\n"));
    setStringVariables(normalizePipelineVariables(pipeline.variables, pipeline.targetEnvironment, pipeline.applicationId));
    const nextRuntimeRows = runtimeRowsFromPipeline(pipeline);
    setRuntimeRows(nextRuntimeRows);
    setRuntimeVariable(runtimeVariableValueFromRows(nextRuntimeRows));
    setRepositoryUrl(pipeline.repository);
    setRepositoryProvider(providerFrom(pipeline.repository));
    setRemoteBranches([]);
    setRemoteTags([]);
    setRemoteError("");
    setCachePath(pipeline.caches?.[0]?.path ?? "node_modules/.pnpm-store");
    const nextBuildConfig = buildConfigFromPipeline(pipeline);
    setBuildRuntime(nextBuildConfig.runtime ?? "node");
    setPackageMode(nextBuildConfig.packageMode ?? "container_image");
    setPackageBuildCommandMode(resolvePackageBuildCommandMode(nextBuildConfig));
    setPackageBuildScript(nextBuildConfig.packageBuildScript);
    setPackageBuildCommand(nextBuildConfig.packageBuildCommand ?? "");
    setPackageOutputPaths(nextBuildConfig.packageOutputPaths.join("\n"));
    const nextPackageUpload = packageUploadFromPipeline(pipeline);
    setPackageUploadProvider(nextPackageUpload.provider);
    setPackageUploadEndpoint(nextPackageUpload.endpoint);
    setPackageUploadPublicBaseUrl(nextPackageUpload.publicBaseUrl ?? "");
    setPackageUploadAccessDomain(nextPackageUpload.accessDomain ?? "");
    setPackageUploadTargetPath(nextPackageUpload.targetPathTemplate);
    setPackageUploadServiceConnection(nextPackageUpload.serviceConnection);
    setPackageUploadCommandMode(resolvePackageUploadCommandMode(nextPackageUpload));
    setPackageUploadCommand(nextPackageUpload.customUploadCommand ?? "");
    const nextImageArtifact = imageArtifactFromPipeline(pipeline);
    setServiceConnection(nextImageArtifact.serviceConnection || pipeline.serviceConnections?.[1] || "aliyun-acr-deploy");
    setRegistryProvider(nextImageArtifact.registryProvider ?? "aliyun-acr");
    setRegistryRegion(nextImageArtifact.region ?? "");
    setRegistryUrl(nextImageArtifact.registryUrl);
    setInternalRegistryUrl(nextImageArtifact.internalRegistryUrl ?? "");
    setUseInternalRegistry(nextImageArtifact.useInternalRegistry ?? false);
    setRegistryNamespace(nextImageArtifact.namespace);
    setImageName(nextImageArtifact.imageName);
    setImageTagTemplate(nextImageArtifact.tagTemplate);
    setRegistryUsername(nextImageArtifact.registryUsername ?? "");
    setDockerConfigSecret(nextImageArtifact.dockerConfigSecret ?? "");
    setPrivateRegistry(nextImageArtifact.privateRegistry);
    setDockerfilePath(nextImageArtifact.dockerfilePath);
    setBuildContextPath(nextBuildConfig.contextPath ?? nextImageArtifact.contextPath);
    setAllowedBranchPatterns((pipeline.sourcePolicy?.allowedBranchPatterns ?? [pipeline.defaultBranch]).join("\n"));
    setAllowedTagPatterns((pipeline.sourcePolicy?.allowedTagPatterns ?? ["v*"]).join("\n"));
    setAllowRuntimeBranch(pipeline.sourcePolicy?.allowRuntimeBranch ?? true);
    setAllowRuntimeTag(pipeline.sourcePolicy?.allowRuntimeTag ?? true);
    setAllowRuntimeCommit(pipeline.sourcePolicy?.allowRuntimeCommit ?? true);
  }, [pipeline.id]);

  const toggleStage = (stage: LifecycleStageKey) => {
    if (stage === "source") return;
    const next = enabledStages.includes(stage)
      ? enabledStages.filter((item) => item !== stage)
      : [...enabledStages, stage];
    setEnabledStages(next);
    setRunConfig({ ...runConfig, stages: next });
  };

  const selectRepository = (repositoryId: string) => {
    if (repositoryId === "__remote__") {
      const identity = repositoryIdentityFrom(repositoryUrl, runConfig.repositoryId || "draft-repository", repositoryProvider);
      setRunConfig({
        ...runConfig,
        repositoryId: identity.id,
        commitSha: undefined,
      });
      setRemoteError("");
      return;
    }
    const nextRepository = snapshot.repositories.find((item) => item.id === repositoryId) ?? repository;
    setRepositoryUrl(nextRepository.url);
    setRepositoryProvider(nextRepository.provider);
    setRemoteBranches(nextRepository.branches);
    setRemoteTags(nextRepository.tags);
    setRemoteError("");
    setRunConfig({
      ...runConfig,
      repositoryId: nextRepository.id,
      refType: "branch",
      refName: nextRepository.defaultBranch,
      commitSha: undefined,
    });
    setAllowedBranchPatterns([nextRepository.defaultBranch, "release/*", "hotfix/*"].join("\n"));
    setAllowedTagPatterns(defaultTagPatterns(nextRepository.tags, nextRepository.name).join("\n"));
  };

  const changeRepositoryProvider = (provider: SourceRepositoryProvider) => {
    setRepositoryProvider(provider);
    if (!repositoryUrl.trim()) return;
    const identity = repositoryIdentityFrom(repositoryUrl, runConfig.repositoryId || "draft-repository", provider);
    setRunConfig({ ...runConfig, repositoryId: identity.id, commitSha: undefined });
  };

  const changeRepositoryUrl = (nextUrl: string) => {
    const provider = providerFrom(nextUrl);
    const identity = repositoryIdentityFrom(nextUrl, runConfig.repositoryId || "draft-repository", provider);
    setRepositoryUrl(nextUrl);
    setRepositoryProvider(provider);
    setRemoteBranches([]);
    setRemoteTags([]);
    setRemoteError("");
    setRunConfig({ ...runConfig, repositoryId: identity.id, commitSha: undefined });
  };

  const selectRefName = (refName: string) => {
    setRunConfig({ ...runConfig, refName, commitSha: undefined });
  };

  const selectCommit = (commitSha: string) => {
    setRunConfig({ ...runConfig, commitSha: commitSha || undefined });
  };

  const updateStringVariable = (index: number, patch: Partial<GlobalParam>) => {
    setStringVariables(
      stringVariables.map((item, itemIndex) =>
        itemIndex === index ? normalizeVariable({ ...item, ...patch }, runConfig.environment) : item,
      ),
    );
  };

  const changeVariableTiming = (index: number, injectionTiming: VariableInjectionTiming) => {
    const current = stringVariables[index];
    if (!current) return;
    updateStringVariable(index, {
      injectionTiming,
      targetStages: defaultTargetStagesForVariable(current.key, injectionTiming),
    });
  };

  const updateVariableGroupCell = (rowIndex: number, columnIndex: number, value: string) => {
    if (columnIndex === 4) {
      changeVariableTiming(rowIndex, timingFromTableValue(value));
      return;
    }
    const patch: Partial<GlobalParam> =
      columnIndex === 0
        ? { key: value }
        : columnIndex === 1
          ? { value }
          : columnIndex === 2
            ? { description: value }
            : columnIndex === 3
              ? { encrypted: encryptedFromTableValue(value) }
              : {};
    if (Object.keys(patch).length > 0) {
      updateStringVariable(rowIndex, patch);
    }
  };

  const deleteVariableGroupRow = (rowIndex: number) => {
    setStringVariables(stringVariables.filter((_, index) => index !== rowIndex));
  };

  const applyRuntimeRows = (rows: string[][]) => {
    setRuntimeRows(rows);
    setRuntimeVariable(runtimeVariableValueFromRows(rows));
  };

  const updateRuntimeRowCell = (rowIndex: number, columnIndex: number, value: string) => {
    applyRuntimeRows(
      runtimeRows.map((row, index) =>
        index === rowIndex
          ? [...row.slice(0, columnIndex), value, ...row.slice(columnIndex + 1)]
          : row,
      ),
    );
  };

  const syncReleaseNoteValue = (value: string) => {
    const hasReleaseNote = runtimeRows.some((row) => row[0] === "RELEASE_NOTE");
    const rows = hasReleaseNote
      ? runtimeRows.map((row) => (row[0] === "RELEASE_NOTE" ? [row[0], value, row[2] ?? "运行时发布说明", row[3] ?? "manual run / release tag"] : row))
      : [["RELEASE_NOTE", value, "运行时发布说明", "manual run / release tag"], ...runtimeRows];
    applyRuntimeRows(rows);
  };

  const deleteRuntimeRow = (rowIndex: number) => {
    applyRuntimeRows(runtimeRows.filter((_, index) => index !== rowIndex));
  };

  const updateImageTagTemplate = (value: string) => {
    setImageTagTemplate(value);
    setStringVariables(upsertImageTagVariable(stringVariables, value));
  };

  const applyRegistryProvider = (provider: ImageRegistryProvider) => {
    const preset = IMAGE_REGISTRY_PRESETS[provider].defaults;
    setRegistryProvider(provider);
    setRegistryRegion(preset.region ?? "");
    setRegistryUrl(preset.registryUrl);
    setInternalRegistryUrl(preset.internalRegistryUrl ?? "");
    setUseInternalRegistry(preset.useInternalRegistry ?? false);
    setRegistryNamespace(preset.namespace);
    setImageName(preset.imageName === "application" ? repository.name : preset.imageName);
    setImageTagTemplate(preset.tagTemplate);
    setServiceConnection(preset.serviceConnection);
    setPrivateRegistry(preset.privateRegistry);
    setRegistryUsername(preset.registryUsername ?? "");
    setDockerConfigSecret(preset.dockerConfigSecret ?? "");
    setDockerfilePath(preset.dockerfilePath);
    setBuildContextPath(preset.contextPath);
    setStringVariables(upsertImageTagVariable(stringVariables, preset.tagTemplate));
    onNotify(`已切换镜像托管为 ${IMAGE_REGISTRY_PRESETS[provider].label}`);
  };

  const buildImageArtifactConfig = (): ImageArtifactConfig => ({
    registryProvider,
    region: registryRegion.trim() || undefined,
    registryUrl: registryUrl.trim(),
    internalRegistryUrl: internalRegistryUrl.trim(),
    useInternalRegistry,
    namespace: registryNamespace.trim(),
    imageName: imageName.trim(),
    tagTemplate: imageTagTemplate.trim(),
    serviceConnection: serviceConnection.trim(),
    privateRegistry,
    registryUsername: registryUsername.trim(),
    dockerConfigSecret: dockerConfigSecret.trim(),
    dockerfilePath: dockerfilePath.trim(),
    contextPath: buildContextPath.trim(),
  });

  const buildPipelineBuildConfig = (): PipelineBuildConfig => ({
    packageMode,
    runtime: buildRuntime,
    contextPath: buildContextPath.trim() || DEFAULT_PIPELINE_BUILD_CONFIG.contextPath,
    packageBuildCommandMode,
    packageBuildScript: packageBuildScript.trim() || DEFAULT_PIPELINE_BUILD_CONFIG.packageBuildScript,
    ...(packageBuildCommand.trim() ? { packageBuildCommand: packageBuildCommand.trim() } : {}),
    packageOutputPaths: normalizeOutputPathText(packageOutputPaths),
  });

  const buildPackageUploadConfig = (): PackageUploadConfig => ({
    provider: packageUploadProvider,
    customUploadCommandMode: effectivePackageUploadCommandMode,
    endpoint: packageUploadEndpoint.trim() || DEFAULT_PACKAGE_UPLOAD_CONFIG.endpoint,
    publicBaseUrl: packageUploadPublicBaseUrl.trim(),
    accessDomain: packageUploadAccessDomain.trim() || packageUploadPublicBaseUrl.trim(),
    targetPathTemplate: packageUploadTargetPath.trim() || DEFAULT_PACKAGE_UPLOAD_CONFIG.targetPathTemplate,
    serviceConnection: packageUploadServiceConnection.trim() || DEFAULT_PACKAGE_UPLOAD_CONFIG.serviceConnection,
    ...(packageUploadCommand.trim() ? { customUploadCommand: packageUploadCommand.trim() } : {}),
  });

  const imageArtifactPreview = resolveImageArtifact(
    {
      ...pipeline,
      targetEnvironment: runConfig.environment,
      defaultRef: runConfig.refName,
      imageArtifact: buildImageArtifactConfig(),
    },
    {
      id: "run-1",
      commit: runConfig.commitSha ?? "12d4e58",
      refName: runConfig.refName,
      environment: runConfig.environment,
      applicationId: pipeline.applicationId,
    },
  );
  const activeRegistryHost = normalizeRegistryHost(
    useInternalRegistry && internalRegistryUrl.trim() ? internalRegistryUrl : registryUrl,
  );
  const acrSecretName = dockerConfigSecret.trim() || "aliyun-acr-deploy-secret";
  const acrUsername = registryUsername.trim() || "<ACR 登录用户名>";
  const acrSecretCommand = `kubectl -n <tekton-namespace> create secret docker-registry ${acrSecretName} --docker-server=${activeRegistryHost || "<registry-host>"} --docker-username=${acrUsername} --docker-password=<ACR 登录密码> --dry-run=client -o yaml | kubectl apply -f -`;
  const acrDockerLoginCommand = `docker login --username=${acrUsername} ${activeRegistryHost || "<registry-host>"}`;

  const applyRecommendedVariableTiming = () => {
    setStringVariables(stringVariables.map((item) => normalizeVariable(item, runConfig.environment, true)));
    onNotify("已按构建时、运行时、部署时重新整理变量注入策略");
  };

  const activateStage = (stage: LifecycleStageKey) => {
    const next = enabledStages.includes(stage) ? enabledStages : [...enabledStages, stage];
    setEnabledStages(next);
    setRunConfig({ ...runConfig, stages: next });
  };

  const buildPipelinePatch = (): UpdatePipelineRequest => {
    const imageArtifact = packageMode === "container_image" ? buildImageArtifactConfig() : undefined;
    const packageUpload = packageMode === "container_image" ? undefined : buildPackageUploadConfig();
    const stages = ensureArtifactUploadStage(enabledStages, { packageMode, imageArtifact, packageUpload });
    return {
      name: pipelineName,
      repositoryId: repository.id,
      repositoryUrl: repositoryUrl.trim(),
      refType: runConfig.refType,
      refName: runConfig.refName,
      sourcePolicy,
      targetEnvironment: runConfig.environment,
      strategy: pipeline.strategy,
      canaryPercent: runConfig.canaryPercent,
      requiresApproval: pipeline.requiresApproval,
      stages,
      triggers: [
        ...triggers.split("\n").map((trigger) => trigger.trim()).filter(Boolean),
        ...(timerEnabled ? [`cron ${timerSchedule}`] : []),
        ...(concurrencyEnabled ? [`concurrency ${maxConcurrency}`] : []),
      ],
      owner: pipeline.owner,
      variables: imageArtifact
        ? upsertImageTagVariable(stringVariables, imageArtifact.tagTemplate)
        : stringVariables.filter((item) => item.key !== "IMAGE_TAG"),
      runtimeVariables: runtimeRowsToParams(runtimeRows, runtimeVariable),
      caches: [
        {
          key: `${repository.name}-cache`,
          path: cachePath,
          restoreKeys: [`${repository.name}-`, "node-"],
          enabled: cachePath.trim().length > 0,
        },
      ],
      serviceConnections: imageArtifact
        ? [`${repositoryProvider}-readonly`, serviceConnection, "ack-deploy"]
        : [`${repositoryProvider}-readonly`, packageUpload?.serviceConnection ?? DEFAULT_PACKAGE_UPLOAD_CONFIG.serviceConnection, "ack-deploy"],
      buildConfig: buildPipelineBuildConfig(),
      imageArtifact,
      packageUpload,
    };
  };

  const selectTask = (taskName: string, stage: LifecycleStageKey) => {
    setSelectedTask(taskName);
    activateStage(stage);
    onNotify(`${taskName} 已选中`);
  };

  const selectStageNode = (stage: LifecycleStageKey) => {
    const stageTasks = taskDefinitions.filter((task) => task.stage === stage);
    const currentSelectedTask = taskDefinitions.find((task) => task.name === selectedTask);
    if (currentSelectedTask?.stage === stage) return;
    const target = stageTasks[0];
    if (!target) return;
    selectTask(target.name, target.stage);
  };

  const buildPipelineGraphSnapshot = () => {
    const stageSet = new Set(enabledStages);
    const defaultEdges = enabledStages.flatMap((stage) =>
      resolveStageRunAfter(stage, stageSet).map((from) => ({ from, to: stage })),
    );
    const customDedupe = customEdges.filter(
      (custom) =>
        stageSet.has(custom.from) &&
        stageSet.has(custom.to) &&
        !defaultEdges.some((edge) => edge.from === custom.from && edge.to === custom.to),
    );
    return { stages: enabledStages, edges: [...defaultEdges, ...customDedupe] };
  };

  const reportViolations = (violations: DagViolation[]): boolean => {
    if (violations.length === 0) return true;
    const messages = violations.slice(0, 3).map((v) => v.message);
    const suffix = violations.length > 3 ? ` 等 ${violations.length} 项` : "";
    onNotify(`DAG 校验未通过: ${messages.join(" / ")}${suffix}`);
    return false;
  };

  const handleConnectStages = (payload: { source: LifecycleStageKey; target: LifecycleStageKey }) => {
    if (payload.source === payload.target) {
      onNotify("不能连接到自身");
      return;
    }
    const stageSet = new Set(enabledStages);
    if (!stageSet.has(payload.source) || !stageSet.has(payload.target)) {
      onNotify("请先启用对应阶段再建立依赖");
      return;
    }
    const probe = {
      stages: enabledStages,
      edges: [
        ...enabledStages.flatMap((stage) =>
          resolveStageRunAfter(stage, stageSet).map((from) => ({ from, to: stage })),
        ),
        ...customEdges,
        { from: payload.source, to: payload.target },
      ],
    };
    const result = validatePipelineGraph(probe);
    if (!result.valid) {
      reportViolations(result.violations);
      return;
    }
    if (customEdges.some((e) => e.from === payload.source && e.to === payload.target)) {
      onNotify("该依赖已存在");
      return;
    }
    setCustomEdges([...customEdges, { from: payload.source, to: payload.target }]);
    onNotify(
      `已建立依赖 (预览): ${payload.source} → ${payload.target} · 注意: 当前版本自定义依赖不会随保存持久化`,
    );
  };

  const PRESET_STAGES: Array<{ stage: LifecycleStageKey; label: string }> = [
    { stage: "approval", label: "+ 审批" },
    { stage: "canary", label: "+ 灰度" },
    { stage: "deploy", label: "+ 部署" },
    { stage: "upload", label: "+ 上传" },
  ];

  const addPresetStage = (stage: LifecycleStageKey) => {
    if (enabledStages.includes(stage)) {
      onNotify(`${stage} 阶段已启用`);
      selectStageNode(stage);
      return;
    }
    activateStage(stage);
    selectStageNode(stage);
    onNotify(`已新增 ${stage} 阶段`);
  };

  const removeSelectedTask = () => {
    const stage = taskStageMap[selectedTask] ?? selectedTaskDefinition.stage;
    if (!stage || stage === "source") {
      onNotify("流水线源为必需阶段，不能移除");
      return;
    }
    const next = enabledStages.filter((item) => item !== stage);
    setEnabledStages(next);
    setRunConfig({ ...runConfig, stages: next });
    onNotify(`${selectedTask} 已从流程中移除`);
  };

  const addNewTask = () => {
    const nextStageKey: LifecycleStageKey = enabledStages.includes("approval") ? "promote" : "approval";
    const nextTask = taskDefinitions.find((task) => task.stage === nextStageKey);
    if (nextTask) {
      selectTask(nextTask.name, nextStageKey);
    }
  };

  const addStep = () => {
    setTaskSteps([...taskSteps, `${selectedTaskDefinition.stage}-custom-step-${taskSteps.length + 1}`]);
    onNotify("任务步骤已添加");
  };

  const deletePipeline = async () => {
    if (!window.confirm(`确认删除流水线 ${pipeline.name}？`)) return;
    await onDeletePipeline();
  };

  const saveDraft = async () => {
    const graphResult = validatePipelineGraph(buildPipelineGraphSnapshot());
    if (!graphResult.valid) {
      reportViolations(graphResult.violations);
      throw new Error("pipeline DAG 校验未通过");
    }
    if (customEdges.length > 0) {
      const proceed = window.confirm(
        `检测到 ${customEdges.length} 条自定义依赖。当前版本仅支持 stage 启停的持久化，` +
          `自定义连线不会保存。继续保存 (将丢失自定义连线) ?`,
      );
      if (!proceed) {
        onNotify("已取消保存");
        throw new Error("user canceled save due to customEdges loss");
      }
      onNotify(`保存将丢失 ${customEdges.length} 条自定义连线 (设计中, Sprint C 持久化)`);
    }
    const updated = await onSavePipeline(buildPipelinePatch());
    setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    return updated;
  };

  const saveAndRun = async () => {
    const imageArtifact = packageMode === "container_image" ? buildImageArtifactConfig() : undefined;
    const packageUpload = packageMode === "container_image" ? undefined : buildPackageUploadConfig();
    const stages = ensureArtifactUploadStage(enabledStages, { packageMode, imageArtifact, packageUpload });
    if (!enabledStages.includes("upload") && stages.includes("upload")) {
      setEnabledStages(stages);
      setRunConfig({ ...runConfig, stages });
      onNotify(packageMode === "container_image" ? "已根据镜像仓库配置自动加入上传阶段" : "已根据包上传配置自动加入上传阶段");
    }
    const updated = await saveDraft();
    onSaveRun(updated, {
      ...runConfig,
      stages,
      repositoryAccessToken: repositoryAccessToken.trim() || undefined,
    });
  };

  const taskMissingConfig = (stage: LifecycleStageKey) =>
    ((stage === "test" || stage === "build" || stage === "upload") && !buildCluster) ||
    (stage === "build" && (buildCommandMissing || parseOutputPathText(packageOutputPaths).length === 0)) ||
    (stage === "upload" && packageMode === "container_image" && !serviceConnection) ||
    ((stage === "deploy" || stage === "canary" || stage === "promote") && !serviceConnection) ||
    (stage === "upload" &&
      packageMode === "container_image" &&
      (!registryUrl.trim() || !registryNamespace.trim() || !imageName.trim() || (privateRegistry && !dockerConfigSecret.trim()))) ||
    (stage === "upload" &&
      packageMode !== "container_image" &&
      (!packageUploadEndpoint.trim() || !packageUploadTargetPath.trim() || !packageUploadServiceConnection.trim() || packageUploadCommandMissing)) ||
    (stage === "env" && stringVariables.length === 0);
  const invalidStagesSet = useMemo(
    () => new Set<LifecycleStageKey>(enabledStages.filter((stage) => taskMissingConfig(stage))),
    [
      enabledStages,
      buildCluster,
      packageBuildScript,
      packageOutputPaths,
      serviceConnection,
      registryUrl,
      registryNamespace,
      imageName,
      privateRegistry,
      dockerConfigSecret,
      stringVariables.length,
    ],
  );
  const taskClass = (stage: LifecycleStageKey, taskName: string, invalid = false) =>
    [
      "flow-task-pill",
      selectedTask === taskName ? "selected" : "",
      enabledStages.includes(stage) ? "enabled" : "disabled",
      invalid ? "invalid" : "",
    ]
      .filter(Boolean)
      .join(" ");
  const taskForStage = (stage: LifecycleStageKey) =>
    taskDefinitionForPackageMode(packageMode, stage) ?? TASK_DEFINITIONS.find((task) => task.stage === stage);
  const sourceTask = taskForStage("source");
  const buildTask = taskForStage("build");
  const uploadTask = taskForStage("upload");
  const envTask = taskForStage("env");
  const packageTask = taskForStage("package");
  const deployTask = taskForStage("deploy");
  const canaryTask = taskForStage("canary");
  const testTasks = taskDefinitions.filter((task) => task.stage === "test");

  return (
    <section className="pipeline-config-page">
      <header className="pipeline-config-topbar">
        <button className="back-button" onClick={onBack} aria-label="返回">
          ‹
        </button>
        <h1>{title}</h1>
        <nav className="config-top-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={activeTab === tab.key ? "active" : ""}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="config-save-area">
          <span className={incompleteCount === 0 ? "config-warning ready" : "config-warning"}>
            {incompleteCount === 0 ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            {incompleteCount === 0 ? "配置已完成" : `${incompleteCount} 项任务未配置完`}
          </span>
          {savedAt && <span className="config-saved-at">已保存 {savedAt}</span>}
          <button
            className="cloud-secondary"
            onClick={() => void saveDraft()}
          >
            仅保存
          </button>
          <button className="yunxiao-primary" onClick={() => void saveAndRun()}>
            保存并运行
          </button>
        </div>
      </header>

      {activeTab === "basic" && (
        <BasicPanel
          basicSide={basicSide}
          setBasicSide={setBasicSide}
          pipelineName={pipelineName}
          setPipelineName={setPipelineName}
          pipeline={pipeline}
          runConfig={runConfig}
          setRunConfig={setRunConfig}
          tagValue={tagValue}
          setTagValue={setTagValue}
          groupValue={groupValue}
          setGroupValue={setGroupValue}
          repository={repository}
          setActiveTab={setActiveTab}
          deletePipeline={deletePipeline}
          onCopy={onCopy}
        />
      )}
      {activeTab === "source" && (
        <div className="pipeline-config-layout source-config-layout">
          <aside className="pipeline-config-side">
            <button className={sourceSide === "repository" ? "active" : ""} onClick={() => setSourceSide("repository")}>
              代码源
            </button>
            <button className={sourceSide === "revision" ? "active" : ""} onClick={() => setSourceSide("revision")}>
              默认Revision
            </button>
            <button className={sourceSide === "policy" ? "active" : ""} onClick={() => setSourceSide("policy")}>
              运行约束
            </button>
          </aside>
          <main className="pipeline-config-content source-config-content">
            <div className="source-hero-panel">
              <div>
                <span>Pipeline Source</span>
                <h2>{repository.provider}/{repository.name}</h2>
                <p>{displayRepositoryUrl}</p>
              </div>
              <div className="source-hero-meta">
                <strong>{runConfig.refType}</strong>
                <span>{runConfig.refName}</span>
                <em>{runConfig.commitSha ? `commit ${runConfig.commitSha.slice(0, 12)}` : "运行时可解析最新提交"}</em>
              </div>
            </div>

            {sourceSide === "repository" && (
              <section className="source-config-grid">
                <Field label="仓库类型">
                  <select
                    value={repositoryProvider}
                    onChange={(event) => changeRepositoryProvider(event.target.value as SourceRepositoryProvider)}
                  >
                    <option value="github">GitHub</option>
                    <option value="gitlab">GitLab</option>
                    <option value="gitcode">GitCode</option>
                    <option value="codeup">Codeup</option>
                  </select>
                </Field>
                <Field label="代码仓库">
                  {hasRealRepositories ? (
                    <select
                      value={usesStaticRepository ? repository.id : "__remote__"}
                      onChange={(event) => selectRepository(event.target.value)}
                    >
                      <option value="__remote__">自定义远程仓库</option>
                      {snapshot.repositories.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.provider}/{item.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={runConfig.repositoryId}
                      placeholder="例如 github:org/repository"
                      onChange={(event) =>
                        setRunConfig({ ...runConfig, repositoryId: event.target.value })
                      }
                    />
                  )}
                </Field>
                <Field label="仓库地址">
                  <div className="disabled-copy-input">
                    <input
                      value={repositoryUrl}
                      placeholder="https://github.com/org/repository.git"
                      onBlur={() => {
                        if (repositoryUrl.trim()) void resolveRemoteSource();
                      }}
                      onChange={(event) => changeRepositoryUrl(event.target.value)}
                    />
                    <button type="button" aria-label="复制仓库地址" onClick={() => void onCopy(displayRepositoryUrl, "仓库地址")}>
                      <Archive size={16} />
                    </button>
                  </div>
                </Field>
                <Field label="访问令牌">
                  <input
                    type="password"
                    value={repositoryAccessToken}
                    placeholder="可选：私有仓库使用，或配置 GITHUB_TOKEN/GITLAB_TOKEN/GITCODE_TOKEN"
                    onChange={(event) => setRepositoryAccessToken(event.target.value)}
                  />
                </Field>
                <Field label="默认分支">
                  {usesStaticRepository ? (
                    <input value={repository.defaultBranch} readOnly />
                  ) : (
                    <input
                      value={runConfig.refName}
                      placeholder="main"
                      onChange={(event) => selectRefName(event.target.value)}
                    />
                  )}
                </Field>
                <Field label="负责人">
                  <input value={repository.owner} readOnly />
                </Field>
                <button type="button" className="cloud-secondary" disabled={remoteLoading} onClick={() => void resolveRemoteSource()}>
                  {remoteLoading ? "拉取中..." : "拉取分支和 Tag"}
                </button>
                {remoteError && <div className="source-policy-status blocked">{remoteError}</div>}
              </section>
            )}

            {sourceSide === "revision" && (
              <section className="source-config-grid">
                <Field label="默认运行类型">
                  <select value={runConfig.refType} onChange={(event) => updateRunRefType(event.target.value as GitReferenceType)}>
                    <option value="branch">按分支</option>
                    <option value="tag">按 Tag</option>
                  </select>
                </Field>
                <Field label={runConfig.refType === "branch" ? "默认分支" : "默认 Tag"}>
                  {usesStaticRepository || remoteRefOptions.length > 0 ? (
                    <select value={runConfig.refName} onChange={(event) => selectRefName(event.target.value)}>
                      {selectableRefOptions.map((ref) => (
                        <option key={ref} value={ref}>
                          {ref}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={runConfig.refName}
                      placeholder={runConfig.refType === "branch" ? "main / release/2026.05" : "v1.0.0"}
                      onChange={(event) => selectRefName(event.target.value)}
                    />
                  )}
                </Field>
                <button
                  type="button"
                  className="cloud-secondary"
                  disabled={remoteLoading || !repositoryUrl.trim()}
                  onClick={() => void loadRemoteRefs(runConfig.refType, true)}
                >
                  {remoteLoading ? "拉取中..." : `刷新${runConfig.refType === "branch" ? "分支" : "Tag"}列表`}
                </button>
                <Field label="指定 Commit（可选）">
                  <select value={runConfig.commitSha ?? ""} onChange={(event) => selectCommit(event.target.value)}>
                    <option value="">运行时解析 {runConfig.refName} 最新提交</option>
                    {recentCommits.map((commit) => (
                      <option key={commit.sha} value={commit.sha}>
                        {commit.sha.slice(0, 12)} · {commit.message}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="source-commit-card">
                  <strong>{selectedCommit?.message ?? "未固定 Commit"}</strong>
                  <span>{selectedCommit ? `${selectedCommit.author} · ${selectedCommit.createdAt.replace("T", " ").slice(0, 16)}` : "运行触发时会生成不可变 Commit 快照"}</span>
                  <em>{selectedCommit?.sha ?? "${resolved.commit}"}</em>
                </div>
              </section>
            )}

            {sourceSide === "policy" && (
              <section className="source-policy-panel">
                <div className="source-policy-columns">
                  <Field label="允许分支规则">
                    <textarea
                      className="config-textarea"
                      value={allowedBranchPatterns}
                      onChange={(event) => setAllowedBranchPatterns(event.target.value)}
                      rows={6}
                    />
                  </Field>
                  <Field label="允许 Tag 规则">
                    <textarea
                      className="config-textarea"
                      value={allowedTagPatterns}
                      onChange={(event) => setAllowedTagPatterns(event.target.value)}
                      rows={6}
                    />
                  </Field>
                </div>
                <div className="source-policy-switches">
                  <button type="button" onClick={() => setAllowRuntimeBranch((value) => !value)}>
                    <Switch enabled={allowRuntimeBranch} onToggle={() => setAllowRuntimeBranch((value) => !value)} />
                    运行时可切换分支
                  </button>
                  <button type="button" onClick={() => setAllowRuntimeTag((value) => !value)}>
                    <Switch enabled={allowRuntimeTag} onToggle={() => setAllowRuntimeTag((value) => !value)} />
                    运行时可切换 Tag
                  </button>
                  <button type="button" onClick={() => setAllowRuntimeCommit((value) => !value)}>
                    <Switch enabled={allowRuntimeCommit} onToggle={() => setAllowRuntimeCommit((value) => !value)} />
                    运行时可固定 Commit
                  </button>
                </div>
              </section>
            )}
          </main>
        </div>
      )}

      {activeTab === "flow" && (
        <div className="flow-config-editor">
          <div className="flow-config-main">
            <div className="tekton-binding-strip">
              <div>
                <span>Tekton Pipeline</span>
                <strong>{tektonBinding ? `${tektonBinding.namespace}/${tektonBinding.pipelineName}` : "待生成"}</strong>
              </div>
              <div>
                <span>ServiceAccount</span>
                <strong>{tektonBinding?.serviceAccountName ?? "tekton-builder"}</strong>
              </div>
              <div>
                <span>Resolver</span>
                <strong>{tektonBinding?.resolver ?? "cluster"}</strong>
              </div>
              <div>
                <span>Workspaces</span>
                <strong>{tektonBinding?.workspaces.join(" / ") ?? "source-ws / cache-ws"}</strong>
              </div>
            </div>
            <div className="flow-config-viewport">
              <div className="flow-config-toolbar">
                {flowViewMode === "canvas" && (
                  <div className="node-palette" role="group" aria-label="新增预设阶段">
                    {PRESET_STAGES.map((preset) => (
                      <button
                        key={preset.stage}
                        type="button"
                        className="node-palette-button"
                        onClick={() => addPresetStage(preset.stage)}
                        disabled={enabledStages.includes(preset.stage)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="pipeline-view-toggle" role="group" aria-label="流水线视图切换">
                  <button
                    type="button"
                    className={flowViewMode === "canvas" ? "active" : ""}
                    onClick={() => setFlowViewMode("canvas")}
                  >
                    DAG 视图
                  </button>
                  <button
                    type="button"
                    className={flowViewMode === "board" ? "active" : ""}
                    onClick={() => setFlowViewMode("board")}
                  >
                    阶段栏（旧）
                  </button>
                </div>
              </div>
              {flowViewMode === "canvas" && customEdges.length > 0 && (
                <div className="custom-edges-preview-banner" role="alert">
                  <span>预览功能</span>
                  <em>
                    已建立 {customEdges.length} 条自定义依赖。当前版本仅持久化 stage 启停，
                    自定义连线不会随保存写入后端 (Sprint C 议题)。
                  </em>
                  <button type="button" onClick={() => setCustomEdges([])}>
                    清空
                  </button>
                </div>
              )}
              {flowViewMode === "canvas" ? (
                <div className="flow-config-canvas-shell">
                  <PipelineConfigFlowCanvas
                    pipeline={{ ...pipeline, stages: enabledStages, buildConfig: buildPipelineBuildConfig() }}
                    selectedStage={selectedTaskDefinition.stage}
                    invalidStages={invalidStagesSet}
                    customEdges={customEdges}
                    onSelectStage={selectStageNode}
                    onConnectStages={handleConnectStages}
                    minHeight={480}
                  />
                </div>
              ) : (
                <div className="flow-config-board">
              <section className="flow-stage-lane source">
                <h2>流水线源</h2>
                <div className="source-config-card">
                  <button
                    type="button"
                    className={`source-pill ${selectedTask === sourceTask?.name ? "selected" : ""}`}
                    onClick={() => sourceTask && selectTask(sourceTask.name, "source")}
                  >
                    <span className="codeup-mark mini">C</span>
                    <strong>{repository.provider}/{repository.name}</strong>
                    <Rocket size={16} />
                  </button>
                  <small>
                    <GitBranch size={14} />
                    {runConfig.refType === "branch" ? runConfig.refName : repository.defaultBranch}
                  </small>
                  <small>
                    <Archive size={14} />
                    {tektonBinding?.trigger.eventListener ?? "EventListener 未生成"}
                  </small>
                </div>
                <button
                  className="add-source-button"
                  onClick={() => {
                    setActiveTab("source");
                    setSourceSide("repository");
                    onNotify("流水线源已打开，可调整仓库、分支和 Tag");
                  }}
                >
                  <Plus size={16} />
                  添加流水线源
                </button>
              </section>
              <section className="flow-stage-lane">
                <h2>{stageLabelForPackageMode(packageMode, "test")}</h2>
                {testTasks.map((task) => (
                  <button
                    key={task.name}
                    className={taskClass("test", task.name, taskMissingConfig("test"))}
                    onClick={() => selectTask(task.name, "test")}
                  >
                    {task.name} <XCircle size={15} />
                  </button>
                ))}
              </section>
              <section className="flow-stage-lane">
                <h2>{stageLabelForPackageMode(packageMode, "build")}</h2>
                {buildTask && (
                  <button
                    className={taskClass("build", buildTask.name, taskMissingConfig("build"))}
                    onClick={() => selectTask(buildTask.name, "build")}
                  >
                    {buildTask.name} <XCircle size={15} />
                  </button>
                )}
                {uploadTask && (
                  <button
                    className={taskClass("upload", uploadTask.name, taskMissingConfig("upload"))}
                    onClick={() => selectTask(uploadTask.name, "upload")}
                  >
                    {uploadTask.name}
                  </button>
                )}
              </section>
              <section className="flow-stage-lane">
                <h2>变量/制品</h2>
                {envTask && (
                  <button
                    className={taskClass("env", envTask.name, taskMissingConfig("env"))}
                    onClick={() => selectTask(envTask.name, "env")}
                  >
                    {envTask.name}
                  </button>
                )}
                {packageTask && (
                  <button
                    className={taskClass("package", packageTask.name)}
                    onClick={() => selectTask(packageTask.name, "package")}
                  >
                    {packageTask.name}
                  </button>
                )}
              </section>
              <section className="flow-stage-lane">
                <h2>{stageLabelForPackageMode(packageMode, "deploy")}</h2>
                {deployTask && (
                  <button
                    className={taskClass("deploy", deployTask.name, taskMissingConfig("deploy"))}
                    onClick={() => selectTask(deployTask.name, "deploy")}
                  >
                    {deployTask.name}
                  </button>
                )}
                {canaryTask && (
                  <button
                    className={taskClass("canary", canaryTask.name, taskMissingConfig("canary"))}
                    onClick={() => selectTask(canaryTask.name, "canary")}
                  >
                    {canaryTask.name} {pipeline.canaryPercent}%
                  </button>
                )}
              </section>
              <section className="flow-stage-lane muted">
                <h2>新阶段</h2>
                <button className="new-task-button" onClick={addNewTask}>
                  <Plus size={15} />
                  新的任务
                </button>
              </section>
                </div>
              )}
            </div>
          </div>
          <aside className={`task-config-panel task-panel-${selectedTaskDefinition.kind}`}>
            <div className="task-config-head">
              <span className="task-stage-badge">{stageLabelForPackageMode(packageMode, selectedTaskDefinition.stage)}</span>
              <strong>{selectedTaskDefinition.title}</strong>
              <button
                className="plain-icon"
                aria-label="复制任务配置"
                onClick={() =>
                  void onCopy(
                    JSON.stringify(selectedTaskCopyPayload, null, 2),
                    "任务配置",
                  )
                }
              >
                <Archive size={15} />
              </button>
              <button className="plain-icon" aria-label="移除任务" onClick={removeSelectedTask}>
                <XCircle size={18} />
              </button>
            </div>
            <div className="task-config-scroll">
              <section className="task-identity-card">
                <div>
                  <span>{selectedTaskDefinition.taskRef}</span>
                  <h3>{selectedTaskDefinition.name}</h3>
                  <p>{selectedTaskDefinition.description}</p>
                </div>
                <em>{selectedTaskDefinition.kind}</em>
              </section>
              <div className="task-operation-list">
                {selectedTaskDefinition.operations.map((operation, index) => (
                  <span key={operation}>
                    <strong>{index + 1}</strong>
                    {operation}
                  </span>
                ))}
              </div>
              <Field label="任务名称">
                <input value={selectedTask} onChange={(event) => setSelectedTask(event.target.value)} />
              </Field>

              {selectedTaskDefinition.kind === "source" && (
                <section className="task-specific-panel">
                  <h3>代码源与 Revision</h3>
                  <Field label="仓库地址">
                    <input value={displayRepositoryUrl} readOnly />
                  </Field>
                  <Field label="默认 Revision">
                    <input value={`${runConfig.refType} / ${runConfig.refName}`} readOnly />
                  </Field>
                  <Field label="代码凭据">
                    <select value={`${repositoryProvider}-readonly`} disabled>
                      <option value={`${repositoryProvider}-readonly`}>{repositoryProvider}-readonly</option>
                    </select>
                  </Field>
                  <Field label="下载策略">
                    <select value={downloadMode} onChange={(event) => setDownloadMode(event.target.value)}>
                      <option value="all">下载全部流水线源</option>
                      <option value="current">仅下载当前源</option>
                    </select>
                  </Field>
                  <button
                    type="button"
                    className="cloud-secondary"
                    onClick={() => {
                      setActiveTab("source");
                      setSourceSide("repository");
                    }}
                  >
                    打开流水线源配置
                  </button>
                </section>
              )}

              {(selectedTaskDefinition.kind === "quality" || selectedTaskDefinition.kind === "build") && (
                <section className="task-specific-panel">
                  <h3>{selectedTaskDefinition.kind === "quality" ? "测试运行环境" : "构建运行环境"}</h3>
                  <Field label="构建集群">
                    <select
                      className={buildCluster ? "" : "invalid-select"}
                      value={buildCluster}
                      onChange={(event) => setBuildCluster(event.target.value)}
                    >
                      <option value="">请选择</option>
                      <option value="vpc">VPC 构建集群</option>
                      <option value="default">默认共享集群</option>
                    </select>
                  </Field>
                  <p className="field-help">VPC 构建用于测试、构建和镜像任务；部署任务只读取制品和 kubeconfig。</p>
                  {!buildCluster && <p className="field-error">构建集群不能为空</p>}
                  <Field label="指定构建节点">
                    <select value={buildNode} onChange={(event) => setBuildNode(event.target.value)}>
                      <option value="linux-amd64">Linux.amd64</option>
                      <option value="linux-arm64">Linux.arm64</option>
                    </select>
                  </Field>
                  <Field label="容器镜像地址">
                    <select value={containerImage} onChange={(event) => setContainerImage(event.target.value)}>
                      <option value="build-steps/alinux3">build-steps/alinux3</option>
                      <option value="node:20-alpine">node:20-alpine</option>
                    </select>
                  </Field>
                  {selectedTaskDefinition.kind === "build" && (
                    <>
                      <Field label="打包方式">
                        <select value={packageMode} onChange={(event) => setPackageMode(event.target.value as PackageMode)}>
                          {PACKAGE_MODES.map((mode) => (
                            <option key={mode} value={mode}>
                              {packageModeLabel(mode)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="构建语言">
                        <select
                          value={buildRuntime}
                          onChange={(event) => {
                            const nextRuntime = event.target.value as PipelineBuildRuntime;
                            setBuildRuntime(nextRuntime);
                            if (nextRuntime === "generic") {
                              setPackageBuildCommandMode("custom");
                            }
                          }}
                        >
                          <option value="node">Node.js / package.json</option>
                          <option value="go">Go / go.mod</option>
                          <option value="generic">通用命令</option>
                        </select>
                      </Field>
                      <p className="field-help">{packageModeHelp(packageMode)}</p>
                      <Field label="构建上下文">
                        <input value={buildContextPath} onChange={(event) => setBuildContextPath(event.target.value)} placeholder="." />
                      </Field>
                      <Field label="打包命令来源">
                        <select value={packageBuildCommandMode} onChange={(event) => setPackageBuildCommandMode(event.target.value as PackageBuildCommandMode)}>
                          <option value="script">使用原 package.json 脚本</option>
                          <option value="custom">手输完整命令</option>
                        </select>
                      </Field>
                      <Field label="package.json 打包脚本">
                        <input
                          className={packageBuildCommandMode !== "script" || packageBuildScript.trim() ? "" : "invalid-input"}
                          value={packageBuildScript}
                          onChange={(event) => setPackageBuildScript(event.target.value)}
                          placeholder="build"
                          disabled={packageBuildCommandMode !== "script"}
                        />
                      </Field>
                      <p className="field-help">选择“使用原 package.json 脚本”时只执行 scripts.{packageBuildScript || "build"}，不会因为下方保留了手输命令而覆盖。</p>
                      <Field label="手输打包命令">
                        <textarea
                          className={packageBuildCommandMode !== "custom" || packageBuildCommand.trim() ? "config-textarea" : "config-textarea invalid-input"}
                          value={packageBuildCommand}
                          onChange={(event) => setPackageBuildCommand(event.target.value)}
                          placeholder="pnpm --filter @company/web build"
                          rows={3}
                          disabled={packageBuildCommandMode !== "custom"}
                        />
                      </Field>
                      {packageBuildCommandMode === "custom" && !packageBuildCommand.trim() && <p className="field-error">已选择手输命令，请填写完整打包命令</p>}
                      {packageBuildCommandMode === "script" && !packageBuildScript.trim() && <p className="field-error">已选择原脚本，请填写 package.json scripts 中的脚本名</p>}
                      <Field label="打包产物目录">
                        <textarea
                          className={parseOutputPathText(packageOutputPaths).length > 0 ? "" : "invalid-input"}
                          value={packageOutputPaths}
                          onChange={(event) => setPackageOutputPaths(event.target.value)}
                          placeholder={DEFAULT_PIPELINE_BUILD_CONFIG.packageOutputPaths.join("\n")}
                        />
                      </Field>
                      <p className="field-help">每行一个真实产物目录；Next.js 通常保留 .next，静态导出可用 out。</p>
                      {parseOutputPathText(packageOutputPaths).length === 0 && <p className="field-error">至少需要配置一个真实产物目录</p>}
                    </>
                  )}
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={useLocalEslint}
                      onChange={(event) => setUseLocalEslint(event.target.checked)}
                    />{" "}
                    使用仓库内质量规则
                  </label>
                </section>
              )}

              {selectedTaskDefinition.kind === "env" && (
                <section className="task-specific-panel env-injection-panel">
                  <div className="task-step-head">
                    <strong>环境变量注入策略</strong>
                    <button type="button" onClick={applyRecommendedVariableTiming}>
                      使用推荐策略
                    </button>
                  </div>
                  <div className="injection-timing-grid">
                    <span>
                      <strong>构建时注入</strong>
                      <em>给测试和打包步骤使用，可能被写进前端静态包或镜像元数据。</em>
                      <small>{timingBuckets.build.length} 个变量</small>
                    </span>
                    <span>
                      <strong>运行时注入</strong>
                      <em>通过部署对象 env/secret/envFrom 注入，适合密钥和运行参数。</em>
                      <small>{timingBuckets.runtime.length} 个变量</small>
                    </span>
                    <span>
                      <strong>部署时注入</strong>
                      <em>只参与 Helm/Kustomize 渲染，例如 namespace、流量和 release 元数据。</em>
                      <small>{timingBuckets.deploy.length} 个变量</small>
                    </span>
                  </div>
                  <div className="variable-injection-list">
                    {stringVariables.map((variable, index) => (
                      <div key={`${variable.key}-${index}`}>
                        <strong>{variable.key || `CUSTOM_${index + 1}`}</strong>
                        <select
                          value={variable.injectionTiming ?? defaultInjectionTimingForKey(variable.key)}
                          onChange={(event) => changeVariableTiming(index, event.target.value as VariableInjectionTiming)}
                        >
                          {VARIABLE_TIMING_OPTIONS.map((option) => (
                            <option key={option.key} value={option.key}>{option.label}</option>
                          ))}
                        </select>
                        <small>{(variable.targetStages ?? []).map((stage) => STAGE_LABELS[stage]).join(" / ")}</small>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {selectedTaskDefinition.kind === "artifact" && (
                <section className="task-specific-panel">
                  <h3>制品与供应链证明</h3>
                  <Field label="SBOM 格式">
                    <select value="spdx-json" disabled>
                      <option value="spdx-json">SPDX JSON</option>
                    </select>
                  </Field>
                  <Field label="Provenance">
                    <input value={tektonBinding?.chains.format ?? "slsa/v1"} readOnly />
                  </Field>
                  <Field label="签名存储">
                    <input value={tektonBinding?.chains.storage.join(" / ") ?? "tekton / oci"} readOnly />
                  </Field>
                </section>
              )}

              {selectedTaskDefinition.kind === "upload" && (
                <section className="task-specific-panel">
                  <h3>上传制品</h3>
                  {packageMode === "container_image" ? (
                    <>
                  <Field label="镜像托管类型">
                    <select
                      value={registryProvider}
                      onChange={(event) => applyRegistryProvider(event.target.value as ImageRegistryProvider)}
                    >
                      {REGISTRY_PROVIDER_OPTIONS.map((preset) => (
                        <option key={preset.provider} value={preset.provider}>{preset.label}</option>
                      ))}
                    </select>
                  </Field>
                  <p className="field-help">{registryPreset.description}</p>
                  <Field label="选择服务连接">
                    <select
                      className={serviceConnection ? "" : "invalid-select"}
                      value={serviceConnection}
                      onChange={(event) => setServiceConnection(event.target.value)}
                    >
                      <option value="">请选择</option>
                      {REGISTRY_SERVICE_CONNECTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                      <option value="ack-deploy">ACK 部署连接</option>
                    </select>
                  </Field>
                  {!serviceConnection && <p className="field-error">选择服务连接不能为空</p>}
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={privateRegistry}
                      onChange={(event) => setPrivateRegistry(event.target.checked)}
                    />{" "}
                    使用私有镜像仓库
                  </label>
                  <Field label="区域 / Realm">
                    <input
                      value={registryRegion}
                      onChange={(event) => setRegistryRegion(event.target.value)}
                      placeholder={registryPreset.defaults.region ?? "可选，例如 cn-hangzhou"}
                    />
                  </Field>
                  <Field label="镜像仓库地址">
                    <input
                      className={registryUrl.trim() ? "" : "invalid-input"}
                      value={registryUrl}
                      onChange={(event) => setRegistryUrl(event.target.value)}
                      placeholder={registryPreset.defaults.registryUrl}
                    />
                  </Field>
                  {!registryUrl.trim() && <p className="field-error">镜像仓库地址不能为空</p>}
                  <Field label="VPC 内网地址">
                    <input
                      value={internalRegistryUrl}
                      onChange={(event) => setInternalRegistryUrl(event.target.value)}
                      placeholder={registryPreset.defaults.internalRegistryUrl ?? "可选，仅内网构建需要"}
                    />
                  </Field>
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={useInternalRegistry}
                      onChange={(event) => setUseInternalRegistry(event.target.checked)}
                    />{" "}
                    Tekton 构建推送时使用 VPC 内网地址
                  </label>
                  <Field label="命名空间 / 项目">
                    <input
                      className={registryNamespace.trim() ? "" : "invalid-input"}
                      value={registryNamespace}
                      onChange={(event) => setRegistryNamespace(event.target.value)}
                      placeholder={registryPreset.defaults.namespace}
                    />
                  </Field>
                  {!registryNamespace.trim() && <p className="field-error">命名空间不能为空</p>}
                  <Field label="镜像仓库名称">
                    <input
                      className={imageName.trim() ? "" : "invalid-input"}
                      value={imageName}
                      onChange={(event) => setImageName(event.target.value)}
                      placeholder={registryPreset.defaults.imageName}
                    />
                  </Field>
                  {!imageName.trim() && <p className="field-error">镜像仓库名称不能为空</p>}
                  <Field label="登录用户名">
                    <input
                      value={registryUsername}
                      onChange={(event) => setRegistryUsername(event.target.value)}
                      placeholder={registryPreset.defaults.registryUsername ?? "registry login username"}
                    />
                  </Field>
                  <Field label="Kubernetes Secret">
                    <input
                      className={!privateRegistry || dockerConfigSecret.trim() ? "" : "invalid-input"}
                      value={dockerConfigSecret}
                      onChange={(event) => setDockerConfigSecret(event.target.value)}
                      placeholder={registryPreset.defaults.dockerConfigSecret ?? "docker-registry-secret"}
                    />
                  </Field>
                  {privateRegistry && !dockerConfigSecret.trim() && <p className="field-error">私有仓库需要配置 docker-registry Secret 名称</p>}
                  {registryProvider === "aliyun-acr" && (
                    <section className="acr-config-card">
                      <div>
                        <strong>阿里云 ACR 凭据</strong>
                        <span>在 Tekton 所在命名空间创建 docker-registry Secret 后，docker push 会直接上传到当前 ACR 仓库。</span>
                      </div>
                      <dl>
                        <div>
                          <dt>Registry</dt>
                          <dd>{activeRegistryHost || "未配置"}</dd>
                        </div>
                        <div>
                          <dt>Secret</dt>
                          <dd>{acrSecretName}</dd>
                        </div>
                        <div>
                          <dt>Username</dt>
                          <dd>{registryUsername.trim() || "未配置"}</dd>
                        </div>
                      </dl>
                      <pre>{acrSecretCommand}</pre>
                      <div className="acr-command-actions">
                        <button type="button" onClick={() => void onCopy(acrSecretCommand, "ACR Secret 创建命令")}>
                          <Copy size={14} />
                          复制 Secret 命令
                        </button>
                        <button type="button" onClick={() => void onCopy(acrDockerLoginCommand, "ACR docker login 命令")}>
                          <Copy size={14} />
                          复制登录命令
                        </button>
                      </div>
                      <small>密码使用阿里云容器镜像服务的登录密码；不要把密码保存到流水线配置里。</small>
                    </section>
                  )}
                  <Field label="镜像 Tag">
                    <input
                      className={imageTagTemplate.trim() ? "" : "invalid-input"}
                      value={imageTagTemplate}
                      onChange={(event) => updateImageTagTemplate(event.target.value)}
                    />
                  </Field>
                  <Field label="Dockerfile">
                    <input value={dockerfilePath} onChange={(event) => setDockerfilePath(event.target.value)} />
                  </Field>
                  <Field label="构建上下文">
                    <input value={buildContextPath} onChange={(event) => setBuildContextPath(event.target.value)} />
                  </Field>
                  <Field label="完整推送地址">
                    <input value={imageArtifactPreview.imageRef} readOnly />
                  </Field>
                    </>
                  ) : (
                    <>
                      <Field label="包上传类型">
                        <select
                          value={packageUploadProvider}
                          onChange={(event) => {
                            const nextProvider = event.target.value as PackageUploadProvider;
                            setPackageUploadProvider(nextProvider);
                            if (nextProvider === "custom") {
                              setPackageUploadCommandMode("custom");
                            }
                          }}
                        >
                          {PACKAGE_UPLOAD_PROVIDERS.map((provider) => (
                            <option key={provider} value={provider}>
                              {PACKAGE_UPLOAD_PROVIDER_LABELS[provider]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <p className="field-help">非镜像包会先生成 tar.gz，再上传到本地目录、OSS 镜像地址或自建静态服务器。</p>
                      <Field label="上传端点">
                        <input
                          className={packageUploadEndpoint.trim() ? "" : "invalid-input"}
                          value={packageUploadEndpoint}
                          onChange={(event) => setPackageUploadEndpoint(event.target.value)}
                          placeholder="oss://bucket/releases 或 C:\\deploy\\static"
                        />
                      </Field>
                      {!packageUploadEndpoint.trim() && <p className="field-error">上传端点不能为空</p>}
                      <Field label="访问域名">
                        <input
                          value={packageUploadPublicBaseUrl}
                          onChange={(event) => setPackageUploadPublicBaseUrl(event.target.value)}
                          placeholder="https://static.example.com/releases"
                        />
                      </Field>
                      <Field label="备用访问域名">
                        <input
                          value={packageUploadAccessDomain}
                          onChange={(event) => setPackageUploadAccessDomain(event.target.value)}
                          placeholder="https://cdn.example.com/releases"
                        />
                      </Field>
                      <Field label="目标路径模板">
                        <input
                          className={packageUploadTargetPath.trim() ? "" : "invalid-input"}
                          value={packageUploadTargetPath}
                          onChange={(event) => setPackageUploadTargetPath(event.target.value)}
                          placeholder="${application.id}/${environment}/${run.id}/${artifact.name}"
                        />
                      </Field>
                      {!packageUploadTargetPath.trim() && <p className="field-error">目标路径模板不能为空</p>}
                      <Field label="上传服务连接">
                        <input
                          className={packageUploadServiceConnection.trim() ? "" : "invalid-input"}
                          value={packageUploadServiceConnection}
                          onChange={(event) => setPackageUploadServiceConnection(event.target.value)}
                          placeholder="oss-prod-uploader / static-server-ssh"
                        />
                      </Field>
                      {!packageUploadServiceConnection.trim() && <p className="field-error">上传服务连接不能为空</p>}
                      <Field label="上传执行方式">
                        <select
                          value={effectivePackageUploadCommandMode}
                          onChange={(event) => setPackageUploadCommandMode(event.target.value as PackageUploadCommandMode)}
                          disabled={packageUploadProvider === "custom"}
                        >
                          <option value="provider">使用内置上传流程</option>
                          <option value="custom">手输上传命令</option>
                        </select>
                      </Field>
                      <Field label="手输上传命令">
                        <textarea
                          className={effectivePackageUploadCommandMode !== "custom" || packageUploadCommand.trim() ? "config-textarea" : "config-textarea invalid-input"}
                          value={packageUploadCommand}
                          onChange={(event) => setPackageUploadCommand(event.target.value)}
                          placeholder="ossutil cp $PACKAGE_ARCHIVE_PATH $PACKAGE_URI 或 scp $PACKAGE_ARCHIVE_PATH user@host:/var/www/releases"
                          rows={4}
                          disabled={effectivePackageUploadCommandMode !== "custom"}
                        />
                      </Field>
                      {effectivePackageUploadCommandMode === "custom" && !packageUploadCommand.trim() && <p className="field-error">已选择手输上传命令，请填写完整命令</p>}
                      <p className="field-help">选择“使用内置上传流程”时会保留但不执行手输命令；手输命令可读取 PACKAGE_ARCHIVE_PATH、PACKAGE_URI、PACKAGE_PUBLIC_URL、PACKAGE_DIGEST。</p>
                      <Field label="访问地址预览">
                        <input
                          value={`${(packageUploadPublicBaseUrl || packageUploadAccessDomain || packageUploadEndpoint).replace(/\/+$/g, "")}/${packageUploadTargetPath || DEFAULT_PACKAGE_UPLOAD_CONFIG.targetPathTemplate}`}
                          readOnly
                        />
                      </Field>
                    </>
                  )}
                </section>
              )}

              {(selectedTaskDefinition.kind === "deploy" ||
                selectedTaskDefinition.kind === "canary" ||
                selectedTaskDefinition.kind === "promote") && (
                <section className="task-specific-panel">
                  <h3>{selectedTaskDefinition.kind === "canary" ? "灰度发布" : "部署发布"}</h3>
                  <Field label="选择服务连接">
                    <select
                      className={serviceConnection ? "" : "invalid-select"}
                      value={serviceConnection}
                      onChange={(event) => setServiceConnection(event.target.value)}
                    >
                      <option value="">请选择</option>
                      {REGISTRY_SERVICE_CONNECTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                      <option value="ack-deploy">ACK 部署连接</option>
                    </select>
                  </Field>
                  {!serviceConnection && <p className="field-error">选择服务连接不能为空</p>}
                  <Field label="发布环境">
                    <select
                      value={runConfig.environment}
                      onChange={(event) =>
                        setRunConfig({ ...runConfig, environment: event.target.value as EnvironmentType })
                      }
                    >
                      {environmentOptions.map((environment) => (
                        <option key={environment} value={environment}>{environment}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="灰度比例">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={runConfig.canaryPercent}
                      onChange={(event) => setRunConfig({ ...runConfig, canaryPercent: Number(event.target.value) })}
                    />
                  </Field>
                  <div className="task-env-preview">
                    {stageScopedVariables.map((variable) => (
                      <span key={variable.key}>
                        <strong>{variable.key}</strong>
                        <em>{VARIABLE_TIMING_LABELS[variable.injectionTiming ?? defaultInjectionTimingForKey(variable.key)]}</em>
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {selectedTaskDefinition.kind === "approval" && (
                <section className="task-specific-panel">
                  <h3>审批门禁</h3>
                  <Field label="审批人">
                    <input value="owner,sre" readOnly />
                  </Field>
                  <Field label="生效环境">
                    <input value="prod" readOnly />
                  </Field>
                  <Field label="门禁条件">
                    <input value="灰度观测通过 + 变更窗口打开" readOnly />
                  </Field>
                </section>
              )}

              <div className="task-step-head">
                <strong>任务步骤</strong>
                <button type="button" onClick={addStep}>
                  <Plus size={14} />
                  添加步骤
                </button>
              </div>
              <div className="task-step-block">
                <strong>{selectedTaskDefinition.name}</strong>
                <Field label="步骤名称">
                  <input value={allTaskSteps.join(" -> ")} readOnly />
                </Field>
                <div className="task-step-list">
                  {allTaskSteps.map((step, index) => (
                    <span key={`${step}-${index}`}>
                      <strong>{step}</strong>
                      <button
                        type="button"
                        disabled={index < selectedTaskDefinition.steps.length}
                        onClick={() =>
                          setTaskSteps(taskSteps.filter((_, itemIndex) => itemIndex !== index - selectedTaskDefinition.steps.length))
                        }
                      >
                        {index < selectedTaskDefinition.steps.length ? "内置" : "移除"}
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              <div className="tekton-taskspec-panel">
                <h3>Tekton TaskSpec</h3>
                <div className="tekton-chip-grid">
                  <span>resolver</span>
                  <strong>{tektonBinding?.resolverRef.resolver ?? "cluster"}</strong>
                  <span>resource</span>
                  <strong>{tektonBinding?.resolverRef.name ?? "pending-pipeline"}</strong>
                  <span>taskRef</span>
                  <strong>{selectedTaskDefinition.taskRef}</strong>
                  <span>serviceAccount</span>
                  <strong>{tektonBinding?.serviceAccountName ?? "tekton-builder"}</strong>
                  <span>workspace</span>
                  <strong>{selectedWorkspaceNames.join(", ") || "none"}</strong>
                  <span>timeout</span>
                  <strong>{selectedTaskGraph?.timeoutSeconds ?? selectedTaskDefinition.timeoutSeconds}s</strong>
                  <span>retries</span>
                  <strong>{selectedTaskGraph?.retries ?? selectedTaskDefinition.retries}</strong>
                </div>
                <div className="tekton-workspace-list">
                  {selectedWorkspaces.map((workspace) => (
                    <span key={workspace.name}>
                      <strong>{workspace.name}</strong>
                      <em>{workspace.type}</em>
                      <small>{workspace.description}</small>
                    </span>
                  ))}
                </div>
                <div className="tekton-task-graph">
                  {(tektonBinding?.taskGraph ?? []).filter((task) => task.name === selectedTaskDefinition.stage || task.runAfter.includes(selectedTaskDefinition.stage)).map((task) => (
                    <span key={task.name}>
                      <strong>{task.name}</strong>
                      <em>{task.runAfter.length > 0 ? `after ${task.runAfter.join(",")}` : "entrypoint"}</em>
                      <small>{task.workspaces.join(" / ") || "no workspace"}</small>
                    </span>
                  ))}
                </div>
                <div className="tekton-param-list">
                  {selectedParams.map((param) => (
                    <span key={param.key}>
                      <strong>{param.key}</strong>
                      <em>
                        {param.value}
                        {param.injectionTiming ? ` · ${VARIABLE_TIMING_LABELS[param.injectionTiming]}` : ""}
                      </em>
                    </span>
                  ))}
                </div>
              </div>
              <div className="tekton-taskspec-panel">
                <h3>Triggers / Results / Chains</h3>
                <div className="tekton-chip-grid">
                  <span>EventListener</span>
                  <strong>{tektonBinding?.trigger.eventListener ?? "pending-el"}</strong>
                  <span>TriggerTemplate</span>
                  <strong>{tektonBinding?.trigger.triggerTemplate ?? "pending-template"}</strong>
                  <span>Results</span>
                  <strong>{tektonBinding?.results.resultName ?? "pending-result"}</strong>
                  <span>Chains</span>
                  <strong>{tektonBinding?.chains.format ?? "slsa/v1"}</strong>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {activeTab === "trigger" && (
        <div className="pipeline-config-layout">
          <aside className="pipeline-config-side">
            <button className={triggerSide === "webhook" ? "active" : ""} onClick={() => setTriggerSide("webhook")}>
              Webhook触发
              <Switch enabled={webhookEnabled} onToggle={() => setWebhookEnabled((value) => !value)} />
            </button>
            <button className={triggerSide === "timer" ? "active" : ""} onClick={() => setTriggerSide("timer")}>
              定时触发
              <Switch enabled={timerEnabled} onToggle={() => setTimerEnabled((value) => !value)} />
            </button>
            <button
              className={triggerSide === "concurrency" ? "active" : ""}
              onClick={() => setTriggerSide("concurrency")}
            >
              并发度限制
              <Switch enabled={concurrencyEnabled} onToggle={() => setConcurrencyEnabled((value) => !value)} />
            </button>
          </aside>
          <main className="pipeline-config-content">
            {triggerSide === "webhook" && (
              <div className="trigger-panel">
                <h2>Webhook触发</h2>
                <p>
                  外部系统通过Webhook将环境参数传给流水线并触发运行，
                  <a href="https://tekton.dev/docs/triggers/" target="_blank" rel="noreferrer">
                    查看文档
                  </a>
                </p>
                <WebhookField
                  label="通用Webhook（代码源提交触发请勿使用）"
                  value={`https://{devops-domain}/pipeline/webhook/${pipeline.id}`}
                  onCopy={onCopy}
                />
                <WebhookField
                  label="流水线源Webhook"
                  value={`https://{devops-domain}/scm/webhook/${pipeline.id}`}
                  onCopy={onCopy}
                />
                <Field label="触发规则">
                  <textarea
                    className="config-textarea"
                    value={triggers}
                    onChange={(event) => setTriggers(event.target.value)}
                    rows={5}
                  />
                </Field>
              </div>
            )}
            {triggerSide === "timer" && (
              <div className="trigger-panel">
                <h2>定时触发</h2>
                <p>按 cron 或固定周期触发流水线运行。</p>
                <Field label="触发周期">
                  <select value={timerSchedule} onChange={(event) => setTimerSchedule(event.target.value)}>
                    <option value="daily">每天 02:00</option>
                    <option value="weekly">每周一 02:00</option>
                    <option value="release-window">发布窗口 22:00</option>
                  </select>
                </Field>
                <button className="cloud-secondary" onClick={() => setTimerEnabled(true)}>
                  启用定时触发
                </button>
              </div>
            )}
            {triggerSide === "concurrency" && (
              <div className="trigger-panel">
                <h2>并发度限制</h2>
                <p>控制同一流水线同时运行数量，避免重复部署。</p>
                <Field label="最大并发">
                  <input
                    type="number"
                    min={1}
                    value={maxConcurrency}
                    onChange={(event) => setMaxConcurrency(Number(event.target.value))}
                  />
                </Field>
                <button className="cloud-secondary" onClick={() => setConcurrencyEnabled(true)}>
                  启用并发限制
                </button>
              </div>
            )}
          </main>
        </div>
      )}

      {activeTab === "variables" && (
        <div className="pipeline-config-layout">
          <aside className="pipeline-config-side">
            <button
              className={variableSide === "variables" ? "active" : ""}
              onClick={() => setVariableSide("variables")}
            >
              变量
            </button>
            <button className={variableSide === "groups" ? "active" : ""} onClick={() => setVariableSide("groups")}>
              通用变量组
            </button>
            <button className={variableSide === "cache" ? "active" : ""} onClick={() => setVariableSide("cache")}>
              缓存
            </button>
          </aside>
          <main className="pipeline-config-content">
            {variableSide === "cache" ? (
              <div className="trigger-panel">
                <h2>缓存</h2>
                <p>缓存依赖目录，加速 Node.js 构建和测试。</p>
                <Field label="缓存路径">
                  <input value={cachePath} onChange={(event) => setCachePath(event.target.value)} />
                </Field>
                <Field label="缓存 Key">
                  <input value={`${repository.name}-cache-${runConfig.refName}`} readOnly />
                </Field>
              </div>
            ) : (
              <div className="variable-panel">
                <h2>{variableSide === "variables" ? "变量" : "通用变量组"}</h2>
                <p>
                  通过定义环境变量实现流水线过程定制化，可以在执行过程的任何阶段使用这些变量。
                  <a href="https://tekton.dev/docs/pipelines/pipelineruns/#specifying-parameters" target="_blank" rel="noreferrer">
                    查看文档
                  </a>
                </p>
                {variableSide === "variables" ? (
                  <>
                    <section className="variable-editor-block">
                      <div className="variable-table-title">
                        <strong>字符变量</strong>
                        <button
                          type="button"
                          onClick={() =>
                            setStringVariables([
                              ...stringVariables,
                              {
                                key: `CUSTOM_${stringVariables.length + 1}`,
                                value: "",
                                injectionTiming: "runtime",
                                targetStages: ["deploy", "canary", "approval", "promote"],
                              },
                            ])
                          }
                        >
                          <Plus size={14} />
                          新建变量
                        </button>
                      </div>
                      <div className="variable-editor-grid">
                        <span>变量名称</span>
                        <span>默认值</span>
                        <span>注入时机</span>
                        <span>描述</span>
                        <span>私密</span>
                        {stringVariables.map((variable, index) => (
                          <div className="variable-editor-row" key={`${variable.key}-${index}`}>
                            <input
                              value={variable.key}
                              onChange={(event) =>
                                updateStringVariable(index, { key: event.target.value })
                              }
                            />
                            <input
                              value={variable.value}
                              onChange={(event) =>
                                updateStringVariable(index, { value: event.target.value })
                              }
                            />
                            <select
                              value={variable.injectionTiming ?? defaultInjectionTimingForKey(variable.key)}
                              onChange={(event) => changeVariableTiming(index, event.target.value as VariableInjectionTiming)}
                            >
                              {VARIABLE_TIMING_OPTIONS.map((option) => (
                                <option key={option.key} value={option.key}>{option.label}</option>
                              ))}
                            </select>
                            <input
                              value={variable.description ?? ""}
                              onChange={(event) =>
                                updateStringVariable(index, { description: event.target.value })
                              }
                            />
                            <label>
                              <input
                                type="checkbox"
                                checked={Boolean(variable.encrypted)}
                                onChange={(event) =>
                                  updateStringVariable(index, { encrypted: event.target.checked })
                                }
                              />
                            </label>
                          </div>
                        ))}
                      </div>
                    </section>
                    <Field label="运行时变量 RELEASE_NOTE">
                      <input value={runtimeVariable} onChange={(event) => syncReleaseNoteValue(event.target.value)} />
                    </Field>
                  </>
                ) : (
                  <>
                    <VariableTable
                      title="通用变量组"
                      columns={["变量名称", "默认值", "描述", "私密模式", "运行时设置", "状态", "操作"]}
                      rows={variableGroupRows}
                      readOnlyColumnIndexes={[5]}
                      selectOptionsByColumn={{ 3: ["否", "是"], 4: VARIABLE_TIMING_OPTIONS.map((option) => option.label) }}
                      onCellChange={updateVariableGroupCell}
                      onDeleteRow={deleteVariableGroupRow}
                      onCreate={() => {
                        setStringVariables([
                          ...stringVariables,
                          normalizeVariable({
                            key: `GROUP_${stringVariables.length + 1}`,
                            value: "enabled",
                            description: "共享变量组",
                            injectionTiming: "build",
                            targetStages: ["test", "build", "package"],
                          }, runConfig.environment),
                        ]);
                        onNotify("通用变量组已新增");
                      }}
                    />
                    <VariableTable
                      title="运行选择变量"
                      columns={["变量名称", "默认值", "描述", "选项", "操作"]}
                      rows={runtimeRows}
                      onCellChange={updateRuntimeRowCell}
                      onDeleteRow={deleteRuntimeRow}
                      onCreate={() => {
                        applyRuntimeRows([
                          ...runtimeRows,
                          [`CHOICE_${runtimeRows.length + 1}`, "blue", "运行时选择", "blue / green"],
                        ]);
                        onNotify("运行选择变量已新增");
                      }}
                    />
                  </>
                )}
              </div>
            )}
          </main>
        </div>
      )}
    </section>
  );
}
