"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSelectedLayoutSegments } from "next/navigation";
import {
  DEFAULT_PIPELINE_BUILD_CONFIG,
  defaultImageArtifactConfig,
  LIFECYCLE_STAGES,
  type Artifact,
  type CanaryTrafficRegion,
  type CreatePipelineRequest,
  type EnvironmentType,
  type GlobalParam,
  type ImageArtifactConfig,
  type LifecycleStageKey,
  type PackageMode,
  type PipelineBuildConfig,
  type PipelineCacheConfig,
  type PipelineDefinition,
  type PipelineRun,
  type PlatformSnapshot,
  type RolloutStrategyConfig,
  type UpdatePipelineRequest,
} from "@deploy-management/shared";
import { useSnapshot } from "../lib/snapshot-context";
import {
  advanceCanaryRelease,
  cancelRun,
  createPipeline,
  deletePipeline,
  deployArtifact,
  pauseCanaryRelease,
  promoteCanaryRelease,
  promoteRun,
  resumeCanaryRelease,
  rollbackRelease,
  triggerPipeline,
  updatePipeline,
} from "../lib/actions";
import { ActionToast, copyText } from "./components/primitives";
import { CloudTopbar } from "./layouts/cloud-topbar";
import { RepoSidebar } from "./layouts/repo-sidebar";
import { FlowSidebar, type FlowNavKey } from "./layouts/flow-sidebar";
import { PipelineLanding } from "./sections/pipeline-landing";
import { ArtifactCenter } from "./sections/artifact-center";
import { PipelineList, type PipelineListView } from "./sections/pipeline-list";
import { FlowWorkspacePanel } from "./sections/flow-workspace-panel";
import { TemplateModal } from "./sections/template-modal";
import { PipelineRunDetail } from "./sections/pipeline-run-detail";
import { PipelineConfigEditor, type RunConfig } from "./sections/pipeline-config-editor";
import { RunLaunchDialog } from "./sections/run-launch-dialog";
import { pipelineTemplates, type PipelineConfigTab, type PipelineTemplate, type TemplateMode } from "./data/templates";
import {
  applyFrontendTemplateInput,
  emptyFrontendTemplateInput,
  type FrontendTemplateInput,
} from "./data/template-inputs";

type Surface = "landing" | "list" | "detail" | "config";

interface DashboardShellProps {
  surface: Surface;
  pipelineId?: string;
  runId?: string;
}

