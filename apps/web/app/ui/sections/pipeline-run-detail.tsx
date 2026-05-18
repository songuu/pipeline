"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Code2, Copy, MoreHorizontal, PackageCheck, Terminal, X } from "lucide-react";
import {
  DEFAULT_PIPELINE_BUILD_CONFIG,
  resolveImageArtifact,
  type LifecycleStageKey,
  type PipelineDefinition,
  type PipelineRun,
  type PlatformSnapshot,
  type StoredRunEvent,
  type TektonTaskRunDetail,
  type TektonTaskRunLogs,
} from "@deploy-management/shared";
import { fetchRunEvents, fetchTektonTaskRunDetail, fetchTektonTaskRunLogs } from "../../lib/api";
import { env } from "../../lib/env";
import { JobCard } from "../components/job-card";
import { StatusBadge, Summary } from "../components/primitives";
import { ReleaseEventMiniTimeline, ReleaseEventTimeline, sortReleaseEvents } from "../components/release-event-timeline";
import { PipelineFlowCanvas } from "../graph/pipeline-flow-canvas";
import { pipelineRunToGraph } from "../graph/pipeline-graph-adapter";

interface PipelineRunDetailProps {
  snapshot: PlatformSnapshot;
  run: PipelineRun;
  pipeline: PipelineDefinition;
  onEdit: () => void;
  onBack: () => void;
  onRun: () => void;
  onSelectRun: (runId: string) => void;
  onCancel: (runId: string) => Promise<void>;
  onPromote: (runId: string) => Promise<void>;
  onCopy: (value: string, label: string) => void;
  onNotify: (message: string) => void;
}

