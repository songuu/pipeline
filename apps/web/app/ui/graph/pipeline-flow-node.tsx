"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { StageStatus } from "@deploy-management/shared";
import type { PipelineGraphNode } from "./pipeline-graph-types";

const STATUS_COLOR: Record<StageStatus, { bg: string; text: string; border: string; dot: string }> = {
  pending: { bg: "#f4f5f7", text: "#64748b", border: "#d8e0ea", dot: "#94a3b8" },
  waiting: { bg: "#fff6df", text: "#7c5300", border: "#f1cf6c", dot: "#d98900" },
  running: { bg: "#e8f3ff", text: "#0b63d9", border: "#7bb6ff", dot: "#1677ff" },
  success: { bg: "#e9f8f1", text: "#0d7c52", border: "#7ad5ad", dot: "#13a872" },
  failed: { bg: "#fff0f0", text: "#a82029", border: "#f1a3a8", dot: "#d9363e" },
  skipped: { bg: "#f4f5f7", text: "#8b9aaa", border: "#d8e0ea", dot: "#cbd5e1" },
};

const STATUS_LABEL: Record<StageStatus, string> = {
  pending: "待执行",
  waiting: "等待",
  running: "运行中",
  success: "成功",
  failed: "失败",
  skipped: "跳过",
};

function formatDuration(durationMs?: number): string {
  if (!durationMs || durationMs <= 0) return "";
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return remain === 0 ? `${minutes}m` : `${minutes}m${remain}s`;
}

function PipelineFlowNodeImpl({ data, selected }: NodeProps<PipelineGraphNode>) {
  const status: StageStatus = data.status ?? "pending";
  const palette = STATUS_COLOR[status];
  const duration = formatDuration(data.durationMs);
  const isRunning = status === "running";

  return (
    <div
      style={{
        minWidth: 180,
        maxWidth: 240,
        padding: "10px 12px",
        background: palette.bg,
        color: palette.text,
        border: `1px solid ${selected ? "#1677ff" : palette.border}`,
        borderRadius: 10,
        boxShadow: selected ? "0 0 0 2px rgba(22,119,255,0.25)" : "0 1px 2px rgba(15,23,42,0.04)",
        fontFamily: 'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif',
        fontSize: 13,
        opacity: data.disabled ? 0.55 : 1,
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: palette.border, width: 6, height: 6 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: palette.dot,
            boxShadow: isRunning ? `0 0 0 4px ${palette.dot}33` : "none",
            animation: isRunning ? "pipeline-flow-pulse 1.6s ease-in-out infinite" : undefined,
          }}
        />
        <span style={{ fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {data.title}
        </span>
        <span style={{ fontSize: 11, color: palette.text, opacity: 0.75 }}>{STATUS_LABEL[status]}</span>
      </div>
      {data.subtitle ? (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: palette.text,
            opacity: 0.7,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {data.subtitle}
        </div>
      ) : null}
      <div style={{ marginTop: 6, display: "flex", gap: 10, fontSize: 11, color: palette.text, opacity: 0.85 }}>
        {typeof data.commandCount === "number" ? <span>{data.commandCount} 命令</span> : null}
        {typeof data.artifactCount === "number" ? <span>{data.artifactCount} 产物</span> : null}
        {duration ? <span>{duration}</span> : null}
      </div>
      {status === "failed" && data.errorSummary ? (
        <div style={{ marginTop: 6, fontSize: 11, color: "#a82029", fontWeight: 500 }}>
          {data.errorSummary}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} style={{ background: palette.border, width: 6, height: 6 }} />
    </div>
  );
}

export const PipelineFlowNode = memo(PipelineFlowNodeImpl);