export function DashboardShell({ surface, pipelineId, runId }: DashboardShellProps) {
  const router = useRouter();
  const segments = useSelectedLayoutSegments();
  const { snapshot, loading, error, reload } = useSnapshot();

  const [query, setQuery] = useState("");
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("node-k8s-release");
  const [activeCategory, setActiveCategory] = useState("Node.js");
  const [templateMode, setTemplateMode] = useState<TemplateMode>("visual");
  const [frontendTemplateInput, setFrontendTemplateInput] =
    useState<FrontendTemplateInput>(emptyFrontendTemplateInput);
  const [configTab, setConfigTab] = useState<PipelineConfigTab>("basic");
  const [runLaunchPipeline, setRunLaunchPipeline] = useState<PipelineDefinition | null>(null);
  const [runLaunchConfig, setRunLaunchConfig] = useState<RunConfig | null>(null);
  const [notice, setNotice] = useState("");
  const [flowNavKey, setFlowNavKey] = useState<FlowNavKey>("list");
  const [runConfig, setRunConfig] = useState<RunConfig>({
    repositoryId: "",
    refType: "branch",
    refName: "",
    environment: "test",
    canaryPercent: 100,
    stages: LIFECYCLE_STAGES.map((stage) => stage.key),
  });

  const selectedPipeline = useMemo(() => {
    if (!snapshot) return undefined;
    return snapshot.pipelines.find((pipeline) => pipeline.id === pipelineId) ?? snapshot.pipelines[0];
  }, [pipelineId, snapshot]);

  const selectedRun = useMemo(() => {
    if (!snapshot) return undefined;
    if (runId) {
      return snapshot.runs.find((run) => run.id === runId);
    }
    if (selectedPipeline) {
      return snapshot.runs.find((run) => run.pipelineId === selectedPipeline.id);
    }
    return snapshot.runs.find((run) => run.status === "failed") ?? snapshot.runs[0];
  }, [runId, selectedPipeline, snapshot]);

  useEffect(() => {
    if (!selectedPipeline) return;
    setRunConfig({
      repositoryId: selectedPipeline.repositoryId,
      refType: selectedPipeline.defaultRefType,
      refName: selectedPipeline.defaultRef,
      environment: selectedPipeline.targetEnvironment,
      canaryPercent: selectedPipeline.canaryPercent,
      stages: selectedPipeline.stages,
    });
  }, [selectedPipeline?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setShowCreateMenu(false);
  }, [segments.join("/")]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const goToPipeline = (pipelineId: string) => router.push(`/pipelines/${pipelineId}`);
  const goToRun = (runId: string) => router.push(`/runs/${runId}`);
  const notify = (message: string) => setNotice(message);

  const copyValue = async (value: string, label: string) => {
    const copied = await copyText(value);
    notify(copied ? `${label}已复制` : `${label}复制失败，请手动复制`);
  };

  const openTemplateModal = () => {
    setFrontendTemplateInput({ ...emptyFrontendTemplateInput });
    setShowTemplateModal(true);
  };

  const createFromTemplate = async (templateKey = selectedTemplateKey) => {
    if (!snapshot) return;
    const template = pipelineTemplates.find((item) => item.key === templateKey) ?? pipelineTemplates[0];
    const request = createRequestFromTemplate(template, snapshot, templateMode, frontendTemplateInput);
    const pipeline = await createPipeline(request);
    setRunConfig({
      repositoryId: pipeline.repositoryId,
      refType: pipeline.defaultRefType,
      refName: pipeline.defaultRef,
      environment: pipeline.targetEnvironment,
      canaryPercent: pipeline.canaryPercent,
      stages: pipeline.stages,
    });
    setShowTemplateModal(false);
    setShowCreateMenu(false);
    setFrontendTemplateInput({ ...emptyFrontendTemplateInput });
    setConfigTab("source");
    await reload();
    router.push(`/pipelines/${pipeline.id}/edit`);
    notify("流水线草稿已创建，进入配置界面");
  };

  const defaultRunConfigFor = (pipeline: PipelineDefinition): RunConfig => ({
    repositoryId: pipeline.repositoryId,
    refType: pipeline.defaultRefType,
    refName: pipeline.defaultRef,
    environment: pipeline.targetEnvironment,
    canaryPercent: pipeline.canaryPercent,
    stages: pipeline.stages,
  });

  const openRunDialog = (target?: PipelineDefinition) => {
    const pipeline = target ?? selectedPipeline;
    if (!pipeline) return;
    setRunLaunchPipeline(pipeline);
    setRunLaunchConfig(defaultRunConfigFor(pipeline));
  };

  const runPipeline = async (target?: PipelineDefinition, configOverride?: RunConfig) => {
    const pipeline = target ?? selectedPipeline;
    if (!pipeline) return;
    const config =
      configOverride ??
      (target ? defaultRunConfigFor(pipeline) : runConfig);
    try {
      const run = await triggerPipeline(pipeline.id, { ...config, actor: "RO" });
      setRunLaunchPipeline(null);
      setRunLaunchConfig(null);
      await reload();
      router.push(`/runs/${run.id}`);
      notify("流水线已触发，正在生成 PipelineRun");
    } catch (error) {
      notify(error instanceof Error ? error.message : "流水线触发失败");
    }
  };

  const savePipeline = async (target: PipelineDefinition, patch: UpdatePipelineRequest): Promise<PipelineDefinition> => {
    const updated = await updatePipeline(target.id, patch);
    setRunConfig({
      repositoryId: updated.repositoryId,
      refType: updated.defaultRefType,
      refName: updated.defaultRef,
      environment: updated.targetEnvironment,
      canaryPercent: updated.canaryPercent,
      stages: updated.stages,
    });
    await reload();
    return updated;
  };

  const handleDeletePipeline = async (target: PipelineDefinition): Promise<void> => {
    await deletePipeline(target.id);
    await reload();
    notify(`流水线 ${target.name} 已删除`);
    router.push("/pipelines");
  };

  const handleCancel = async (runId: string): Promise<void> => {
    await cancelRun(runId);
    await reload();
    notify("运行已取消");
  };

  const handlePromote = async (runId: string): Promise<void> => {
    await promoteRun(runId);
    await reload();
    notify("审批已通过，已推进全量发布");
  };

  const handleDeployArtifact = async (artifactId: string, environment: EnvironmentType): Promise<void> => {
    try {
      const release = await deployArtifact(artifactId, { environment, actor: "RO" });
      await reload();
      notify(`${release.applicationName} 已上线到 ${environment}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "制品上线失败");
    }
  };

  const handleCanaryDeployArtifact = async (
    artifactId: string,
    environment: EnvironmentType,
    regions: CanaryTrafficRegion[] = [],
  ): Promise<void> => {
    try {
      const artifact = snapshot?.artifacts.find((item) => item.id === artifactId);
      const run = snapshot?.runs.find((item) => item.id === artifact?.runId);
      const packageMode = packageModeFromRunArtifact(run, artifact);
      const rolloutStrategy = defaultRolloutStrategyForPackageMode(packageMode, run?.applicationName ?? "application", environment);
      const canaryRegions = normalizeCanaryRegionsForRequest(regions);
      const canaryPercent = canaryRegions[0]?.percent ?? 10;
      const release = await deployArtifact(artifactId, {
        environment,
        actor: "RO",
        strategy: "canary",
        canaryPercent,
        packageMode,
        rolloutStrategy,
        rolloutPolicy: {
          ...(rolloutStrategy.packageMode === "container_image" ? rolloutStrategy.policy : {}),
          regions: canaryRegions,
        },
      });
      await reload();
      notify(`${release.applicationName} 已开始 ${environment} 灰度`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "灰度上线失败");
    }
  };

  const handleReleaseAction = async (
    releaseId: string,
    action: "advance" | "pause" | "resume" | "promote" | "rollback",
  ): Promise<void> => {
    try {
      if (action === "advance") {
        await advanceCanaryRelease(releaseId, { actor: "RO", reason: "页面手动推进灰度" });
      } else if (action === "pause") {
        await pauseCanaryRelease(releaseId, { actor: "RO", reason: "页面手动暂停灰度" });
      } else if (action === "resume") {
        await resumeCanaryRelease(releaseId, { actor: "RO", reason: "页面手动继续灰度" });
      } else if (action === "promote") {
        await promoteCanaryRelease(releaseId, { actor: "RO", reason: "页面手动全量发布" });
      } else {
        await rollbackRelease(releaseId, { actor: "RO", reason: "页面手动回滚" });
      }
      await reload();
      notify("灰度操作已执行");
    } catch (error) {
      notify(error instanceof Error ? error.message : "灰度操作失败");
    }
  };

  const handleFlowNav = (key: FlowNavKey, label: string) => {
    setFlowNavKey(key);
    if (isPipelineListView(key) || key === "artifacts" || isWorkspacePanelKey(key)) {
      router.push("/pipelines");
      notify(`${label}已切换`);
      return;
    }
    notify(`${label}已聚焦到当前工作台数据`);
  };

  if (loading) return <div className="boot-screen">正在连接 CI/CD 控制面...</div>;
  if (!snapshot || error) {
    return (
      <div className="boot-screen">
        <strong>{error || "没有可用数据"}</strong>
        <button className="primary-action" onClick={() => void reload()}>
          重试连接
        </button>
      </div>
    );
  }

  return (
    <div className="codeup-shell">
      <CloudTopbar
        onCreate={() => {
          openTemplateModal();
          notify("请选择模板或自定义空白流水线");
        }}
        onAction={notify}
        onOpenList={() => router.push("/pipelines")}
      />
      {surface === "landing" ? (
        <div className="codeup-layout">
          <RepoSidebar onOpenList={() => router.push("/pipelines")} onAction={notify} />
          <main className="codeup-main landing-main">
            <PipelineLanding
              showCreateMenu={showCreateMenu}
              onToggleMenu={() => setShowCreateMenu((value) => !value)}
              onOpenTemplates={() => {
                setShowCreateMenu(false);
                openTemplateModal();
              }}
              onAutoCreate={() => void createFromTemplate("node-k8s-release")}
            />
          </main>
        </div>
      ) : (
        <main className="cloud-full-main">
          {surface === "list" && (
            <div className="flow-shell">
              <FlowSidebar activeKey={flowNavKey} onSelect={handleFlowNav} />
              {flowNavKey === "artifacts" ? (
                <ArtifactCenter
                  snapshot={snapshot}
                  onCopy={copyValue}
                  onDeploy={handleDeployArtifact}
                  onCanaryDeploy={handleCanaryDeployArtifact}
                  onReleaseAction={handleReleaseAction}
                  onRefresh={() => {
                    void reload();
                    notify("已刷新制品快照");
                  }}
                />
              ) : isPipelineListView(flowNavKey) ? (
                <PipelineList
                  snapshot={snapshot}
                  query={query}
                  onQueryChange={setQuery}
                  sidebarView={flowNavKey}
                  selectedPipelineId={selectedPipeline?.id}
                  onOpenTemplates={openTemplateModal}
                  onRefresh={() => {
                    void reload();
                    notify("已刷新流水线快照");
                  }}
                  onSelectPipeline={goToPipeline}
                  onSelectRun={(runId) => goToRun(runId)}
                  onRunPipeline={(pipeline) => openRunDialog(pipeline)}
                  onEditPipeline={(pipeline) => router.push(`/pipelines/${pipeline.id}/edit`)}
                  onCopy={copyValue}
                  onNotify={notify}
                />
              ) : (
                <FlowWorkspacePanel
                  snapshot={snapshot}
                  activeKey={flowNavKey}
                  onSelectRun={(id) => goToRun(id)}
                />
              )}
            </div>
          )}

          {surface === "detail" && selectedRun && selectedPipeline && (
            <PipelineRunDetail
              snapshot={snapshot}
              run={selectedRun}
              pipeline={selectedRun.definitionSnapshot ?? selectedPipeline}
              onEdit={() => {
                setConfigTab("basic");
                router.push(`/pipelines/${selectedPipeline.id}/edit`);
              }}
              onBack={() => router.push("/pipelines")}
              onRun={() => openRunDialog(selectedPipeline)}
              onSelectRun={(id) => goToRun(id)}
              onCancel={handleCancel}
              onPromote={handlePromote}
              onCopy={copyValue}
              onNotify={notify}
            />
          )}

          {surface === "detail" && (!selectedRun || !selectedPipeline) && (
            <div className="real-data-empty-state">
              <strong>暂无可展示的运行记录</strong>
              <span>测试运行数据已移除。接入真实流水线运行数据后，这里会展示对应 PipelineRun 的执行过程。</span>
              <button className="cloud-secondary" onClick={() => router.push("/pipelines")}>
                返回流水线列表
              </button>
            </div>
          )}

          {surface === "config" && selectedPipeline && (
            <PipelineConfigEditor
              snapshot={snapshot}
              pipeline={selectedPipeline}
              runConfig={runConfig}
              setRunConfig={setRunConfig}
              activeTab={configTab}
              setActiveTab={setConfigTab}
              onBack={() => router.push(`/pipelines/${selectedPipeline.id}`)}
              onSavePipeline={(patch) => savePipeline(selectedPipeline, patch)}
              onSaveRun={(pipeline, config) => void runPipeline(pipeline ?? selectedPipeline, config)}
              onDeletePipeline={() => handleDeletePipeline(selectedPipeline)}
              onCopy={copyValue}
              onNotify={notify}
            />
          )}

          {surface === "config" && !selectedPipeline && (
            <div className="real-data-empty-state">
              <strong>暂无可配置的流水线</strong>
              <span>测试流水线数据已移除。请先接入真实应用、仓库和流水线数据，或通过真实仓库创建新流水线。</span>
              <button className="yunxiao-primary" onClick={openTemplateModal}>
                新建流水线
              </button>
            </div>
          )}
        </main>
      )}

      {showTemplateModal && (
        <TemplateModal
          snapshot={snapshot}
          canCreate
          selectedTemplateKey={selectedTemplateKey}
          onSelectTemplate={setSelectedTemplateKey}
          activeCategory={activeCategory}
          onChangeCategory={setActiveCategory}
          templateMode={templateMode}
          onChangeMode={setTemplateMode}
          frontendTemplateInput={frontendTemplateInput}
          onChangeFrontendTemplateInput={(patch) =>
            setFrontendTemplateInput((current) => ({ ...current, ...patch }))
          }
          onClose={() => setShowTemplateModal(false)}
          onCreate={() => void createFromTemplate()}
          onCreateCustom={() => void createFromTemplate("empty-template")}
        />
      )}
      {runLaunchPipeline && runLaunchConfig && (
        <RunLaunchDialog
          snapshot={snapshot}
          pipeline={runLaunchPipeline}
          initialConfig={runLaunchConfig}
          onClose={() => {
            setRunLaunchPipeline(null);
            setRunLaunchConfig(null);
          }}
          onRun={(config) => void runPipeline(runLaunchPipeline, config)}
          onNotify={notify}
        />
      )}
      <ActionToast message={notice} />
    </div>
  );
}

function isPipelineListView(key: FlowNavKey): key is PipelineListView {
  return key === "list" || key === "all" || key === "groups" || key === "ungrouped";
}

function isWorkspacePanelKey(key: FlowNavKey): key is "runs" | "tekton" | "usage" | "settings" {
  return key === "runs" || key === "tekton" || key === "usage" || key === "settings";
}

function createRequestFromTemplate(
  template: PipelineTemplate,
  snapshot: PlatformSnapshot,
  mode: TemplateMode,
  frontendInput: FrontendTemplateInput = emptyFrontendTemplateInput,
): CreatePipelineRequest {
  const application = snapshot.applications.find((item) => item.id === template.applicationId) ?? snapshot.applications[0];
  const repository = snapshot.repositories.find((item) => item.id === template.repositoryId) ?? snapshot.repositories[0];
  const applicationId = application?.id ?? "draft-application";
  const repositoryId = repository?.id ?? "draft-repository";
  const repositoryName = repository?.name ?? "repository";
  const repositoryUrl = repository?.url ?? "";
  const repositoryProvider = repository?.provider ?? "github";
  const defaultBranch = repository?.defaultBranch ?? "main";
  const repositoryTags = repository?.tags ?? [];
  const owner = application?.owner ?? "未配置";
  const today = new Date().toISOString().slice(0, 10);
  const buildConfig = buildConfigFromTemplate(template);
  const needsImageArtifact = template.packageMode === "container_image";
  const imageArtifact = needsImageArtifact
    ? imageArtifactFromTemplate(template, applicationId, repositoryName)
    : undefined;
  const packageUpload = template.packageMode === "container_image" ? undefined : template.packageUpload;
  const serviceConnections = uniqueStrings([
    `${repositoryProvider}-readonly`,
    ...(template.serviceConnections ?? []),
    ...(imageArtifact ? [imageArtifact.serviceConnection] : []),
  ]);
  const frontendTemplateValues = applyFrontendTemplateInput(
    template.key,
    {
      buildConfig,
      variables: variablesFromTemplate(template, applicationId),
      packageUpload,
    },
    frontendInput,
  );
  const runtimeVariables = template.runtimeVariables?.length
    ? template.runtimeVariables
    : [
        {
          key: "RELEASE_NOTE",
          value: template.language === "go" ? "go service release" : "manual run",
          description: "运行时发布说明",
          injectionTiming: "runtime" as const,
          targetStages: ["deploy", "canary", "approval", "promote"] as LifecycleStageKey[],
        },
      ];
  return {
    name:
      template.key === "node-k8s-release"
        ? `流水线 ${today}`
        : `${repositoryName}-${template.environment}-release`,
    applicationId,
    repositoryId,
    repositoryUrl,
    refType: "branch",
    refName: defaultBranch,
    sourcePolicy: {
      allowedBranchPatterns: [defaultBranch, "release/*", "hotfix/*"],
      allowedTagPatterns: defaultTagPatterns(repositoryTags, repositoryName),
      allowRuntimeBranch: true,
      allowRuntimeTag: repositoryTags.length > 0,
      allowRuntimeCommit: true,
    },
    targetEnvironment: template.environment,
    strategy: template.strategy,
    canaryPercent: template.canaryPercent,
    requiresApproval: template.requiresApproval,
    stages: template.stages,
    triggers: mode === "yaml" ? [...template.triggers, "yaml"] : template.triggers,
    owner,
    variables: frontendTemplateValues.variables,
    runtimeVariables,
    caches: cachesFromTemplate(template, repositoryName),
    serviceConnections,
    buildConfig: frontendTemplateValues.buildConfig,
    imageArtifact,
    packageUpload: frontendTemplateValues.packageUpload,
  };
}

function buildConfigFromTemplate(template: PipelineTemplate): PipelineBuildConfig {
  const outputPaths = template.buildConfig.packageOutputPaths?.length
    ? template.buildConfig.packageOutputPaths
    : DEFAULT_PIPELINE_BUILD_CONFIG.packageOutputPaths;
  return {
    ...DEFAULT_PIPELINE_BUILD_CONFIG,
    ...template.buildConfig,
    packageMode: template.packageMode,
    runtime: template.buildConfig.runtime ?? (template.language === "go" ? "go" : "node"),
    packageOutputPaths: outputPaths,
  };
}

function imageArtifactFromTemplate(
  template: PipelineTemplate,
  applicationId: string,
  repositoryName: string,
): ImageArtifactConfig {
  const base = defaultImageArtifactConfig({
    applicationId,
    name: repositoryName,
    serviceConnections: template.serviceConnections,
  });
  return {
    ...base,
    ...template.imageArtifact,
    imageName: template.imageArtifact?.imageName ?? sanitizeTemplateImageName(repositoryName),
    serviceConnection: template.imageArtifact?.serviceConnection ?? template.serviceConnections?.[0] ?? base.serviceConnection,
  };
}

function variablesFromTemplate(template: PipelineTemplate, applicationId: string): GlobalParam[] {
  const languageEnv =
    template.language === "go"
      ? [
          {
            key: "GO_ENV",
            value: template.environment,
            description: "Go 构建运行环境。",
            injectionTiming: "build" as const,
            targetStages: ["test", "build", "package"] as LifecycleStageKey[],
          },
        ]
      : [
          {
            key: "NODE_ENV",
            value: template.environment === "prod" ? "production" : template.environment,
            description: "构建时环境标识",
            injectionTiming: "build" as const,
            targetStages: ["test", "build", "package"] as LifecycleStageKey[],
          },
        ];
  return [
    ...languageEnv,
    {
      key: "IMAGE_TAG",
      value: "${run.id}-${commit.short}",
      description: "构建产物版本",
      injectionTiming: "build" as const,
      targetStages: ["build", "upload", "deploy"] as LifecycleStageKey[],
    },
    {
      key: "DEPLOY_NAMESPACE",
      value: `${applicationId}-${template.environment}`,
      description: "部署命名空间",
      injectionTiming: "deploy" as const,
      targetStages: ["deploy", "canary", "promote"] as LifecycleStageKey[],
    },
    ...(template.variables ?? []),
  ];
}

function cachesFromTemplate(template: PipelineTemplate, repositoryName: string): PipelineCacheConfig[] {
  if (template.caches?.length) return template.caches;
  if (template.language === "go") {
    return [
      {
        key: `${repositoryName}-go-build`,
        path: ".cache/go-build",
        restoreKeys: [`${repositoryName}-`, "go-"],
        enabled: true,
      },
    ];
  }
  return [
    {
      key: `${repositoryName}-pnpm-store`,
      path: "node_modules/.pnpm-store",
      restoreKeys: [`${repositoryName}-`, "node-"],
      enabled: true,
    },
  ];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function sanitizeTemplateImageName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^\/+|\/+$/g, "") || "application";
}

export type { Surface };

function defaultTagPatterns(tags: string[], repositoryName: string): string[] {
  const prefixes = tags
    .map((tag) => tag.match(/^[a-zA-Z-]+/)?.[0])
    .filter((prefix): prefix is string => Boolean(prefix))
    .map((prefix) => `${prefix}*`);
  return Array.from(new Set([...prefixes, "v*", `${repositoryName}-*`, "release-*"]));
}

function packageModeFromRunArtifact(run: PipelineRun | undefined, artifact: Artifact | undefined): PackageMode {
  return run?.definitionSnapshot.buildConfig?.packageMode ?? (artifact?.type === "image" ? "container_image" : "static_site");
}

function defaultRolloutStrategyForPackageMode(
  packageMode: PackageMode,
  applicationName: string,
  environment: EnvironmentType,
): RolloutStrategyConfig {
  const releaseName = normalizeReleaseName(applicationName);
  if (packageMode === "static_site") {
    return {
      packageMode,
      policy: {
        enabled: true,
        cohorts: ["internal", "beta", "public"],
        entryPath: "/",
        cdnProvider: "aliyun-oss",
        cacheTtlSeconds: 60,
        rollbackOnFailure: true,
      },
    };
  }
  if (packageMode === "server_package") {
    return {
      packageMode,
      policy: {
        enabled: true,
        batches: [10, 25, 50, 100],
        healthCheckPath: "/health",
        instanceSelector: `env=${environment}`,
        maxUnavailable: 1,
        rollbackOnFailure: true,
      },
    };
  }
  if (packageMode === "kubernetes_manifest") {
    return {
      packageMode,
      policy: {
        enabled: true,
        controller: "deployment",
        workloadName: releaseName,
        steps: [10, 25, 50, 100],
        analysisWindowSeconds: 300,
        rollbackOnFailure: true,
      },
    };
  }
  if (packageMode === "helm_chart") {
    return {
      packageMode,
      policy: {
        enabled: true,
        releaseName,
        chart: "./chart",
        namespace: `${releaseName}-${environment}`,
        valuesPath: "values.yaml",
        steps: [10, 25, 50, 100],
        rollbackOnFailure: true,
      },
    };
  }
  return {
    packageMode,
    policy: {
      enabled: true,
      steps: [10, 25, 50, 100],
      autoPromote: false,
      analysisWindowSeconds: 300,
      minSuccessRate: 99,
      maxErrorRate: 1,
      maxP95LatencyMs: 800,
      rollbackOnFailure: true,
    },
  };
}

function normalizeReleaseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "application";
}

function normalizeCanaryRegionsForRequest(regions: CanaryTrafficRegion[]): CanaryTrafficRegion[] {
  const normalized = regions
    .map((region) => ({
      id: region.id.trim(),
      name: region.name.trim(),
      enabled: region.enabled,
      percent: Math.max(0, Math.min(100, Math.round(region.percent))),
    }))
    .filter((region) => region.enabled && region.id.length > 0 && region.name.length > 0 && region.percent > 0);
  return normalized.length > 0
    ? normalized
    : [{ id: "cn-hangzhou", name: "华东1（杭州）", percent: 10, enabled: true }];
}
