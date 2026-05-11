"use client";

import { useEffect, useState } from "react";
import { Archive, CheckCircle2, GitBranch, Plus, Rocket, XCircle } from "lucide-react";
import {
  type EnvironmentType,
  type GitReferenceType,
  type LifecycleStageKey,
  type PipelineDefinition,
  type PipelineSourcePolicy,
  type PlatformSnapshot,
  type TriggerRunRequest,
  type UpdatePipelineRequest,
} from "@deploy-management/shared";
import { Field, Switch, VariableTable, WebhookField } from "../components/primitives";
import type { PipelineConfigTab } from "../data/templates";
import { environmentOptions } from "../data/templates";

export type RunConfig = Required<
  Pick<TriggerRunRequest, "repositoryId" | "refType" | "refName" | "environment" | "canaryPercent">
> & {
  stages: LifecycleStageKey[];
  commitSha?: string;
};

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
  const [savedAt, setSavedAt] = useState("");
  const [enabledStages, setEnabledStages] = useState<LifecycleStageKey[]>(pipeline.stages);
  const [triggers, setTriggers] = useState(pipeline.triggers.join("\n"));
  const [stringVariables, setStringVariables] = useState(
    pipeline.variables ?? [
      { key: "NODE_ENV", value: pipeline.targetEnvironment === "prod" ? "production" : pipeline.targetEnvironment },
      { key: "IMAGE_TAG", value: "${run.id}-${commit.short}" },
      { key: "DEPLOY_NAMESPACE", value: `${pipeline.applicationId}-${pipeline.targetEnvironment}` },
    ],
  );
  const [runtimeVariable, setRuntimeVariable] = useState(pipeline.runtimeVariables?.[0]?.value ?? "manual run");
  const [cachePath, setCachePath] = useState(pipeline.caches?.[0]?.path ?? "node_modules/.pnpm-store");
  const [buildCluster, setBuildCluster] = useState("vpc");
  const [buildNode, setBuildNode] = useState("linux-amd64");
  const [containerImage, setContainerImage] = useState("build-steps/alinux3");
  const [privateRegistry, setPrivateRegistry] = useState(true);
  const [serviceConnection, setServiceConnection] = useState(pipeline.serviceConnections?.[1] ?? "acr-push");
  const [downloadMode, setDownloadMode] = useState("all");
  const [useLocalEslint, setUseLocalEslint] = useState(false);
  const [timerSchedule, setTimerSchedule] = useState("daily");
  const [maxConcurrency, setMaxConcurrency] = useState(1);
  const [tagValue, setTagValue] = useState("nodejs");
  const [groupValue, setGroupValue] = useState("backend");
  const [taskSteps, setTaskSteps] = useState<string[]>(["checkout", "install", "run"]);
  const [variableGroupRows, setVariableGroupRows] = useState<string[][]>([
    ["NODE_COMMON", "true", "Node.js 通用变量", "否", "自动注入", "已启用"],
  ]);
  const [runtimeRows, setRuntimeRows] = useState<string[][]>([
    ["RELEASE_NOTE", runtimeVariable, "运行时发布说明", "manual run / release tag", "编辑"],
  ]);
  const [allowedBranchPatterns, setAllowedBranchPatterns] = useState(
    (pipeline.sourcePolicy?.allowedBranchPatterns ?? [pipeline.defaultBranch]).join("\n"),
  );
  const [allowedTagPatterns, setAllowedTagPatterns] = useState((pipeline.sourcePolicy?.allowedTagPatterns ?? ["v*"]).join("\n"));
  const [allowRuntimeBranch, setAllowRuntimeBranch] = useState(pipeline.sourcePolicy?.allowRuntimeBranch ?? true);
  const [allowRuntimeTag, setAllowRuntimeTag] = useState(pipeline.sourcePolicy?.allowRuntimeTag ?? true);
  const [allowRuntimeCommit, setAllowRuntimeCommit] = useState(pipeline.sourcePolicy?.allowRuntimeCommit ?? true);

  const repository = snapshot.repositories.find((item) => item.id === runConfig.repositoryId) ?? snapshot.repositories[0];
  const recentCommits = repository.recentCommits ?? [];
  const selectedCommit = recentCommits.find((commit) => commit.sha === runConfig.commitSha);
  const refOptions = runConfig.refType === "branch" ? repository.branches : repository.tags;
  const sourcePolicy = buildSourcePolicy(
    allowedBranchPatterns,
    allowedTagPatterns,
    allowRuntimeBranch,
    allowRuntimeTag,
    allowRuntimeCommit,
    repository.defaultBranch,
  );
  const title = pipeline.name.startsWith("流水线") ? pipeline.name : "流水线 2026-05-08";
  const incompleteCount = [
    !pipelineName.trim(),
    !runConfig.repositoryId,
    !runConfig.refName,
    sourcePolicy.allowedBranchPatterns.length === 0,
    runConfig.refType === "tag" && sourcePolicy.allowedTagPatterns.length === 0,
    enabledStages.length < 2,
    !buildCluster,
    !serviceConnection,
    !cachePath.trim(),
    triggers.trim().length === 0,
  ].filter(Boolean).length;
  const tektonBinding = snapshot.tekton.bindings.find((item) => item.pipelineId === pipeline.id);
  const tabs: Array<{ key: PipelineConfigTab; label: string }> = [
    { key: "basic", label: "基本信息" },
    { key: "source", label: "流水线源" },
    { key: "flow", label: "流程配置" },
    { key: "trigger", label: "触发设置" },
    { key: "variables", label: "变量和缓存" },
  ];

  const updateRunRefType = (refType: GitReferenceType) => {
    setRunConfig({
      ...runConfig,
      refType,
      refName: refType === "branch" ? repository.defaultBranch : repository.tags[0] ?? repository.defaultBranch,
      commitSha: undefined,
    });
  };

  useEffect(() => {
    setPipelineName(pipeline.name);
    setEnabledStages(pipeline.stages);
    setTriggers(pipeline.triggers.join("\n"));
    setStringVariables(
      pipeline.variables ?? [
        { key: "NODE_ENV", value: pipeline.targetEnvironment === "prod" ? "production" : pipeline.targetEnvironment },
        { key: "IMAGE_TAG", value: "${run.id}-${commit.short}" },
        { key: "DEPLOY_NAMESPACE", value: `${pipeline.applicationId}-${pipeline.targetEnvironment}` },
      ],
    );
    setRuntimeVariable(pipeline.runtimeVariables?.[0]?.value ?? "manual run");
    setRuntimeRows([["RELEASE_NOTE", pipeline.runtimeVariables?.[0]?.value ?? "manual run", "运行时发布说明", "manual run / release tag", "编辑"]]);
    setCachePath(pipeline.caches?.[0]?.path ?? "node_modules/.pnpm-store");
    setServiceConnection(pipeline.serviceConnections?.[1] ?? "acr-push");
    setAllowedBranchPatterns((pipeline.sourcePolicy?.allowedBranchPatterns ?? [pipeline.defaultBranch]).join("\n"));
    setAllowedTagPatterns((pipeline.sourcePolicy?.allowedTagPatterns ?? ["v*"]).join("\n"));
    setAllowRuntimeBranch(pipeline.sourcePolicy?.allowRuntimeBranch ?? true);
    setAllowRuntimeTag(pipeline.sourcePolicy?.allowRuntimeTag ?? true);
    setAllowRuntimeCommit(pipeline.sourcePolicy?.allowRuntimeCommit ?? true);
  }, [pipeline.id, pipeline]);

  const toggleStage = (stage: LifecycleStageKey) => {
    if (stage === "source") return;
    const next = enabledStages.includes(stage)
      ? enabledStages.filter((item) => item !== stage)
      : [...enabledStages, stage];
    setEnabledStages(next);
    setRunConfig({ ...runConfig, stages: next });
  };

  const selectRepository = (repositoryId: string) => {
    const nextRepository = snapshot.repositories.find((item) => item.id === repositoryId) ?? repository;
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

  const selectRefName = (refName: string) => {
    setRunConfig({ ...runConfig, refName, commitSha: undefined });
  };

  const selectCommit = (commitSha: string) => {
    setRunConfig({ ...runConfig, commitSha: commitSha || undefined });
  };

  const activateStage = (stage: LifecycleStageKey) => {
    const next = enabledStages.includes(stage) ? enabledStages : [...enabledStages, stage];
    setEnabledStages(next);
    setRunConfig({ ...runConfig, stages: next });
  };

  const buildPipelinePatch = (): UpdatePipelineRequest => ({
    name: pipelineName,
    repositoryId: repository.id,
    refType: runConfig.refType,
    refName: runConfig.refName,
    sourcePolicy,
    targetEnvironment: runConfig.environment,
    strategy: pipeline.strategy,
    canaryPercent: runConfig.canaryPercent,
    requiresApproval: pipeline.requiresApproval,
    stages: enabledStages,
    triggers: [
      ...triggers.split("\n").map((trigger) => trigger.trim()).filter(Boolean),
      ...(timerEnabled ? [`cron ${timerSchedule}`] : []),
      ...(concurrencyEnabled ? [`concurrency ${maxConcurrency}`] : []),
    ],
    owner: pipeline.owner,
    variables: stringVariables,
    runtimeVariables: [{ key: "RELEASE_NOTE", value: runtimeVariable }],
    caches: [
      {
        key: `${repository.name}-cache`,
        path: cachePath,
        restoreKeys: [`${repository.name}-`, "node-"],
        enabled: cachePath.trim().length > 0,
      },
    ],
    serviceConnections: ["codeup-readonly", serviceConnection, "ack-deploy"],
  });

  const taskStageMap: Record<string, LifecycleStageKey> = {
    "JavaScript 代码扫描": "test",
    "Node.js 单元测试": "test",
    "Node.js 构建": "build",
    "镜像构建并推送": "upload",
    "注入环境变量": "env",
    "生成 SBOM 与证明": "package",
    "Kubernetes 发布": "deploy",
    "灰度观测": "canary",
    "人工审批门禁": "approval",
    "全量发布": "promote",
    "拉取代码": "source",
  };

  const selectTask = (taskName: string, stage: LifecycleStageKey) => {
    setSelectedTask(taskName);
    activateStage(stage);
    onNotify(`${taskName} 已选中`);
  };

  const removeSelectedTask = () => {
    const stage = taskStageMap[selectedTask];
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
    const nextTask = enabledStages.includes("approval") ? "全量发布" : "人工审批门禁";
    const nextStage = nextTask === "全量发布" ? "promote" : "approval";
    selectTask(nextTask, nextStage);
  };

  const addStep = () => {
    setTaskSteps([...taskSteps, `custom-step-${taskSteps.length + 1}`]);
    onNotify("任务步骤已添加");
  };

  const deletePipeline = async () => {
    if (!window.confirm(`确认删除流水线 ${pipeline.name}？`)) return;
    await onDeletePipeline();
  };

  const saveDraft = async () => {
    const updated = await onSavePipeline(buildPipelinePatch());
    setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    return updated;
  };

  const saveAndRun = async () => {
    const updated = await saveDraft();
    onSaveRun(updated, { ...runConfig, stages: enabledStages });
  };

  const taskMissingConfig = !buildCluster || !serviceConnection;
  const taskClass = (stage: LifecycleStageKey, taskName: string, invalid = false) =>
    [
      "flow-task-pill",
      selectedTask === taskName ? "selected" : "",
      enabledStages.includes(stage) ? "enabled" : "disabled",
      invalid ? "invalid" : "",
    ]
      .filter(Boolean)
      .join(" ");

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
        <div className="pipeline-config-layout">
          <aside className="pipeline-config-side">
            <button className={basicSide === "basic" ? "active" : ""} onClick={() => setBasicSide("basic")}>
              基本配置
            </button>
            <button className={basicSide === "members" ? "active" : ""} onClick={() => setBasicSide("members")}>
              成员信息
            </button>
          </aside>
          <main className="pipeline-config-content">
            {basicSide === "basic" ? (
              <>
                <h2>基本配置</h2>
                <div className="config-section-bar">流水线信息</div>
                <div className="basic-form">
                  <Field label="流水线名称">
                    <div className="counted-input">
                      <input
                        value={pipelineName}
                        maxLength={60}
                        onChange={(event) => setPipelineName(event.target.value)}
                      />
                      <span>{pipelineName.length}/60</span>
                    </div>
                  </Field>
                  <Field label="流水线 ID">
                    <div className="disabled-copy-input">
                      <input value={pipeline.id.replace("pipe-", "w4wmfxgwbgbe8wp9").slice(0, 16)} readOnly />
                      <button
                        type="button"
                        aria-label="复制流水线 ID"
                        onClick={() => void onCopy(pipeline.id, "流水线 ID")}
                      >
                        <Archive size={16} />
                      </button>
                    </div>
                  </Field>
                  <Field label="环境">
                    <select
                      value={runConfig.environment}
                      onChange={(event) =>
                        setRunConfig({ ...runConfig, environment: event.target.value as EnvironmentType })
                      }
                    >
                      <option value="dev">无</option>
                      {environmentOptions.map((environment) => (
                        <option key={environment} value={environment}>
                          {environment}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="标签">
                    <select value={tagValue} onChange={(event) => setTagValue(event.target.value)}>
                      <option value="">请选择</option>
                      <option value="prod">prod</option>
                      <option value="nodejs">nodejs</option>
                    </select>
                  </Field>
                  <Field label="分组">
                    <select value={groupValue} onChange={(event) => setGroupValue(event.target.value)}>
                      <option value="ungrouped">未分组</option>
                      <option value="backend">后端发布</option>
                    </select>
                  </Field>
                  <Field label="流水线源">
                    <button
                      type="button"
                      className="source-summary-button"
                      onClick={() => setActiveTab("source")}
                    >
                      <strong>{repository.provider}/{repository.name}</strong>
                      <span>{runConfig.refType} / {runConfig.refName}</span>
                    </button>
                  </Field>
                </div>
                <div className="config-section-bar danger">删除流水线</div>
                <button className="delete-pipeline-button" onClick={() => void deletePipeline()}>
                  删除流水线
                </button>
              </>
            ) : (
              <div className="members-panel">
                <h2>成员信息</h2>
                <div className="member-row">
                  <strong>拥有者</strong>
                  <span>{pipeline.owner}</span>
                  <em>可编辑和运行</em>
                </div>
                <div className="member-row">
                  <strong>RO</strong>
                  <span>当前用户</span>
                  <em>可保存并运行</em>
                </div>
                <div className="member-row">
                  <strong>SRE-王林</strong>
                  <span>审批人</span>
                  <em>生产全量门禁</em>
                </div>
              </div>
            )}
          </main>
        </div>
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
                <p>{repository.url}</p>
              </div>
              <div className="source-hero-meta">
                <strong>{runConfig.refType}</strong>
                <span>{runConfig.refName}</span>
                <em>{runConfig.commitSha ? `commit ${runConfig.commitSha.slice(0, 12)}` : "运行时可解析最新提交"}</em>
              </div>
            </div>

            {sourceSide === "repository" && (
              <section className="source-config-grid">
                <Field label="代码仓库">
                  <select value={repository.id} onChange={(event) => selectRepository(event.target.value)}>
                    {snapshot.repositories.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.provider}/{item.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="仓库地址">
                  <div className="disabled-copy-input">
                    <input value={repository.url} readOnly />
                    <button type="button" aria-label="复制仓库地址" onClick={() => void onCopy(repository.url, "仓库地址")}>
                      <Archive size={16} />
                    </button>
                  </div>
                </Field>
                <Field label="默认分支">
                  <input value={repository.defaultBranch} readOnly />
                </Field>
                <Field label="负责人">
                  <input value={repository.owner} readOnly />
                </Field>
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
                  <select value={runConfig.refName} onChange={(event) => selectRefName(event.target.value)}>
                    {refOptions.map((ref) => (
                      <option key={ref} value={ref}>
                        {ref}
                      </option>
                    ))}
                  </select>
                </Field>
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
            <div className="flow-config-board">
              <section className="flow-stage-lane source">
                <h2>流水线源</h2>
                <div className="source-config-card">
                  <div className="source-pill">
                    <span className="codeup-mark mini">C</span>
                    <strong>{repository.provider}/{repository.name}</strong>
                    <Rocket size={16} />
                  </div>
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
                <h2>测试</h2>
                <button
                  className={taskClass("test", "JavaScript 代码扫描", taskMissingConfig)}
                  onClick={() => selectTask("JavaScript 代码扫描", "test")}
                >
                  JavaScript 代码扫描 <XCircle size={15} />
                </button>
                <button
                  className={taskClass("test", "Node.js 单元测试", taskMissingConfig)}
                  onClick={() => selectTask("Node.js 单元测试", "test")}
                >
                  Node.js 单元测试 <XCircle size={15} />
                </button>
              </section>
              <section className="flow-stage-lane">
                <h2>构建</h2>
                <button
                  className={taskClass("build", "Node.js 构建", taskMissingConfig)}
                  onClick={() => selectTask("Node.js 构建", "build")}
                >
                  Node.js 构建 <XCircle size={15} />
                </button>
                <button
                  className={taskClass("upload", "镜像构建并推送")}
                  onClick={() => selectTask("镜像构建并推送", "upload")}
                >
                  镜像构建并推送
                </button>
              </section>
              <section className="flow-stage-lane">
                <h2>变量</h2>
                <button
                  className={taskClass("env", "注入环境变量")}
                  onClick={() => selectTask("注入环境变量", "env")}
                >
                  注入环境变量
                </button>
                <button
                  className={taskClass("package", "生成 SBOM 与证明")}
                  onClick={() => selectTask("生成 SBOM 与证明", "package")}
                >
                  生成 SBOM 与证明
                </button>
              </section>
              <section className="flow-stage-lane">
                <h2>部署</h2>
                <button
                  className={taskClass("deploy", "Kubernetes 发布")}
                  onClick={() => selectTask("Kubernetes 发布", "deploy")}
                >
                  Kubernetes 发布
                </button>
                <button
                  className={taskClass("canary", "灰度观测")}
                  onClick={() => selectTask("灰度观测", "canary")}
                >
                  灰度观测 {pipeline.canaryPercent}%
                </button>
              </section>
              <section className="flow-stage-lane muted">
                <h2>新阶段</h2>
                <button className="new-task-button" onClick={addNewTask}>
                  <Plus size={15} />
                  新的任务
                </button>
              </section>
            </div>
          </div>
          <aside className="task-config-panel">
            <div className="task-config-head">
              <strong>编辑</strong>
              <button
                className="plain-icon"
                aria-label="复制任务配置"
                onClick={() =>
                  void onCopy(
                    JSON.stringify({ task: selectedTask, image: containerImage, node: buildNode }, null, 2),
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
              <Field label="任务名称">
                <input value={selectedTask} onChange={(event) => setSelectedTask(event.target.value)} />
              </Field>
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
              <p className="field-help">VPC构建的费用更优惠，构建核分按0.8系数来结算。</p>
              {!buildCluster && <p className="field-error">构建集群不能为空</p>}
              <Field label="指定构建节点">
                <select value={buildNode} onChange={(event) => setBuildNode(event.target.value)}>
                  <option value="linux-amd64">Linux.amd64</option>
                  <option value="linux-arm64">Linux.arm64</option>
                </select>
              </Field>
              <h3>构建环境</h3>
              <Field label="容器镜像地址">
                <select value={containerImage} onChange={(event) => setContainerImage(event.target.value)}>
                  <option value="build-steps/alinux3">build-steps/alinux3</option>
                  <option value="node:20-alpine">node:20-alpine</option>
                </select>
              </Field>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={privateRegistry}
                  onChange={(event) => setPrivateRegistry(event.target.checked)}
                />{" "}
                使用私有镜像仓库
              </label>
              <Field label="选择服务连接">
                <select
                  className={serviceConnection ? "" : "invalid-select"}
                  value={serviceConnection}
                  onChange={(event) => setServiceConnection(event.target.value)}
                >
                  <option value="">请选择</option>
                  <option value="acr-push">ACR 服务连接</option>
                  <option value="ack-deploy">ACK 部署连接</option>
                </select>
              </Field>
              {!serviceConnection && <p className="field-error">选择服务连接不能为空</p>}
              <Field label="下载流水线源">
                <select value={downloadMode} onChange={(event) => setDownloadMode(event.target.value)}>
                  <option value="all">下载全部流水线源</option>
                  <option value="current">仅下载当前源</option>
                </select>
              </Field>
              <div className="task-step-head">
                <strong>任务步骤</strong>
                <button type="button" onClick={addStep}>
                  <Plus size={14} />
                  添加步骤
                </button>
              </div>
              <div className="task-step-block">
                <strong>{selectedTask}</strong>
                <Field label="步骤名称">
                  <input value={selectedTask} readOnly />
                </Field>
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={useLocalEslint}
                    onChange={(event) => setUseLocalEslint(event.target.checked)}
                  />{" "}
                  是否使用本地 ESLint 配置
                </label>
                <div className="task-step-list">
                  {taskSteps.map((step, index) => (
                    <span key={`${step}-${index}`}>
                      <strong>{step}</strong>
                      <button
                        type="button"
                        onClick={() => setTaskSteps(taskSteps.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        移除
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
                  <strong>{selectedTask.toLowerCase().replace(/\s+/g, "-")}</strong>
                  <span>serviceAccount</span>
                  <strong>{tektonBinding?.serviceAccountName ?? "tekton-builder"}</strong>
                  <span>workspace</span>
                  <strong>{tektonBinding?.workspaces.slice(0, 2).join(", ") ?? "source-ws, cache-ws"}</strong>
                </div>
                <div className="tekton-workspace-list">
                  {(tektonBinding?.workspaceBindings ?? []).slice(0, 4).map((workspace) => (
                    <span key={workspace.name}>
                      <strong>{workspace.name}</strong>
                      <em>{workspace.type}</em>
                      <small>{workspace.description}</small>
                    </span>
                  ))}
                </div>
                <div className="tekton-task-graph">
                  {(tektonBinding?.taskGraph ?? []).map((task) => (
                    <span key={task.name}>
                      <strong>{task.name}</strong>
                      <em>{task.runAfter.length > 0 ? `after ${task.runAfter.join(",")}` : "entrypoint"}</em>
                      <small>{task.workspaces.join(" / ") || "no workspace"}</small>
                    </span>
                  ))}
                </div>
                <div className="tekton-param-list">
                  {(tektonBinding?.params ?? []).map((param) => (
                    <span key={param.key}>
                      <strong>{param.key}</strong>
                      <em>{param.value}</em>
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
                  value="https://newdemo123-cn-hangzhou.devops.aliyuncs.com/pipeline/webhook/9NFPeRpnh6kgID7S23vC"
                  onCopy={onCopy}
                />
                <WebhookField
                  label="流水线源Webhook"
                  value="https://newdemo123-cn-hangzhou.devops.aliyuncs.com/scm/webhook/9NFPeRpnh6kgID7S23vC"
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
                              { key: `CUSTOM_${stringVariables.length + 1}`, value: "" },
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
                        <span>描述</span>
                        <span>私密</span>
                        {stringVariables.map((variable, index) => (
                          <div className="variable-editor-row" key={`${variable.key}-${index}`}>
                            <input
                              value={variable.key}
                              onChange={(event) =>
                                setStringVariables(
                                  stringVariables.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, key: event.target.value } : item,
                                  ),
                                )
                              }
                            />
                            <input
                              value={variable.value}
                              onChange={(event) =>
                                setStringVariables(
                                  stringVariables.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, value: event.target.value } : item,
                                  ),
                                )
                              }
                            />
                            <input
                              value={variable.description ?? ""}
                              onChange={(event) =>
                                setStringVariables(
                                  stringVariables.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, description: event.target.value } : item,
                                  ),
                                )
                              }
                            />
                            <label>
                              <input
                                type="checkbox"
                                checked={Boolean(variable.encrypted)}
                                onChange={(event) =>
                                  setStringVariables(
                                    stringVariables.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, encrypted: event.target.checked } : item,
                                    ),
                                  )
                                }
                              />
                            </label>
                          </div>
                        ))}
                      </div>
                    </section>
                    <Field label="运行时变量 RELEASE_NOTE">
                      <input value={runtimeVariable} onChange={(event) => setRuntimeVariable(event.target.value)} />
                    </Field>
                  </>
                ) : (
                  <>
                    <VariableTable
                      title="通用变量组"
                      columns={["变量名称", "默认值", "描述", "私密模式", "运行时设置", "操作"]}
                      rows={variableGroupRows}
                      onCreate={() => {
                        setVariableGroupRows([
                          ...variableGroupRows,
                          [`GROUP_${variableGroupRows.length + 1}`, "enabled", "共享变量组", "否", "自动注入", "已启用"],
                        ]);
                        onNotify("通用变量组已新增");
                      }}
                    />
                    <VariableTable
                      title="运行选择变量"
                      columns={["变量名称", "默认值", "描述", "选项", "操作"]}
                      rows={runtimeRows.map((row) => (row[0] === "RELEASE_NOTE" ? [row[0], runtimeVariable, ...row.slice(2)] : row))}
                      onCreate={() => {
                        setRuntimeRows([
                          ...runtimeRows,
                          [`CHOICE_${runtimeRows.length + 1}`, "blue", "运行时选择", "blue / green", "编辑"],
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

function buildSourcePolicy(
  branchPatterns: string,
  tagPatterns: string,
  allowRuntimeBranch: boolean,
  allowRuntimeTag: boolean,
  allowRuntimeCommit: boolean,
  defaultBranch: string,
): PipelineSourcePolicy {
  const branches = normalizePatternText(branchPatterns);
  return {
    allowedBranchPatterns: branches.length > 0 ? branches : [defaultBranch],
    allowedTagPatterns: normalizePatternText(tagPatterns),
    allowRuntimeBranch,
    allowRuntimeTag,
    allowRuntimeCommit,
  };
}

function normalizePatternText(value: string): string[] {
  return Array.from(new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)));
}

function defaultTagPatterns(tags: string[], repositoryName: string): string[] {
  const prefixes = tags
    .map((tag) => tag.match(/^[a-zA-Z-]+/)?.[0])
    .filter((prefix): prefix is string => Boolean(prefix))
    .map((prefix) => `${prefix}*`);
  return Array.from(new Set([...prefixes, "v*", `${repositoryName}-*`, "release-*"]));
}
