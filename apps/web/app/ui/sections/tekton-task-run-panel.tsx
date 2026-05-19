"use client";

import type {
  PipelineStageRun,
  StepInstance,
  TektonTaskGraphNode,
  TektonTaskRunDetail,
  TektonTaskRunRef,
} from "@deploy-management/shared";

interface TaskRunEventLike {
  reason: string;
  message: string;
  timestamp: string;
}

export interface TektonTaskRunPanelProps {
  selectedStage?: PipelineStageRun;
  selectedTaskRun?: TektonTaskRunRef;
  selectedTaskGraph?: TektonTaskGraphNode;
  taskRunDetail: TektonTaskRunDetail | null;
  taskRunSteps: StepInstance[];
  activeStepName: string;
  onSelectStep: (stepName: string) => void;
  taskRunLogLines: string[];
  taskRunLoading: boolean;
  taskRunError: string;
  selectedTaskRunResults: Array<[string, string]>;
  events: TaskRunEventLike[];
  onInspectStep?: (step: StepInstance) => void;
  onInspectResult?: (key: string, value: string) => void;
  onInspectEvent?: (event: TaskRunEventLike) => void;
  onInspectTaskMeta?: () => void;
}

export function TektonTaskRunPanel({
  selectedStage,
  selectedTaskRun,
  selectedTaskGraph,
  taskRunDetail,
  taskRunSteps,
  activeStepName,
  onSelectStep,
  taskRunLogLines,
  taskRunLoading,
  taskRunError,
  selectedTaskRunResults,
  events,
  onInspectStep,
  onInspectResult,
  onInspectEvent,
  onInspectTaskMeta,
}: TektonTaskRunPanelProps) {
  const taskRunName = taskRunDetail?.taskRunName ?? selectedTaskRun?.taskRunName ?? "TaskRun pending";
  const status = taskRunDetail?.status ?? selectedTaskRun?.status ?? "QUEUED";
  const conditionReason =
    (taskRunDetail as { conditionReason?: string } | null)?.conditionReason ?? selectedTaskRun?.status ?? "Pending";
  const conditionMessage =
    (taskRunDetail as { conditionMessage?: string } | null)?.conditionMessage ?? "";
  const whenExpressions = selectedTaskGraph?.when ?? [];
  const params = selectedTaskGraph?.params ?? [];
  const workspaces = selectedTaskGraph?.workspaces ?? [];
  const retries = selectedTaskGraph?.retries ?? 0;
  const timeoutSeconds = selectedTaskGraph?.timeoutSeconds ?? 0;

  return (
    <div className="run-log-panel">
      <h3>{selectedStage?.title ?? "运行日志"}</h3>
      <span>
        {taskRunName}
        {taskRunLoading ? " · loading" : ""}
      </span>
      {(conditionReason !== "Pending" || conditionMessage) && (
        <div className="taskrun-condition">
          <strong className={`tekton-condition ${status.toString().toLowerCase()}`}>{conditionReason}</strong>
          {conditionMessage && <em>{conditionMessage}</em>}
        </div>
      )}
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
            <small>{status}</small>
          </span>
        ) : (
          taskRunSteps.map((step) => (
            <button
              key={step.id}
              className={`step-line ${step.name === activeStepName ? "active" : ""}`}
              onClick={() => {
                onSelectStep(step.name);
                onInspectStep?.(step);
              }}
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
            <span
              key={key}
              className="inspectable-card"
              onClick={() => onInspectResult?.(key, value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onInspectResult?.(key, value);
              }}
              role="button"
              tabIndex={0}
            >
              <strong>{key}</strong>
              <em>{value}</em>
            </span>
          ))}
        </div>
      )}
      {(events.length > 0) && (
        <div className="task-result-lines">
          {events.map((event) => (
            <span
              key={`${event.timestamp}-${event.reason}`}
              className="inspectable-card"
              onClick={() => onInspectEvent?.(event)}
              onKeyDown={(keyboardEvent) => {
                if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
                keyboardEvent.preventDefault();
                onInspectEvent?.(event);
              }}
              role="button"
              tabIndex={0}
            >
              <strong>{event.reason}</strong>
              <em>{event.message}</em>
            </span>
          ))}
        </div>
      )}
      {selectedTaskGraph && (
        <div
          className="tekton-task-meta inspectable-card"
          onClick={() => onInspectTaskMeta?.()}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onInspectTaskMeta?.();
          }}
          role="button"
          tabIndex={0}
        >
          <h4>任务定义</h4>
          <div className="tekton-task-meta-grid">
            <div>
              <span>taskRef</span>
              <strong>{selectedTaskGraph.taskRef}</strong>
            </div>
            <div>
              <span>retries</span>
              <strong>{retries}</strong>
            </div>
            <div>
              <span>timeoutSeconds</span>
              <strong>{timeoutSeconds || "默认"}</strong>
            </div>
            <div>
              <span>workspaces</span>
              <strong>{workspaces.length > 0 ? workspaces.join(" / ") : "无"}</strong>
            </div>
          </div>
          {whenExpressions.length > 0 && (
            <div className="tekton-task-meta-block">
              <span>when</span>
              <ul>
                {whenExpressions.map((expr, index) => (
                  <li key={`when-${index}`}>
                    <code>{expr.input}</code> {expr.operator} [{expr.values.join(", ")}]
                  </li>
                ))}
              </ul>
            </div>
          )}
          {params.length > 0 && (
            <div className="tekton-task-meta-block">
              <span>params ({params.length})</span>
              <ul>
                {params.slice(0, 8).map((param) => (
                  <li key={`param-${param.key}`}>
                    <code>{param.key}</code>
                    <em>{String(param.value ?? "")}</em>
                  </li>
                ))}
                {params.length > 8 && <li className="muted">+ {params.length - 8} 更多</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
