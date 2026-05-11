"use client";

import { useEffect, useState } from "react";
import { MoreHorizontal, X } from "lucide-react";
import type {
  LifecycleStageKey,
  PipelineDefinition,
  PipelineRun,
  PlatformSnapshot,
} from "@deploy-management/shared";
import { JobCard } from "../components/job-card";
import { StatusBadge, Summary } from "../components/primitives";

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
  const [activeRunTab, setActiveRunTab] = useState<"latest" | "history">("latest");
  const [sourceVisible, setSourceVisible] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const repository = snapshot.repositories.find((item) => item.id === run.repositoryId);
  const tektonRun = snapshot.tekton.runRecords.find((item) => item.runId === run.id);
  const tektonBinding = snapshot.tekton.bindings.find((item) => item.pipelineId === run.pipelineId);
  const runArtifacts = snapshot.artifacts.filter((artifact) => artifact.runId === run.id);
  const selectedStage = run.stages.find((stage) => stage.key === selectedStageKey) ?? run.stages[0];
  const selectedTaskRun = tektonRun?.taskRuns.find((taskRun) => taskRun.pipelineTaskName === selectedStage?.key);
  const selectedTaskRunResults = Object.entries(selectedTaskRun?.results ?? {});
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
  }, [activeStage?.key, run.status]);

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
              {(activeRunTab === "history" ? snapshot.runs : snapshot.runs.slice(0, 4)).map((item) => (
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
        <div className="pipeline-board">
          {groups.map((group, index) => (
            <div className="stage-column" key={group.title}>
              <h2>{group.title}</h2>
              <div className="job-stack">
                {group.stages.map((stage) => (
                  <JobCard
                    key={stage.id}
                    stage={stage}
                    selected={stage.key === selectedStage?.key}
                    onSelect={() => setSelectedStageKey(stage.key)}
                    onRetry={onRun}
                    runStatus={run.status}
                  />
                ))}
              </div>
              {index < groups.length - 1 && <div className="stage-divider" />}
            </div>
          ))}
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
              <div key={taskRun.taskRunName} className="tekton-object-row">
                <strong>{taskRun.pipelineTaskName}</strong>
                <span className={`taskrun-status ${taskRun.status.toLowerCase()}`}>{taskRun.status}</span>
                <small>{taskRun.taskRunName}</small>
              </div>
            ))}
          </div>
          <div className="run-log-panel">
            <h3>{selectedStage?.title ?? "运行日志"}</h3>
            <span>{selectedTaskRun?.taskRunName ?? "TaskRun pending"}</span>
            <div className="log-lines">
              {(selectedStage?.logs ?? ["暂无日志"]).map((line, index) => (
                <code key={`${line}-${index}`}>{line}</code>
              ))}
            </div>
            <div className="step-lines">
              {(selectedTaskRun?.steps ?? []).map((step) => (
                <span key={step.id}>
                  <strong>{step.name}</strong>
                  <em>{step.image ?? "build-steps/alinux3"}</em>
                  <small>{step.status}</small>
                </span>
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
            <h3>Events</h3>
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

      <div className="run-bottom-actions">
        {run.status === "waiting_approval" && (
          <button className="yunxiao-primary" onClick={() => void onPromote(run.id)}>
            审批通过并全量
          </button>
        )}
        {["running", "waiting_approval", "queued"].includes(run.status) && (
          <button className="danger-button" onClick={() => void onCancel(run.id)}>
            取消运行
          </button>
        )}
      </div>
    </section>
  );
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