export function PipelineRunDetail({
  snapshot,
  run,
  pipeline,
  onEdit,
  onBack,
  onRun,
  onSelectRun,
  onCancel,
  onPromote,
  onCopy,
  onNotify,
}: PipelineRunDetailProps) {
  const groups = groupRunStages(run);
  const [selectedStageKey, setSelectedStageKey] = useState<LifecycleStageKey>(run.stages[0]?.key ?? "source");
  const [expandedExecutionStageKey, setExpandedExecutionStageKey] = useState<LifecycleStageKey | "">(
    run.stages[0]?.key ?? "source",
  );
  const [activeRunTab, setActiveRunTab] = useState<"latest" | "history">("latest");
  const [sourceVisible, setSourceVisible] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [copiedArtifactId, setCopiedArtifactId] = useState("");
  const [copiedCommandId, setCopiedCommandId] = useState("");
  const [liveRunEvents, setLiveRunEvents] = useState<StoredRunEvent[]>([]);
  const [selectedStepName, setSelectedStepName] = useState("");
  const [taskRunDetail, setTaskRunDetail] = useState<TektonTaskRunDetail | null>(null);
  const [taskRunLogs, setTaskRunLogs] = useState<TektonTaskRunLogs | null>(null);
  const [taskRunError, setTaskRunError] = useState("");
  const [taskRunLoading, setTaskRunLoading] = useState(false);
  const [pipelineViewMode, setPipelineViewMode] = useState<"canvas" | "board">("canvas");
  const repository = snapshot.repositories.find((item) => item.id === run.repositoryId);
  const tektonRun = snapshot.tekton.runRecords.find((item) => item.runId === run.id);
  const tektonBinding = snapshot.tekton.bindings.find((item) => item.pipelineId === run.pipelineId);
  const executorBackend = tektonRun?.executorBackend ?? run.executor?.backend ?? snapshot.tekton.cluster.executorMode;
  const isSimulatedExecutor = executorBackend === "simulated";
  const isTektonExecutor = executorBackend === "tekton";
  const runArtifacts = snapshot.artifacts.filter((artifact) => artifact.runId === run.id);
  const imageArtifact = runArtifacts.find((artifact) => artifact.type === "image");
  const runReleases = snapshot.releases.filter((release) => release.runId === run.id);
  const runReleaseIds = new Set(runReleases.map((release) => release.id));
  const runReleaseEvents = sortReleaseEvents(
    snapshot.releaseEvents.filter((event) => event.runId === run.id || runReleaseIds.has(event.releaseId)),
  );
  const activeRelease = runReleases[0];
  const pipelineHistoryRuns = snapshot.runs
    .filter((item) => item.pipelineId === run.pipelineId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const selectedStage = run.stages.find((stage) => stage.key === selectedStageKey) ?? run.stages[0];
  const selectedTaskRun = tektonRun?.taskRuns.find((taskRun) => taskRun.pipelineTaskName === selectedStage?.key);
  const taskRunSteps = taskRunDetail?.steps ?? selectedTaskRun?.steps ?? [];
  const activeStepName = selectedStepName || taskRunSteps[0]?.name || "";
  const selectedTaskRunResults = Object.entries(taskRunDetail?.results ?? selectedTaskRun?.results ?? {});
  const taskRunLogLines = taskRunLogs?.lines ?? selectedStage?.logs ?? ["暂无日志"];
  const commandCountsByStage = useMemo(
    () => countCommandEventsByStage(liveRunEvents),
    [liveRunEvents],
  );
  const artifactCountsByStageMap = useMemo(
    () => artifactCountsByStage(runArtifacts, run),
    [runArtifacts, run.definitionSnapshot.stages],
  );
  const errorSummariesMap = useMemo(
    () => errorSummariesByStage(run.stages),
    [run.stages],
  );
  const taskRunNameMap = useMemo<Partial<Record<LifecycleStageKey, string>>>(
    () =>
      Object.fromEntries(
        (tektonRun?.taskRuns ?? []).map((tr) => [
          tr.pipelineTaskName as LifecycleStageKey,
          tr.taskRunName,
        ]),
      ),
    [tektonRun?.taskRuns],
  );
  const pipelineFlowGraph = useMemo(
    () =>
      pipelineRunToGraph(run, {
        commandCounts: commandCountsByStage as Partial<Record<LifecycleStageKey, number>>,
        artifactCounts: artifactCountsByStageMap,
        errorSummaries: errorSummariesMap,
        taskRunNames: taskRunNameMap,
      }),
    [run, commandCountsByStage, artifactCountsByStageMap, errorSummariesMap, taskRunNameMap],
  );
  const executionModelForStage = (stage: PipelineRun["stages"][number] | undefined) => {
    if (!stage) {
      return { commands: [] as StageExecutionCommand[], sourceLabel: "等待执行器", recorded: false };
    }
    const stageEvents = liveRunEvents.filter((event) => eventStageKey(event) === stage.key);
    const recordedCommands = commandEventsToExecutionCommands(stageEvents);
    const plannedCommands = plannedExecutionCommandsForStage({
      pipeline,
      repositoryUrl: repository?.url ?? run.repository,
      run,
      stage,
    });
    return recordedCommands.length > 0
      ? { commands: recordedCommands, sourceLabel: "流式返回", recorded: true }
      : { commands: plannedCommands, sourceLabel: "固定推演", recorded: false };
  };
  const selectedExecutionModel = executionModelForStage(selectedStage);
  const stageExecutionCommands = selectedExecutionModel.commands;
  const stageExecutionScript = executionScript(stageExecutionCommands);
  const executionSourceLabel = selectedExecutionModel.recorded ? "流式返回 · 实时命令事件" : "固定返回 · 运行前推演";
  const resolverRef = tektonRun?.pipelineSpecRef ?? tektonBinding?.resolverRef;
  const workspaceBindings = tektonRun?.workspaceBindings ?? tektonBinding?.workspaceBindings ?? [];
  const visibleResults = tektonRun?.results ?? [];
  const visibleEvents = tektonRun?.events ?? [];
  const activeStage =
    run.stages.find((stage) => stage.status === "running" || stage.status === "waiting") ??
    run.stages.find((stage) => stage.status === "pending") ??
    selectedStage;
  const variableCount =
    (run.definitionSnapshot.variables?.length ?? 0) + (run.definitionSnapshot.runtimeVariables?.length ?? 0);
  const runStateNote: Record<PipelineRun["status"], string> = {
    queued: "等待执行器分配资源",
    running: "控制面正在执行任务",
    waiting_approval: "灰度完成，等待审批",
    success: "全部任务已完成",
    failed: "失败任务阻断后续阶段",
    canceled: "已由用户取消，后续任务跳过",
  };

  useEffect(() => {
    if (!activeStage || !["queued", "running", "waiting_approval"].includes(run.status)) return;
    setSelectedStageKey(activeStage.key);
    setExpandedExecutionStageKey(activeStage.key);
  }, [activeStage?.key, run.status]);

  useEffect(() => {
    let closed = false;
    void fetchRunEvents(run.id)
      .then((events) => {
        if (!closed) setLiveRunEvents(events);
      })
      .catch(() => {
        if (!closed) setLiveRunEvents([]);
      });

    const eventSource = new EventSource(`${env.apiBase}/api/runs/${run.id}/events/stream`);
    eventSource.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as StoredRunEvent;
        setLiveRunEvents((current) =>
          current.some((item) => item.id === event.id) ? current : [...current, event].slice(-160),
        );
      } catch {
        // SSE 心跳或非 JSON 消息无需打扰用户，下一次有效事件会继续补上。
      }
    };
    eventSource.onerror = () => {
      eventSource.close();
    };
    return () => {
      closed = true;
      eventSource.close();
    };
  }, [run.id]);

  useEffect(() => {
    setSelectedStepName("");
    setTaskRunDetail(null);
    setTaskRunLogs(null);
    setTaskRunError("");
    if (!selectedTaskRun?.taskRunName || !isTektonExecutor) return;

    const controller = new AbortController();
    setTaskRunLoading(true);
    void fetchTektonTaskRunDetail(run.id, selectedTaskRun.taskRunName, { signal: controller.signal })
      .then((detail) => {
        setTaskRunDetail(detail);
        setSelectedStepName((current) => current || detail.steps[0]?.name || "");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setTaskRunError(describeUiError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setTaskRunLoading(false);
      });

    return () => controller.abort();
  }, [isTektonExecutor, run.id, selectedTaskRun?.taskRunName]);

  useEffect(() => {
    if (!selectedTaskRun?.taskRunName || !activeStepName || !isTektonExecutor) return;

    const controller = new AbortController();
    void fetchTektonTaskRunLogs(run.id, selectedTaskRun.taskRunName, activeStepName, { signal: controller.signal })
      .then((logs) => {
        setTaskRunLogs(logs);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setTaskRunError(describeUiError(error));
      });

    return () => controller.abort();
  }, [activeStepName, isTektonExecutor, run.id, selectedTaskRun?.taskRunName]);

  const copyArtifactAddress = (artifact: PlatformSnapshot["artifacts"][number]) => {
    const address = artifact.type === "image" ? artifactImageReference(artifact) : artifact.name;
    setCopiedArtifactId(artifact.id);
    window.setTimeout(() => setCopiedArtifactId((current) => (current === artifact.id ? "" : current)), 1500);
    void onCopy(address, artifact.type === "image" ? "镜像地址" : "产物地址");
  };

  const copyImagePullCommand = (artifact: PlatformSnapshot["artifacts"][number]) => {
    setCopiedArtifactId(`${artifact.id}:pull`);
    window.setTimeout(
      () => setCopiedArtifactId((current) => (current === `${artifact.id}:pull` ? "" : current)),
      1500,
    );
    void onCopy(`docker pull ${artifactImageReference(artifact)}`, "镜像拉取命令");
  };

  const copyExecutionText = (id: string, value: string, label: string) => {
    setCopiedCommandId(id);
    window.setTimeout(() => setCopiedCommandId((current) => (current === id ? "" : current)), 1500);
    void onCopy(value, label);
  };

  return (
    <section className={`run-detail-page run-${run.status}`}>
      <div className="run-topline">
        <button className="back-button" onClick={onBack} aria-label="返回流水线列表">
          ‹
        </button>
        <h1>
          流水线 <strong>{pipeline.name.replace("-prod-release", "")}</strong>
        </h1>
        <div className="run-tabs">
          <button className={activeRunTab === "latest" ? "active" : ""} onClick={() => setActiveRunTab("latest")}>
            最近运行
          </button>
          <button className={activeRunTab === "history" ? "active" : ""} onClick={() => setActiveRunTab("history")}>
            运行历史
          </button>
        </div>
        <div className="run-actions">
          <div className="avatar small-avatar">RO</div>
          <button className="cloud-secondary" onClick={onEdit}>
            编辑
          </button>
          <button className="yunxiao-primary" onClick={onRun}>
            运行
          </button>
          {run.status === "waiting_approval" && (
            <button className="yunxiao-primary approval-action" onClick={() => void onPromote(run.id)}>
              审批通过并全量
            </button>
          )}
          {["running", "waiting_approval", "queued"].includes(run.status) && (
            <button className="danger-button compact-action" onClick={() => void onCancel(run.id)}>
              取消运行
            </button>
          )}
          <div className="run-more-wrap">
            <button className="plain-icon" aria-label="更多操作" onClick={() => setMoreOpen((value) => !value)}>
              <MoreHorizontal size={18} />
            </button>
            {moreOpen && (
              <div className="action-menu run-action-menu">
                <button onClick={() => void onCopy(run.id, "运行 ID")}>复制运行 ID</button>
                <button onClick={() => void onCopy(tektonRun?.pipelineRunName ?? run.id, "PipelineRun 名称")}>
                  复制 PipelineRun
                </button>
                <button onClick={() => onNotify("日志面板已固定在右侧 Tekton Results 区域")}>查看日志位置</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {activeRunTab === "history" ? (
        <RunHistoryPanel
          activeRunId={run.id}
          runs={pipelineHistoryRuns}
          onOpenRun={(runId) => {
            setActiveRunTab("latest");
            onSelectRun(runId);
          }}
        />
      ) : (
        <>
          <div className="run-status-line">
            <div>
              <strong>#{run.id.replace("run-", "")}</strong>
              <StatusBadge status={run.status} />
              <em>{runStateNote[run.status]}</em>
            </div>
            <div className="run-live-progress" aria-label={`流水线执行进度 ${run.progress}%`}>
              <span>
                <i style={{ width: `${run.progress}%` }} />
              </span>
              <small>
                {activeStage ? `${activeStage.title} · ${activeStage.status === "running" ? "执行中" : activeStage.status}` : "等待调度"}
              </small>
            </div>
            <div className="trigger-meta">
              <span>触发信息</span>
              <strong>{run.actor} · 页面手动触发</strong>
              <span>开始时间</span>
              <strong>{run.createdAt.replace("T", " ").slice(0, 19)}</strong>
              <span>持续时间</span>
              <strong>
                {run.status === "failed" ? "3秒" : `${Math.max(1, Math.round(run.progress / 8))}秒`}
              </strong>
            </div>
            <div className="run-mini-stats">
              <Summary label="代码变更" value="0" />
              <Summary label="运行产物" value={String(runArtifacts.length)} />
              <Summary label="环境变量" value={String(variableCount)} />
            </div>
          </div>

          <div className={sourceVisible ? "run-canvas" : "run-canvas source-collapsed"}>
            {sourceVisible ? (
              <aside className="source-panel">
                <div className="source-head">
                  <span>流水线源 · 1</span>
                  <button className="plain-icon" aria-label="收起流水线源" onClick={() => setSourceVisible(false)}>
                    <X size={16} />
                  </button>
                </div>
                <div className="source-bound-card">
                  <strong>{repository?.name ?? run.repository}</strong>
                  <span>{repository?.provider ?? "codeup"} · {run.repository}</span>
                  <small>{run.refType} / {run.refName} · {run.commit.slice(0, 8)}</small>
                  <em>{tektonRun?.pipelineRunName ?? "等待生成 PipelineRun"}</em>
                </div>
                <div className="recent-run-list">
                  {pipelineHistoryRuns.slice(0, 4).map((item) => (
                    <button
                      key={item.id}
                      className={item.id === run.id ? "recent-run active" : "recent-run"}
                      onClick={() => onSelectRun(item.id)}
                    >
                      <span>{item.pipelineName}</span>
                      <StatusBadge status={item.status} />
                    </button>
                  ))}
                </div>
              </aside>
            ) : (
              <button className="source-restore" onClick={() => setSourceVisible(true)}>
                展开流水线源
              </button>
            )}
            <div className="pipeline-view">
              <div className="pipeline-view-toolbar">
                <div className="pipeline-view-toggle" role="group" aria-label="流水线视图切换">
                  <button
                    type="button"
                    className={pipelineViewMode === "canvas" ? "active" : ""}
                    onClick={() => setPipelineViewMode("canvas")}
                  >
                    DAG 视图
                  </button>
                  <button
                    type="button"
                    className={pipelineViewMode === "board" ? "active" : ""}
                    onClick={() => setPipelineViewMode("board")}
                  >
                    列布局（旧）
                  </button>
                </div>
              </div>
              {pipelineViewMode === "canvas" ? (
                <div className="pipeline-flow-shell">
                  <PipelineFlowCanvas
                    graph={pipelineFlowGraph}
                    mode="readonly"
                    selectedStageKey={selectedStageKey}
                    onSelectStage={(stage) => {
                      setSelectedStageKey(stage);
                      setExpandedExecutionStageKey(stage);
                    }}
                    minHeight={520}
                  />
                </div>
              ) : (
                <div className="pipeline-board">
                  {groups.map((group, index) => (
                    <div className="stage-column" key={group.title}>
                      <h2>{group.title}</h2>
                      <div className="job-stack">
                        {group.stages.map((stage) => {
                          const stageExecutionModel = executionModelForStage(stage);
                          return (
                            <JobCard
                              key={stage.id}
                              stage={stage}
                              selected={stage.key === selectedStage?.key}
                              executionCount={stageExecutionModel.commands.length || commandCountsByStage[stage.key] || 0}
                              executionSourceLabel={stageExecutionModel.sourceLabel}
                              executionCommands={stageExecutionModel.commands}
                              executionExpanded={expandedExecutionStageKey === stage.key}
                              onSelect={() => setSelectedStageKey(stage.key)}
                              onToggleExecution={() => {
                                setSelectedStageKey(stage.key);
                                setExpandedExecutionStageKey((current) => (current === stage.key ? "" : stage.key));
                              }}
                              onRetry={onRun}
                              runStatus={run.status}
                            />
                          );
                        })}
                      </div>
                      {index < groups.length - 1 && <div className="stage-divider" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <aside className="tekton-run-panel">
              <div className="tekton-run-head">
                <span>Tekton 运行对象</span>
                <strong className={`tekton-condition ${(tektonRun?.status ?? "QUEUED").toLowerCase()}`}>
                  {tektonRun?.conditionReason ?? "Pending"}
                </strong>
              </div>
              <div className="tekton-run-summary">
                <span>PipelineRun</span>
                <strong>
                  {tektonRun ? `${tektonRun.namespace}/${tektonRun.pipelineRunName}` : "尚未创建"}
                </strong>
                <small>{tektonRun?.conditionMessage ?? "保存并运行后由 Tekton 控制器接管"}</small>
                <span>Executor</span>
                <strong>{executorBackend}</strong>
              </div>
              <div className="execution-process-panel">
                <header>
                  <div>
                    <span>{executionSourceLabel}</span>
                    <h3>{selectedStage?.title ?? "当前步骤"} · 执行代码过程</h3>
                  </div>
                  <button
                    className="artifact-copy-button"
                    disabled={!stageExecutionScript}
                    onClick={() => copyExecutionText("execution-script", stageExecutionScript, "完整执行脚本")}
                    type="button"
                  >
                    {copiedCommandId === "execution-script" ? <Check size={14} /> : <Copy size={14} />}
                    {copiedCommandId === "execution-script" ? "已复制" : "复制脚本"}
                  </button>
                </header>
                <div className="execution-script-card">
                  <div>
                    <Code2 size={16} />
                    <span>完整脚本视图</span>
                  </div>
                  <pre>
                    <code>{stageExecutionScript || "当前步骤暂未产生命令事件，运行开始后会实时写入这里。"}</code>
                  </pre>
                </div>
                <div className="execution-command-list">
                  {stageExecutionCommands.map((command, index) => (
                    <article key={command.id} className={`execution-command-row ${command.status}`}>
                      <div className="execution-command-index">
                        <Terminal size={15} />
                        <strong>{String(index + 1).padStart(2, "0")}</strong>
                      </div>
                      <div className="execution-command-main">
                        <div className="execution-command-head">
                          <span>
                            <strong>{command.label}</strong>
                            <em>{command.cwd}</em>
                          </span>
                          <i>{executionCommandStatusLabel(command.status)}</i>
                        </div>
                        <code>{command.command}</code>
                        {command.details && command.details.length > 0 && (
                          <div className="execution-command-detail-list">
                            {command.details.map((detail, detailIndex) => (
                              <span key={`${command.id}-detail-${detailIndex}`}>
                                <strong>{String(detailIndex + 1).padStart(2, "0")}</strong>
                                <em>{detail.title}</em>
                                <small>{detail.detail}</small>
                                {detail.command && <code>{detail.command}</code>}
                              </span>
                            ))}
                          </div>
                        )}
                        {(command.output || command.error) && (
                          <pre className={command.error ? "execution-command-output error" : "execution-command-output"}>
                            {command.error ?? command.output}
                          </pre>
                        )}
                      </div>
                      <button
                        className="execution-copy-button"
                        onClick={() => copyExecutionText(command.id, command.command, `${command.label}命令`)}
                        type="button"
                        aria-label={`复制${command.label}命令`}
                      >
                        {copiedCommandId === command.id ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </article>
                  ))}
                </div>
              </div>
              <div className="tekton-runtime-section">
                <h3>Artifacts / Outputs</h3>
                {!imageArtifact && isSimulatedExecutor && (
                  <div className="primary-artifact-card pending">
                    <div>
                      <PackageCheck size={18} />
                      <span>
                        <strong>未生成真实镜像</strong>
                        <em>当前执行器是 simulated，只展示流程，不伪造 registry 产物。</em>
                      </span>
                    </div>
                    <p>要生成可 docker pull 的真实镜像，需要以 `EXECUTOR=tekton` 启动 API，并让 Tekton bridge 的 docker build / docker push 返回真实 digest。</p>
                  </div>
                )}
                {imageArtifact && (
                  <div className="primary-artifact-card">
                    <div>
                      <PackageCheck size={18} />
                      <span>
                        <strong>镜像已推送</strong>
                        <em>{artifactImageReference(imageArtifact)}</em>
                      </span>
                    </div>
                    <small>
                      {imageArtifact.version} · {imageArtifact.digest.slice(0, 24)} · {imageArtifact.signed ? "signed" : "unsigned"}
                    </small>
                    <p>这是 OCI 镜像引用，不是浏览器页面地址；部署或拉取时使用。</p>
                    <button
                      className="artifact-copy-button primary"
                      onClick={() => copyImagePullCommand(imageArtifact)}
                      aria-label="复制镜像拉取命令"
                    >
                      {copiedArtifactId === `${imageArtifact.id}:pull` ? <Check size={15} /> : <Copy size={15} />}
                      {copiedArtifactId === `${imageArtifact.id}:pull` ? "已复制" : "复制 docker pull"}
                    </button>
                    <button
                      className="artifact-copy-button ghost"
                      onClick={() => copyArtifactAddress(imageArtifact)}
                      aria-label="复制原始镜像引用"
                    >
                      {copiedArtifactId === imageArtifact.id ? <Check size={15} /> : <Copy size={15} />}
                      {copiedArtifactId === imageArtifact.id ? "已复制引用" : "复制镜像引用"}
                    </button>
                  </div>
                )}
                <div className="tekton-artifact-list">
                  {runArtifacts.length > 0 ? (
                    runArtifacts.map((artifact) => (
                      <article key={artifact.id} className={artifact.type === "image" ? "artifact-output-card image" : "artifact-output-card"}>
                        <div>
                          <strong>{artifactTypeLabel(artifact.type)}</strong>
                          <button
                            className="artifact-copy-button"
                            onClick={() => copyArtifactAddress(artifact)}
                            aria-label={`复制${artifactTypeLabel(artifact.type)}地址`}
                          >
                            {copiedArtifactId === artifact.id ? <Check size={14} /> : <Copy size={14} />}
                            {copiedArtifactId === artifact.id ? "已复制" : "复制"}
                          </button>
                        </div>
                        <em>{artifact.type === "image" ? artifactImageReference(artifact) : artifact.name}</em>
                        <small>{artifact.version} · {artifact.digest.slice(0, 24)} · {artifact.signed ? "signed" : "unsigned"}</small>
                      </article>
                    ))
                  ) : (
                    <span>
                      <strong>等待 TaskRun 结果</strong>
                      <em>{activeStage?.title ?? "PipelineRun pending"}</em>
                      <small>阶段成功后会写入 source、test report、build package、image、SBOM 或 provenance。</small>
                    </span>
                  )}
                </div>
              </div>
              <div className="tekton-runtime-section release-runtime-section">
                <h3>Release / Canary Records</h3>
                {activeRelease ? (
                  <>
                    <div className={`run-release-summary ${activeRelease.status}`}>
                      <strong>{activeRelease.applicationName}</strong>
                      <span>
                        {activeRelease.environment} · {activeRelease.status} · {activeRelease.target} · {activeRelease.namespace}
                      </span>
                      <em>{activeRelease.imageRef}</em>
                      <ReleaseEventMiniTimeline events={runReleaseEvents} />
                    </div>
                    <ReleaseEventTimeline
                      release={activeRelease}
                      events={runReleaseEvents}
                      maxEvents={10}
                      compact
                      emptyText="这次运行尚未产生发布事件；制品上线后会写入 Supabase 并显示在这里。"
                    />
                  </>
                ) : (
                  <div className="release-event-empty compact">
                    <PackageCheck size={16} />
                    <strong>等待上线记录</strong>
                    <span>当前 PipelineRun 生成制品后，选择上线或灰度发布才会创建 Release 事件。</span>
                  </div>
                )}
              </div>
              <div className="tekton-runtime-section">
                <h3>PipelineSpec / Resolver</h3>
                <div className="tekton-chip-grid compact">
                  <span>resolver</span>
                  <strong>{resolverRef?.resolver ?? tektonBinding?.resolver ?? "cluster"}</strong>
                  <span>resource</span>
                  <strong>{resolverRef ? `${resolverRef.resourceKind}/${resolverRef.name}` : "Pipeline/pending"}</strong>
                  <span>source</span>
                  <strong>{resolverRef?.source ?? "cluster://tekton-pipelines"}</strong>
                  <span>revision</span>
                  <strong>{resolverRef?.revision ?? run.refName}</strong>
                </div>
              </div>
              <div className="tekton-runtime-section">
                <h3>Params / Workspaces</h3>
                <div className="tekton-param-strip">
                  {(tektonRun?.params ?? tektonBinding?.params ?? []).slice(0, 6).map((param) => (
                    <span key={param.key}>
                      <strong>{param.key}</strong>
                      <em>{param.value}</em>
                    </span>
                  ))}
                </div>
                <div className="tekton-workspace-list">
                  {workspaceBindings.map((workspace) => (
                    <span key={workspace.name}>
                      <strong>{workspace.name}</strong>
                      <em>{workspace.type}</em>
                      <small>{workspace.mountPath}</small>
                    </span>
                  ))}
                </div>
              </div>
              <div className="tekton-object-list">
                <h3>ChildReferences / TaskRun</h3>
                {(tektonRun?.taskRuns ?? []).map((taskRun) => (
                  <button
                    key={taskRun.taskRunName}
                    className={`tekton-object-row ${taskRun.pipelineTaskName === selectedStage?.key ? "active" : ""}`}
                    onClick={() => setSelectedStageKey(taskRun.pipelineTaskName as LifecycleStageKey)}
                    type="button"
                  >
                    <strong>{taskRun.pipelineTaskName}</strong>
                    <span className={`taskrun-status ${taskRun.status.toLowerCase()}`}>{taskRun.status}</span>
                    <small>{taskRun.taskRunName}</small>
                  </button>
                ))}
              </div>
              <div className="run-log-panel">
                <h3>{selectedStage?.title ?? "运行日志"}</h3>
                <span>
                  {taskRunDetail?.taskRunName ?? selectedTaskRun?.taskRunName ?? "TaskRun pending"}
                  {taskRunLoading ? " · loading" : ""}
                </span>
                {taskRunError && (
                  <div className="taskrun-error">
                    <strong>真实详情暂不可用</strong>
                    <em>{taskRunError}</em>
                  </div>
                )}
                <div className="step-lines">
                  {taskRunSteps.length === 0 ? (
                    <span>
                      <strong>等待 step</strong>
                      <em>{selectedTaskRun?.podName ?? taskRunDetail?.podName ?? "pod pending"}</em>
                      <small>{selectedTaskRun?.status ?? taskRunDetail?.status ?? "QUEUED"}</small>
                    </span>
                  ) : (
                    taskRunSteps.map((step) => (
                      <button
                        key={step.id}
                        className={`step-line ${step.name === activeStepName ? "active" : ""}`}
                        onClick={() => setSelectedStepName(step.name)}
                        type="button"
                      >
                        <strong>{step.name}</strong>
                        <em>{step.image ?? "build-steps/alinux3"}</em>
                        <small>{step.status}</small>
                      </button>
                    ))
                  )}
                </div>
                <div className="log-lines">
                  {taskRunLogLines.map((line, index) => (
                    <code key={`${line}-${index}`}>{line}</code>
                  ))}
                </div>
                {selectedTaskRunResults.length > 0 && (
                  <div className="task-result-lines">
                    {selectedTaskRunResults.map(([key, value]) => (
                      <span key={key}>
                        <strong>{key}</strong>
                        <em>{value}</em>
                      </span>
                    ))}
                  </div>
                )}
                {(taskRunDetail?.events ?? []).length > 0 && (
                  <div className="task-result-lines">
                    {taskRunDetail?.events.map((event) => (
                      <span key={`${event.timestamp}-${event.reason}`}>
                        <strong>{event.reason}</strong>
                        <em>{event.message}</em>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="tekton-runtime-section">
                <h3>Results Records</h3>
                <div className="tekton-record-list">
                  {visibleResults.map((record) => (
                    <span key={record.name}>
                      <strong>{record.recordType}</strong>
                      <em>{record.name}</em>
                      <small>{record.summary}</small>
                    </span>
                  ))}
                </div>
              </div>
              <div className="tekton-runtime-section">
                <h3>Realtime Events</h3>
                <div className="tekton-event-list">
                  {liveRunEvents.length === 0 ? (
                    <span>
                      <strong>等待事件</strong>
                      <em>{run.id}</em>
                      <small>运行事件会通过 API 事件存储与 SSE 写入这里。</small>
                    </span>
                  ) : (
                    liveRunEvents.slice(-8).map((event) => (
                      <span key={event.id}>
                        <strong>{event.type}</strong>
                        <em>{event.source} · #{event.sequence}</em>
                        <small>{formatStoredRunEvent(event)}</small>
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="tekton-runtime-section">
                <h3>Kubernetes Events</h3>
                <div className="tekton-event-list">
                  {visibleEvents.map((event) => (
                    <span key={`${event.timestamp}-${event.reason}-${event.involvedObject}`}>
                      <strong>{event.reason}</strong>
                      <em>{event.involvedObject}</em>
                      <small>{event.message}</small>
                    </span>
                  ))}
                </div>
              </div>
              <div className="tekton-metadata-grid">
                <span>Results</span>
                <strong>{tektonRun?.resultRecordName ?? tektonBinding?.results.resultName ?? "-"}</strong>
                <span>日志地址</span>
                <strong>{tektonRun?.logsUrl ?? "tekton-results://pending"}</strong>
                <span>Chains</span>
                <strong>{tektonRun?.chainsAttestation?.signed ? "已签名" : "等待签名"}</strong>
                <span>Digest</span>
                <strong>{tektonRun?.chainsAttestation?.digest.slice(0, 28) ?? "保存后生成 provenance"}</strong>
              </div>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

type StageExecutionCommand = {
  id: string;
  label: string;
  cwd: string;
  command: string;
  status: "planned" | "running" | "success" | "failed";
  output?: string;
  error?: string;
  timestamp?: string;
  details?: StageExecutionCommandDetail[];
};

type StageExecutionCommandDetail = {
  title: string;
  detail: string;
  command?: string;
};

function commandEventsToExecutionCommands(events: StoredRunEvent[]): StageExecutionCommand[] {
  const commands = new Map<string, StageExecutionCommand>();
  for (const event of events) {
    if (event.type !== "command") continue;
    const id = stringPayload(event, "commandId") || event.id;
    const previous = commands.get(id);
    commands.set(id, {
      id,
      label: stringPayload(event, "label") || previous?.label || "执行命令",
      cwd: stringPayload(event, "cwd") || previous?.cwd || "-",
      command: stringPayload(event, "command") || previous?.command || "",
      status: normalizeExecutionStatus(stringPayload(event, "status") || previous?.status),
      output: stringPayload(event, "output") || previous?.output,
      error: stringPayload(event, "error") || previous?.error,
      timestamp: event.timestamp,
      details: commandEventDetails(event, previous),
    });
  }
  return Array.from(commands.values());
}

function commandEventDetails(
  event: StoredRunEvent,
  previous: StageExecutionCommand | undefined,
): StageExecutionCommandDetail[] | undefined {
  const previousDetails = previous?.details;
  const status = stringPayload(event, "status");
  const output = stringPayload(event, "output");
  const outputChunk = stringPayload(event, "outputChunk");
  const error = stringPayload(event, "error");
  const command = stringPayload(event, "command");
  const label = stringPayload(event, "label");
  const stageKey = eventStageKey(event);
  const details = inferCommandDetails({ stageKey, label, command });
  if (status === "running") {
    details.push({
      title: "实时执行中",
      detail: outputChunk ? `最新输出片段：${trimDetail(outputChunk)}` : "执行器已启动命令，正在等待输出。",
    });
  }
  if (status === "success") {
    details.push({
      title: "执行成功",
      detail: output ? `命令结束，最后输出：${trimDetail(output)}` : "命令以 0 退出码完成。",
    });
  }
  if (status === "failed") {
    details.push({
      title: "执行失败",
      detail: error || "命令返回非 0 退出码或启动失败。",
    });
  }
  if (details.length > 0) return details;
  return previousDetails;
}

function artifactCountsByStage(
  artifacts: ReadonlyArray<{ type: string }>,
  run: PipelineRun,
): Partial<Record<LifecycleStageKey, number>> {
  const enabledStages = new Set(run.definitionSnapshot.stages);
  const counts: Partial<Record<LifecycleStageKey, number>> = {};
  const bumpByType = (type: string) => {
    if (type === "image") {
      const target: LifecycleStageKey = enabledStages.has("upload") ? "upload" : "build";
      counts[target] = (counts[target] ?? 0) + 1;
    } else if (type === "package") {
      const target: LifecycleStageKey = enabledStages.has("package") ? "package" : "build";
      counts[target] = (counts[target] ?? 0) + 1;
    } else if (type === "sbom" || type === "provenance") {
      const target: LifecycleStageKey = enabledStages.has("package") ? "package" : "upload";
      if (enabledStages.has(target)) counts[target] = (counts[target] ?? 0) + 1;
    }
  };
  for (const artifact of artifacts) bumpByType(artifact.type);
  return counts;
}

function errorSummariesByStage(
  stages: ReadonlyArray<PipelineRun["stages"][number]>,
): Partial<Record<LifecycleStageKey, string>> {
  const summaries: Partial<Record<LifecycleStageKey, string>> = {};
  for (const stage of stages) {
    if (stage.status !== "failed") continue;
    const candidates = [...stage.logs]
      .reverse()
      .find((line) => /error|fail|exception|×|✗|错误|失败|异常|未通过|超时/i.test(line));
    const summary = (candidates ?? stage.logs[stage.logs.length - 1] ?? "执行失败").trim();
    summaries[stage.key] = summary.length > 80 ? `${summary.slice(0, 77)}…` : summary;
  }
  return summaries;
}

function countCommandEventsByStage(events: StoredRunEvent[]): Partial<Record<LifecycleStageKey, number>> {
  const stageCommands = new Map<LifecycleStageKey, Set<string>>();
  for (const event of events) {
    if (event.type !== "command") continue;
    const stageKey = eventStageKey(event);
    if (!stageKey) continue;
    const set = stageCommands.get(stageKey) ?? new Set<string>();
    set.add(stringPayload(event, "commandId") || event.id);
    stageCommands.set(stageKey, set);
  }
  return Object.fromEntries(Array.from(stageCommands.entries()).map(([stageKey, commands]) => [stageKey, commands.size]));
}

function plannedExecutionCommandsForStage({
  pipeline,
  repositoryUrl,
  run,
  stage,
}: {
  pipeline: PipelineDefinition;
  repositoryUrl: string;
  run: PipelineRun;
  stage: PipelineRun["stages"][number];
}): StageExecutionCommand[] {
  const buildConfig = {
    ...DEFAULT_PIPELINE_BUILD_CONFIG,
    ...pipeline.buildConfig,
    packageOutputPaths:
      pipeline.buildConfig?.packageOutputPaths && pipeline.buildConfig.packageOutputPaths.length > 0
        ? pipeline.buildConfig.packageOutputPaths
        : DEFAULT_PIPELINE_BUILD_CONFIG.packageOutputPaths,
  };
  const imageArtifact = resolveImageArtifact(pipeline, run);
  const packageMode = buildConfig.packageMode ?? "container_image";
  const buildRuntime = buildConfig.runtime ?? "node";
  const runDir = `<LOCAL_DOCKER_WORKDIR>/${run.id}`;
  const sourceDir = `${runDir}/source`;
  const contextPath = pipeline.imageArtifact?.contextPath || ".";
  const contextDir = contextPath === "." ? sourceDir : `${sourceDir}/${contextPath}`;
  const dockerfilePath = pipeline.imageArtifact?.dockerfilePath || "Dockerfile";
  const packagePath = `${runDir}/${run.id}.tar.gz`;
  const outputPaths = buildConfig.packageOutputPaths.join(" ");
  const installCommand =
    "pnpm install --frozen-lockfile  # 若存在 pnpm-lock.yaml；否则 npm ci / yarn install --frozen-lockfile";
  const scriptCommand =
    `pnpm run ${buildConfig.packageBuildScript}  # 若未使用 pnpm，则执行 npm run ${buildConfig.packageBuildScript} / yarn run ${buildConfig.packageBuildScript}`;

  const make = (
    id: string,
    label: string,
    cwd: string,
    command: string,
    details?: StageExecutionCommandDetail[],
  ): StageExecutionCommand => ({
    id: `planned-${stage.key}-${id}`,
    label,
    cwd,
    command,
    status: "planned",
    details,
  });

  if (stage.key === "source") {
    return [
      make("clone", "拉取代码", runDir, `git clone --depth 1 --branch ${quoteCommandArg(run.refName)} ${quoteCommandArg(repositoryUrl)} ${quoteCommandArg(sourceDir)}`),
      make("commit", "解析提交 SHA", sourceDir, "git rev-parse HEAD"),
    ];
  }

  if (stage.key === "test") {
    if (buildRuntime === "go") {
      return [
        make("test", "执行 Go 单元测试", contextDir, "go test ./..."),
      ];
    }
    return [
      make("install", "安装依赖", contextDir, installCommand, nodeInstallDetails(contextDir)),
      make(
        "test",
        "执行 package.json scripts.test",
        contextDir,
        "pnpm run test  # 若未使用 pnpm，则执行 npm run test / yarn run test",
        nodeScriptDetails("test", "测试与扫描", ["test report", "coverage", "lint report"]),
      ),
    ];
  }

  if (stage.key === "build") {
    if (buildRuntime === "go") {
      return [
        make("go-mod", "下载 Go 依赖", contextDir, "go mod download"),
        make("go-build", "执行 Go 构建", contextDir, "go build -o bin/application ."),
        make("archive", "归档真实构建产物", contextDir, `tar -czf ${quoteCommandArg(packagePath)} ${outputPaths}`),
      ];
    }
    return [
      make("install", "安装依赖", contextDir, installCommand, nodeInstallDetails(contextDir)),
      make(
        "build",
        `执行 package.json scripts.${buildConfig.packageBuildScript}`,
        contextDir,
        scriptCommand,
        nodeScriptDetails(buildConfig.packageBuildScript, "前端构建", buildConfig.packageOutputPaths),
      ),
      make(
        "archive",
        "归档真实构建产物",
        contextDir,
        `tar -czf ${quoteCommandArg(packagePath)} ${outputPaths}`,
        archiveOutputDetails(packagePath, buildConfig.packageOutputPaths),
      ),
    ];
  }

  if (stage.key === "env") {
    const variables = [...(pipeline.variables ?? []), ...(pipeline.runtimeVariables ?? [])];
    const lines = variables.length > 0
      ? variables.map((variable) => `${variable.key}=${redactVariableDisplay(variable.key, variable.value)}`)
      : ["echo \"no env variables configured\""];
    return [make("env", "注入环境变量", contextDir, lines.join("\n"))];
  }

  if (stage.key === "package") {
    return [
      make("digest", "计算产物摘要", contextDir, `sha256sum ${quoteCommandArg(packagePath)}`),
      make("provenance", "生成 SBOM / provenance", contextDir, `记录 ${packageMode} 产物元数据并写入 Results / Chains`),
    ];
  }

  if (stage.key === "upload") {
    return [
      make("daemon", "检查 Docker daemon", runDir, "docker version --format {{.Server.Version}}"),
      make("login", "登录镜像仓库", runDir, `docker login --username <REGISTRY_USERNAME> ${quoteCommandArg(imageArtifact.registryUrl)}`),
      make("build-image", "构建 OCI 镜像", contextDir, `docker build -f ${quoteCommandArg(dockerfilePath)} -t ${quoteCommandArg(imageArtifact.imageRef)} ${quoteCommandArg(contextDir)}`),
      make("push-image", "推送镜像到仓库", contextDir, `docker push ${quoteCommandArg(imageArtifact.imageRef)}`),
      make("digest", "读取镜像 digest", contextDir, `docker image inspect --format={{index .RepoDigests 0}} ${quoteCommandArg(imageArtifact.imageRef)}`),
    ];
  }

  if (stage.key === "deploy" || stage.key === "canary" || stage.key === "promote") {
    return rolloutCommandsForPackageMode(stage.key, packageMode, run, pipeline, imageArtifact.imageRef, packagePath, make);
  }

  if (stage.key === "approval") {
    return [make("approval", "等待人工审批", runDir, `等待审批通过后继续 ${packageMode} 发布流程`)];
  }

  return [make("pending", "等待执行器", runDir, "当前步骤等待执行器生成真实命令事件")];
}

function rolloutCommandsForPackageMode(
  stageKey: LifecycleStageKey,
  packageMode: string,
  run: PipelineRun,
  pipeline: PipelineDefinition,
  imageRef: string,
  packagePath: string,
  make: (
    id: string,
    label: string,
    cwd: string,
    command: string,
    details?: StageExecutionCommandDetail[],
  ) => StageExecutionCommand,
): StageExecutionCommand[] {
  const namespace = run.environment;
  const appName = pipeline.applicationId || pipeline.name;
  if (packageMode === "static_site") {
    return [
      make(`${stageKey}-sync`, "同步静态站点产物", "<STATIC_SITE_DEPLOY_ROOT>", `rsync -a --delete ${quoteCommandArg(packagePath)} ${quoteCommandArg(appName)}/releases/${quoteCommandArg(run.id)}/`),
      make(`${stageKey}-switch`, "切换灰度入口", "<STATIC_SITE_DEPLOY_ROOT>", `更新 ${run.canaryPercent}% 流量到 release ${run.id}`),
    ];
  }
  if (packageMode === "server_package") {
    return [
      make(`${stageKey}-extract`, "解压服务包", "<SERVER_PACKAGE_DEPLOY_ROOT>", `tar -xzf ${quoteCommandArg(packagePath)} -C ${quoteCommandArg(appName)}/releases/${quoteCommandArg(run.id)}`),
      make(`${stageKey}-restart`, "滚动重启服务", "<SERVER_PACKAGE_DEPLOY_ROOT>", `systemctl reload ${quoteCommandArg(appName)} || pm2 reload ${quoteCommandArg(appName)}`),
    ];
  }
  if (packageMode === "kubernetes_manifest") {
    return [
      make(`${stageKey}-apply`, "应用 Kubernetes Manifest", "<KUBECONFIG>", `kubectl -n ${quoteCommandArg(namespace)} apply -f ${quoteCommandArg(packagePath)}`),
      make(`${stageKey}-status`, "检查发布状态", "<KUBECONFIG>", `kubectl -n ${quoteCommandArg(namespace)} rollout status deployment/${quoteCommandArg(appName)}`),
    ];
  }
  if (packageMode === "helm_chart") {
    return [
      make(`${stageKey}-helm`, "升级 Helm Release", "<KUBECONFIG>", `helm upgrade --install ${quoteCommandArg(appName)} ${quoteCommandArg(packagePath)} -n ${quoteCommandArg(namespace)} --set image.tag=${quoteCommandArg(run.id)}`),
      make(`${stageKey}-helm-status`, "检查 Helm 状态", "<KUBECONFIG>", `helm status ${quoteCommandArg(appName)} -n ${quoteCommandArg(namespace)}`),
    ];
  }
  return [
    make(`${stageKey}-set-image`, "更新工作负载镜像", "<KUBECONFIG>", `kubectl -n ${quoteCommandArg(namespace)} set image deployment/${quoteCommandArg(appName)} app=${quoteCommandArg(imageRef)}`),
    make(`${stageKey}-rollout`, "检查滚动发布", "<KUBECONFIG>", `kubectl -n ${quoteCommandArg(namespace)} rollout status deployment/${quoteCommandArg(appName)}`),
  ];
}

function nodeInstallDetails(contextDir: string): StageExecutionCommandDetail[] {
  return [
    {
      title: "定位前端工程",
      detail: `进入构建上下文并读取 package.json：${contextDir}`,
      command: "test -f package.json",
    },
    {
      title: "选择包管理器",
      detail: "按 pnpm-lock.yaml、package-lock.json、yarn.lock 的优先级选择安装命令；都不存在时回退 npm install。",
      command: "pnpm install --frozen-lockfile || npm ci || yarn install --frozen-lockfile || npm install",
    },
    {
      title: "恢复依赖缓存",
      detail: "依赖目录和包管理器缓存会作为后续 build/test 命令的输入，真实执行输出会流式写入事件。",
    },
  ];
}

function nodeScriptDetails(script: string, title: string, outputPaths: string[]): StageExecutionCommandDetail[] {
  const normalizedScript = script.trim() || "build";
  const outputs = outputPaths.length > 0 ? outputPaths : DEFAULT_PIPELINE_BUILD_CONFIG.packageOutputPaths;
  return [
    {
      title: "校验 package.json 脚本",
      detail: `确认 package.json 中存在 scripts.${normalizedScript}，不存在时真实执行器会直接失败并阻断后续阶段。`,
      command: `node -e "const p=require('./package.json'); if(!p.scripts?.['${escapeSingleQuotedJs(normalizedScript)}']) process.exit(1)"`,
    },
    {
      title,
      detail:
        normalizedScript === "build"
          ? "执行前端构建脚本。Next 项目会进入 next build；React/Vite 项目会进入对应 bundler 的 build 流程。"
          : `执行 package.json 中定义的 ${normalizedScript} 脚本，真实 stdout/stderr 会持续写入命令事件。`,
      command: `pnpm run ${normalizedScript}  # 或 npm run ${normalizedScript} / yarn run ${normalizedScript}`,
    },
    {
      title: "收集构建输出",
      detail: `构建结束后检查真实产物目录：${outputs.join(", ")}。没有任何目录存在时不会伪造成功。`,
      command: outputs.map((outputPath) => `test -e ${quoteCommandArg(outputPath)}`).join(" || "),
    },
  ];
}

function archiveOutputDetails(packagePath: string, outputPaths: string[]): StageExecutionCommandDetail[] {
  const outputs = outputPaths.length > 0 ? outputPaths : DEFAULT_PIPELINE_BUILD_CONFIG.packageOutputPaths;
  return [
    {
      title: "过滤有效产物",
      detail: `只把真实存在的目录放入归档：${outputs.join(", ")}。`,
    },
    {
      title: "生成制品包",
      detail: "将前端构建产物打成 tar.gz，后续 package/upload/release 阶段引用这个文件。",
      command: `tar -czf ${quoteCommandArg(packagePath)} ${outputs.join(" ")}`,
    },
    {
      title: "写入 digest",
      detail: "计算 sha256 并写入 Artifacts / Results，页面复制和发布记录都使用这个真实产物信息。",
      command: `sha256sum ${quoteCommandArg(packagePath)}`,
    },
  ];
}

function inferCommandDetails({
  stageKey,
  label,
  command,
}: {
  stageKey: LifecycleStageKey | "";
  label: string;
  command: string;
}): StageExecutionCommandDetail[] {
  const normalized = `${label} ${command}`.toLowerCase();
  if (/pnpm|npm|yarn/.test(normalized) && /install| ci\b/.test(normalized)) {
    return nodeInstallDetails("<runtime cwd>");
  }
  if (/pnpm run|npm run|yarn run/.test(normalized)) {
    const script = command.match(/\brun\s+([^\s]+)/)?.[1] ?? (stageKey === "test" ? "test" : "build");
    return nodeScriptDetails(script, stageKey === "test" ? "前端测试" : "前端构建", DEFAULT_PIPELINE_BUILD_CONFIG.packageOutputPaths);
  }
  if (/tar\s+-czf/.test(normalized) || label.includes("打包")) {
    return archiveOutputDetails("<artifact.tar.gz>", DEFAULT_PIPELINE_BUILD_CONFIG.packageOutputPaths);
  }
  return [];
}

function executionScript(commands: StageExecutionCommand[]): string {
  return commands
    .map((command) =>
      [
        `# ${command.label}`,
        ...(command.details ?? []).flatMap((detail, index) => [
          `# ${index + 1}. ${detail.title}: ${detail.detail}`,
          detail.command ? `# detail command: ${detail.command}` : "",
        ]),
        command.cwd && command.cwd !== "-" ? `cd ${command.cwd}` : "",
        command.command,
        command.output ? `# output\n${command.output}` : "",
        command.error ? `# error\n${command.error}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

function executionCommandStatusLabel(status: StageExecutionCommand["status"]): string {
  const labels: Record<StageExecutionCommand["status"], string> = {
    planned: "待执行",
    running: "执行中",
    success: "成功",
    failed: "失败",
  };
  return labels[status];
}

function normalizeExecutionStatus(value: string | undefined): StageExecutionCommand["status"] {
  if (value === "running" || value === "success" || value === "failed") return value;
  return "planned";
}

function eventStageKey(event: StoredRunEvent): LifecycleStageKey | "" {
  const value = stringPayload(event, "stageKey");
  return isLifecycleStageKey(value) ? value : "";
}

function isLifecycleStageKey(value: string): value is LifecycleStageKey {
  return ["source", "test", "build", "env", "package", "upload", "deploy", "canary", "approval", "promote"].includes(value);
}

function quoteCommandArg(value: string): string {
  if (!value) return "\"\"";
  return /^[a-zA-Z0-9_./:=\\<>-]+$/.test(value) ? value : `"${value.replace(/"/g, "\\\"")}"`;
}

function escapeSingleQuotedJs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function trimDetail(value: string, limit = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function redactVariableDisplay(key: string, value: string): string {
  return /SECRET|TOKEN|PASSWORD|KEY/i.test(key) && value ? "***" : value;
}

function groupRunStages(run: PipelineRun) {
  const groupMap: Array<{ title: string; keys: LifecycleStageKey[] }> = [
    { title: "源", keys: ["source"] },
    { title: "测试", keys: ["test"] },
    { title: "构建上传", keys: ["build", "env", "package", "upload"] },
    { title: "部署发布", keys: ["deploy", "canary", "approval", "promote"] },
  ];
  return groupMap
    .map((group) => ({
      title: group.title,
      stages: run.stages.filter((stage) => group.keys.includes(stage.key)),
    }))
    .filter((group) => group.stages.length > 0);
}

function RunHistoryPanel({
  runs,
  activeRunId,
  onOpenRun,
}: {
  runs: PipelineRun[];
  activeRunId: string;
  onOpenRun: (runId: string) => void;
}) {
  return (
    <section className="run-history-panel">
      <header className="run-history-head">
        <div>
          <span>运行历史</span>
          <h2>历史运行记录</h2>
          <p>每一条记录都是一次完整 PipelineRun 快照，点击后查看当时的阶段、日志、参数与 Tekton 运行对象。</p>
        </div>
        <strong>{runs.length} 次运行</strong>
      </header>
      <div className="run-history-list">
        {runs.map((item) => {
          const failedStage = item.stages.find((stage) => stage.status === "failed");
          const activeStage =
            item.stages.find((stage) => stage.status === "running" || stage.status === "waiting") ??
            failedStage ??
            item.stages.find((stage) => stage.status === "success") ??
            item.stages[0];
          return (
            <button
              key={item.id}
              className={item.id === activeRunId ? "run-history-row active" : "run-history-row"}
              onClick={() => onOpenRun(item.id)}
            >
              <div className="run-history-title">
                <strong>#{item.id.replace("run-", "")}</strong>
                <StatusBadge status={item.status} />
                <span>{item.pipelineName}</span>
              </div>
              <div className="run-history-meta">
                <span>
                  触发人 <strong>{item.actor}</strong>
                </span>
                <span>
                  源 <strong>{item.refType}/{item.refName}</strong>
                </span>
                <span>
                  Commit <strong>{item.commit.slice(0, 8)}</strong>
                </span>
                <span>
                  开始时间 <strong>{formatRunTime(item.createdAt)}</strong>
                </span>
                <span>
                  持续时间 <strong>{formatRunDuration(item)}</strong>
                </span>
              </div>
              <div className="run-history-flow" aria-label={`${item.pipelineName} 历史阶段`}>
                {item.stages.map((stage) => (
                  <span key={stage.id} className={`run-history-stage ${stage.status}`}>
                    <i />
                    <em>{stage.title}</em>
                  </span>
                ))}
              </div>
              <div className="run-history-result">
                <span>{activeStage ? `${activeStage.title} · ${historyStageLabel(activeStage.status)}` : "等待调度"}</span>
                <strong>{failedStage ? stageErrorLine(failedStage) : historyRunResult(item.status)}</strong>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function formatRunTime(value: string): string {
  return value.replace("T", " ").slice(0, 19);
}

function formatRunDuration(run: PipelineRun): string {
  const durationMs = run.stages.reduce((total, stage) => total + (stage.durationMs ?? 0), 0);
  if (durationMs > 0) return `${Math.max(1, Math.round(durationMs / 1000))}秒`;
  return run.status === "queued" ? "等待中" : `${Math.max(1, Math.round(run.progress / 8))}秒`;
}

function historyRunResult(status: PipelineRun["status"]): string {
  const labels: Record<PipelineRun["status"], string> = {
    queued: "等待执行器分配资源",
    running: "正在执行",
    waiting_approval: "等待审批继续发布",
    success: "全部阶段执行成功",
    failed: "失败阶段阻断后续任务",
    canceled: "运行已取消",
  };
  return labels[status];
}

function stageErrorLine(stage: PipelineRun["stages"][number]): string {
  return (
    stage.logs.find((line) => line.startsWith("执行器错误:")) ??
    stage.logs.find((line) => /失败|failed|error/i.test(line)) ??
    "失败阶段阻断后续任务"
  );
}

function historyStageLabel(status: PipelineRun["stages"][number]["status"]): string {
  const labels: Record<PipelineRun["stages"][number]["status"], string> = {
    pending: "待执行",
    running: "执行中",
    success: "成功",
    failed: "失败",
    waiting: "等待中",
    skipped: "已跳过",
  };
  return labels[status];
}

function formatStoredRunEvent(event: StoredRunEvent): string {
  if (event.type === "command") {
    return [
      stringPayload(event, "label"),
      stringPayload(event, "status"),
      stringPayload(event, "command"),
      stringPayload(event, "error"),
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const stage = stringPayload(event, "stageKey") || stringPayload(event, "stage");
  const status = stringPayload(event, "status");
  const job = stringPayload(event, "jobName") || stringPayload(event, "jobId");
  const step = stringPayload(event, "stepName") || stringPayload(event, "stepId");
  const error = stringPayload(event, "error");
  return [stage, job, step, status, error].filter(Boolean).join(" · ") || event.timestamp;
}

function stringPayload(event: StoredRunEvent, key: string): string {
  const value = event.payload[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function describeUiError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function artifactTypeLabel(type: PlatformSnapshot["artifacts"][number]["type"]): string {
  const labels: Record<PlatformSnapshot["artifacts"][number]["type"], string> = {
    image: "Image",
    package: "Package",
    sbom: "SBOM",
    provenance: "Provenance",
  };
  return labels[type];
}

function artifactImageReference(artifact: PlatformSnapshot["artifacts"][number]): string {
  if (artifact.type !== "image") return artifact.name;
  if (artifact.name.includes("@sha256:")) return artifact.name;
  const lastPathSegment = artifact.name.slice(artifact.name.lastIndexOf("/") + 1);
  if (lastPathSegment.includes(":")) return artifact.name;
  return `${artifact.name}:${artifact.version}`;
}
