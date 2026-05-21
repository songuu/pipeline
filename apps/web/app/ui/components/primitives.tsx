"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { Activity, Archive, Ban, Check, PauseCircle, Plus, Search, Trash2, X, XCircle } from "lucide-react";
import type { PipelineRun } from "@deploy-management/shared";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-item">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    const textArea = document.createElement("textarea");
    textArea.value = value;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.select();
    const copied = document.execCommand("copy");
    textArea.remove();
    return copied;
  } catch {
    return false;
  }
}

export function ActionToast({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="action-toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function Switch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  };

  return (
    <span
      className={enabled ? "switch on" : "switch"}
      role="switch"
      tabIndex={0}
      aria-checked={enabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onKeyDown={handleKeyDown}
    />
  );
}

export function WebhookField({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy?: (value: string, label: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="webhook-copy-input">
        <input value={value} readOnly />
        <button type="button" aria-label={`复制${label}`} onClick={() => onCopy?.(value, label)}>
          <Archive size={16} />
        </button>
      </div>
    </Field>
  );
}

export function MiniFlow({ chips, groups }: { chips?: string[]; groups?: string[][] }) {
  const flowGroups = groups?.length ? groups : (chips ?? []).map((chip) => [chip]);
  return (
    <div className="mini-flow">
      {flowGroups.map((group, groupIndex) => (
        <span
          className={group.length > 1 ? "mini-flow-group parallel" : "mini-flow-group"}
          key={`${group.join("-")}-${groupIndex}`}
        >
          {group.map((chip) => (
            <i key={chip} title={chip}>{chip}</i>
          ))}
        </span>
      ))}
    </div>
  );
}

export function StatusBadge({ status }: { status: PipelineRun["status"] }) {
  const labels: Record<PipelineRun["status"], string> = {
    queued: "排队中",
    running: "运行中",
    waiting_approval: "待审批",
    success: "运行成功",
    failed: "运行失败",
    canceled: "已取消",
  };
  const Icon =
    status === "success"
      ? Check
      : status === "failed"
      ? XCircle
      : status === "canceled"
      ? Ban
      : status === "waiting_approval"
      ? PauseCircle
      : Activity;
  return (
    <span className={`status-badge ${status}`}>
      <Icon size={13} />
      {labels[status]}
    </span>
  );
}

export function VariableTable({
  title,
  columns,
  rows = [],
  onCreate,
  onCellChange,
  onDeleteRow,
  readOnlyColumnIndexes = [],
  selectOptionsByColumn = {},
}: {
  title: string;
  columns: string[];
  rows?: string[][];
  onCreate?: () => void;
  onCellChange?: (rowIndex: number, columnIndex: number, value: string) => void;
  onDeleteRow?: (rowIndex: number) => void;
  readOnlyColumnIndexes?: number[];
  selectOptionsByColumn?: Record<number, string[]>;
}) {
  const actionColumnIndex = columns.findIndex((column) => column === "操作");
  const gridTemplateColumns = variableTableGridTemplate(columns);
  return (
    <section className="variable-table-block">
      <div className="variable-table-title">
        <strong>{title}</strong>
        <div>
          <Search size={16} />
          <button type="button" onClick={onCreate}>
            <Plus size={14} />
            新建变量
          </button>
        </div>
      </div>
      <div className="variable-table">
        <div
          className="variable-table-head"
          style={{ gridTemplateColumns }}
        >
          {columns.map((column) => (
            <span key={column}>{column}</span>
          ))}
        </div>
        {rows.length > 0 ? (
          rows.map((row, rowIndex) => (
            <div
              className="variable-table-row"
              key={`${title}-${rowIndex}`}
              style={{ gridTemplateColumns }}
            >
              {columns.map((column, columnIndex) => {
                const isActionColumn = columnIndex === actionColumnIndex;
                const isReadOnly = readOnlyColumnIndexes.includes(columnIndex) || !onCellChange;
                const selectOptions = selectOptionsByColumn[columnIndex];
                if (isActionColumn) {
                  return (
                    <span className="variable-table-actions" key={`${column}-${columnIndex}`}>
                      {onDeleteRow ? (
                        <button
                          type="button"
                          className="variable-row-action"
                          onClick={() => onDeleteRow(rowIndex)}
                          aria-label={`删除${row[0] ?? "变量"}`}
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : (
                        row[columnIndex] ?? "-"
                      )}
                    </span>
                  );
                }
                if (column === "状态") {
                  return (
                    <span className="variable-status-pill" key={`${column}-${columnIndex}`}>
                      {row[columnIndex] ?? "已启用"}
                    </span>
                  );
                }
                if (isReadOnly) {
                  return <span key={`${column}-${columnIndex}`}>{row[columnIndex] ?? "-"}</span>;
                }
                if (selectOptions?.length) {
                  return (
                    <select
                      key={`${column}-${columnIndex}`}
                      value={row[columnIndex] ?? selectOptions[0]}
                      onChange={(event) => onCellChange(rowIndex, columnIndex, event.target.value)}
                      aria-label={`${title}-${column}-${rowIndex + 1}`}
                    >
                      {selectOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  );
                }
                return (
                  <input
                    key={`${column}-${columnIndex}`}
                    value={row[columnIndex] ?? ""}
                    onChange={(event) => onCellChange(rowIndex, columnIndex, event.target.value)}
                    aria-label={`${title}-${column}-${rowIndex + 1}`}
                  />
                );
              })}
            </div>
          ))
        ) : (
          <div className="empty-illustration">
            <span />
            <em>没有数据</em>
          </div>
        )}
      </div>
    </section>
  );
}

function variableTableGridTemplate(columns: string[]): string {
  return columns
    .map((column) => {
      if (column === "操作") return "72px";
      if (column === "状态") return "92px";
      if (column === "私密模式") return "104px";
      if (column === "运行时设置") return "126px";
      if (column === "选项") return "minmax(180px, 1.2fr)";
      if (column === "描述") return "minmax(180px, 1.3fr)";
      if (column === "变量名称") return "minmax(150px, 1fr)";
      if (column === "默认值") return "minmax(140px, 0.9fr)";
      return "minmax(120px, 1fr)";
    })
    .join(" ");
}

export function CloseButton({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <button className="plain-icon" onClick={onClose} aria-label={label}>
      <X size={18} />
    </button>
  );
}
