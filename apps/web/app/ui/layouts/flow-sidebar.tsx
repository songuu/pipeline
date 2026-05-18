"use client";

import {
  Activity,
  Archive,
  Boxes,
  Database,
  GitPullRequest,
  ListChecks,
  Plus,
  Settings,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type FlowNavKey =
  | "list"
  | "all"
  | "groups"
  | "ungrouped"
  | "runs"
  | "artifacts"
  | "tekton"
  | "usage"
  | "settings";

const flowSideItems: Array<{ key: FlowNavKey; label: string; icon: LucideIcon }> = [
  { key: "list", label: "我的流水线", icon: Workflow },
  { key: "all", label: "全部流水线", icon: Activity },
  { key: "groups", label: "已分组", icon: ListChecks },
  { key: "ungrouped", label: "未分组", icon: Archive },
  { key: "runs", label: "运行记录", icon: GitPullRequest },
  { key: "artifacts", label: "制品与镜像", icon: Boxes },
  { key: "tekton", label: "Tekton 控制面", icon: ShieldCheck },
];

export function FlowSidebar({
  activeKey = "list",
  onSelect,
}: {
  activeKey?: FlowNavKey;
  onSelect: (key: FlowNavKey, label: string) => void;
}) {
  return (
    <aside className="flow-sidebar">
      <div className="flow-brand">
        <div className="flow-mark">F</div>
        <strong>流水线 Flow</strong>
      </div>
      <div className="flow-nav">
        {flowSideItems.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={`${item.label}-${index}`}
              className={item.key === activeKey ? "flow-nav-item active" : "flow-nav-item"}
              onClick={() => onSelect(item.key, item.label)}
            >
              <Icon size={16} />
              <span>{item.label}</span>
              {index === 2 && <Plus size={16} />}
            </button>
          );
        })}
      </div>
      <div className="repo-footer">
        <button
          className={activeKey === "usage" ? "repo-nav-item active" : "repo-nav-item"}
          onClick={() => onSelect("usage", "资源用量")}
        >
          <Database size={16} />
          <span>资源用量</span>
        </button>
        <button
          className={activeKey === "settings" ? "repo-nav-item active" : "repo-nav-item"}
          onClick={() => onSelect("settings", "全局设置")}
        >
          <Settings size={16} />
          <span>全局设置</span>
        </button>
      </div>
    </aside>
  );
}
