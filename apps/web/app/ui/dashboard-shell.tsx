"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSelectedLayoutSegments } from "next/navigation";
import {
  LIFECYCLE_STAGES,
  type CreatePipelineRequest,
  type LifecycleStageKey,
  type PipelineDefinition,
  type PipelineRun,
  type PlatformSnapshot,
  type UpdatePipelineRequest,
} from "@deploy-management/shared";
import { useSnapshot } from "../lib/snapshot-context";
import { cancelRun, createPipeline, deletePipeline, promoteRun, triggerPipeline, updatePipeline } from "../lib/actions";
import { ActionToast, copyText } from "./components/primitives";
import { CloudTopbar } from "./layouts/cloud-topbar";
import { RepoSidebar } from "./layouts/repo-sidebar";
import { FlowSidebar } from "./layouts/flow-sidebar";
import { PipelineLanding } from "./sections/pipeline-landing";
import { PipelineList } from "./sections/pipeline-list";
import { TemplateModal } from "./sections/template-modal";
import { PipelineRunDetail } from "./sections/pipeline-run-detail";
import { PipelineConfigEditor, type RunConfig } from "./sections/pipeline-config-editor";
import { RunLaunchDialog } from "./sections/run-launch-dialog";
import { pipelineTemplates, type PipelineConfigTab, type PipelineTemplate, type TemplateMode } from "./data/templates";

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
  const [configTab, setConfigTab] = useState<PipelineConfigTab>("basic");
  const [runLaunchPipeline, setRunLaunchPipeline] = useState<PipelineDefinition | null>(null);
  const [runLaunchConfig, setRunLaunchConfig] = useState<RunConfig | null>(null);
  const [notice, setNotice] = useState("");
  const [flowNavKey, setFlowNavKey] = useState("list");
  const [runConfig, setRunConfig] = useState<RunConfig>({
    repositoryId: "repo-mall-api",
    refType: "branch",
    refName: "main",
    environment: "prod",
    canaryPercent: 20,
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

  const createFromTemplate = async (templateKey = selectedTemplateKey) => {
    if (!snapshot) return;
    const template = pipelineTemplates.find((item) => item.key === templateKey) ?? pipelineTemplates[0];
    const request = createRequestFromTemplate(template, snapshot, templateMode);
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
    setConfigTab("source");
    await reload();
    router.push(`/pipelines/${pipeline.id}/edit`);
    notify("流水线已创建，进入配置界面");
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
    const run = await triggerPipeline(pipeline.id, { ...config, actor: "RO" });
    setRunLaunchPipeline(null);
    setRunLaunchConfig(null);
    await reload();
    router.push(`/runs/${run.id}`);
    notify("流水线已触发，正在生成 PipelineRun");
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

  const handleFlowNav = (key: string, label: string) => {
    setFlowNavKey(key);
    if (key === "list" || key === "all" || key === "groups" || key === "ungrouped") {
      router.push("/pipelines");
      notify(`${label}已切换`);
      return;
    }
    if (key === "runs" && selectedRun) {
      router.push(`/runs/${selectedRun.id}`);
      notify("已进入最近一次运行记录");
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
          setShowTemplateModal(true);
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
                setShowTemplateModal(true);
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
              <PipelineList
                snapshot={snapshot}
                query={query}
                onQueryChange={setQuery}
                selectedPipelineId={selectedPipeline?.id}
                onOpenTemplates={() => setShowTemplateModal(true)}
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
        </main>
      )}

      {showTemplateModal && (
        <TemplateModal
          snapshot={snapshot}
          selectedTemplateKey={selectedTemplateKey}
          onSelectTemplate={setSelectedTemplateKey}
          activeCategory={activeCategory}
          onChangeCategory={setActiveCategory}
          templateMode={templateMode}
          onChangeMode={setTemplateMode}
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

function createRequestFromTemplate(
  template: PipelineTemplate,
  snapshot: PlatformSnapshot,
  mode: TemplateMode,
): CreatePipelineRequest {
  const application = snapshot.applications.find((item) => item.id === template.applicationId) ?? snapshot.applications[0];
  const repository = snapshot.repositories.find((item) => item.id === template.repositoryId) ?? snapshot.repositories[0];
  const today = new Date().toISOString().slice(0, 10);
  return {
    name:
      template.key === "node-k8s-release"
        ? `流水线 ${today}`
        : `${repository.name}-${template.environment}-release`,
    applicationId: application.id,
    repositoryId: repository.id,
    refType: "branch",
    refName: repository.defaultBranch,
    sourcePolicy: {
      allowedBranchPatterns: [repository.defaultBranch, "release/*", "hotfix/*"],
      allowedTagPatterns: defaultTagPatterns(repository.tags, repository.name),
      allowRuntimeBranch: true,
      allowRuntimeTag: repository.tags.length > 0,
      allowRuntimeCommit: true,
    },
    targetEnvironment: template.environment,
    strategy: template.strategy,
    canaryPercent: template.canaryPercent,
    requiresApproval: template.requiresApproval,
    stages: template.stages,
    triggers: mode === "yaml" ? [...template.triggers, "yaml"] : template.triggers,
    owner: application.owner,
    variables: [
      { key: "NODE_ENV", value: template.environment === "prod" ? "production" : template.environment },
      { key: "IMAGE_TAG", value: "${run.id}-${commit.short}" },
      { key: "DEPLOY_NAMESPACE", value: `${application.id}-${template.environment}` },
    ],
    runtimeVariables: [{ key: "RELEASE_NOTE", value: "manual run" }],
    caches: [
      {
        key: `${repository.name}-pnpm-store`,
        path: "node_modules/.pnpm-store",
        restoreKeys: [`${repository.name}-`, "node-"],
        enabled: true,
      },
    ],
    serviceConnections: ["codeup-readonly", "acr-push", "ack-deploy"],
  };
}

export type { Surface };

function defaultTagPatterns(tags: string[], repositoryName: string): string[] {
  const prefixes = tags
    .map((tag) => tag.match(/^[a-zA-Z-]+/)?.[0])
    .filter((prefix): prefix is string => Boolean(prefix))
    .map((prefix) => `${prefix}*`);
  return Array.from(new Set([...prefixes, "v*", `${repositoryName}-*`, "release-*"]));
}
