"use client";

import { Ban, Clock3, X } from "lucide-react";
import type { PipelineRun } from "@deploy-management/shared";
import { stageIcons } from "./stage-icons";

interface JobCardProps {
  stage: PipelineRun["stages"][number];
  onRetry: () => void;
  selected?: boolean;
  executionCount?: number;
  executionSourceLabel?: string;
  executionCommands?: Array<{
    id: string;
    label: string;
    command: string;
    status: "planned" | "running" | "success" | "failed";
    details?: Array<{
      title: string;
      detail: string;
      command?: string;
    }>;
  }>;
  executionExpanded?: boolean;
  onSelect?: () => void;
  onToggleExecution?: () => void;
  runStatus?: PipelineRun["status"];
}

export function JobCard({
  stage,
  onRetry,
  selected = false,
  executionCount = 0,
  executionSourceLabel = "固定推演",
  executionCommands = [],
  executionExpanded = false,
  onSelect,
  onToggleExecution,
  runStatus,
}: JobCardProps) {
  const Icon = stageIcons[stage.key];
  const failed = stage.status === "failed";
  const canceled = runStatus === "canceled" && stage.status === "skipped";
  const waiting = stage.status === "waiting" || stage.status === "pending" || stage.status === "running";
  const tone = canceled ? "canceled" : stage.status;
  const firstLog = stage.logs[0];
  const executorErrorLine = stage.logs.find((line) => line.startsWith("执行器错误:"));
  const errorLine = executorErrorLine ?? stage.logs.find((line) => /失败|failed|error/i.test(line)) ?? "任务执行失败，请检查构建集群和运行日志。";
  const durationText = stage.durationMs
    ? `${Math.max(1, Math.round(stage.durationMs / 1000))}秒`
    : canceled
    ? "已取消"
    : stage.status === "running"
    ? "执行中"
    : stage.status === "waiting"
    ? "等待中"
    : "待执行";

  return (
    <article className={`job-card ${tone} ${selected ? "selected" : ""}`}>
      <div className="job-title">
        <span className={`job-status-dot ${tone}`}>
          {failed ? <X size={14} /> : canceled ? <Ban size={14} /> : waiting ? <Clock3 size={14} /> : <Icon size={14} />}
        </span>
        <button className="job-title-button" onClick={onSelect}>
          {stage.key === "test" ? stage.title.replace("测试与扫描", "Node.js 单元测试") : stage.title}
        </button>
      </div>
      <small>{durationText}</small>
      <button
        type="button"
        className={executionCount > 0 ? "job-execution-count active" : "job-execution-count"}
        onClick={onToggleExecution ?? onSelect}
      >
        {executionCount > 0 ? `${executionSourceLabel} · ${executionCount} 条命令` : "点击查看执行过程"}
      </button>
      {executionExpanded && executionCommands.length > 0 && (
        <div className="job-command-preview">
          {executionCommands.slice(0, 3).map((command) => (
            <span key={command.id} className={`job-command-line ${command.status}`}>
              <strong>{command.label}</strong>
              <code title={command.command} aria-label={`${command.label}命令：${command.command}`}>
                {command.command}
              </code>
              {command.details && command.details.length > 0 && (
                <small>
                  {command.details
                    .slice(0, 3)
                    .map((detail) => detail.title)
                    .join(" / ")}
                </small>
              )}
            </span>
          ))}
          <em>
            {executionCommands.length > 3
              ? `还有 ${executionCommands.length - 3} 条命令，右侧可查看和复制完整脚本`
              : "右侧可查看和复制完整脚本"}
          </em>
        </div>
      )}
      {failed && (
        <div className="job-error">
          <span>{errorLine}</span>
          <button onClick={onRetry}>重试</button>
        </div>
      )}
      {!failed && firstLog && <p>{firstLog}</p>}
    </article>
  );
}
