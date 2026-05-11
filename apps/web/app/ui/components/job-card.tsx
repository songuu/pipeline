"use client";

import { Ban, Clock3, X } from "lucide-react";
import type { PipelineRun } from "@deploy-management/shared";
import { stageIcons } from "./stage-icons";

interface JobCardProps {
  stage: PipelineRun["stages"][number];
  onRetry: () => void;
  selected?: boolean;
  onSelect?: () => void;
  runStatus?: PipelineRun["status"];
}

export function JobCard({ stage, onRetry, selected = false, onSelect, runStatus }: JobCardProps) {
  const Icon = stageIcons[stage.key];
  const failed = stage.status === "failed";
  const canceled = runStatus === "canceled" && stage.status === "skipped";
  const waiting = stage.status === "waiting" || stage.status === "pending" || stage.status === "running";
  const tone = canceled ? "canceled" : stage.status;
  const firstLog = stage.logs[0];
  const errorLine = stage.logs.find((line) => /失败|失败|failed|error/i.test(line)) ?? "任务执行失败，请检查构建集群和运行日志。";
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
