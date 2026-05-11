"use client";

import {
  Activity,
  Archive,
  GitBranch,
  History,
  PackageCheck,
  Settings,
  ShieldCheck,
  UserCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";

const repoNavItems: Array<{ key: string; label: string; icon: LucideIcon; count?: string }> = [
  { key: "source", label: "源文件(83.01K)", icon: Archive },
  { key: "commits", label: "提交", icon: GitBranch },
  { key: "branches", label: "分支", icon: Workflow, count: "5" },
  { key: "tags", label: "标签", icon: PackageCheck, count: "1" },
  { key: "merge", label: "合并请求", icon: Activity },
  { key: "scan", label: "代码检测", icon: ShieldCheck },
  { key: "pipeline", label: "流水线", icon: Workflow },
  { key: "activity", label: "动态", icon: History },
];

export function RepoSidebar({
  onOpenList,
  onAction,
}: {
  onOpenList: () => void;
  onAction: (message: string) => void;
}) {
  return (
    <aside className="repo-sidebar">
      <div className="repo-title">
        <div className="repo-logo">C</div>
        <strong>Codeup-Demo</strong>
      </div>
      <nav className="repo-nav">
        {repoNavItems.map((item) => {
          const Icon = item.icon;
          const active = item.key === "pipeline";
          return (
            <button
              key={item.key}
              className={active ? "repo-nav-item active" : "repo-nav-item"}
              onClick={active ? onOpenList : () => onAction(`${item.label} 已切换，当前演示聚焦流水线链路`)}
            >
              <Icon size={16} />
              <span>{item.label}</span>
              {item.count && <em>{item.count}</em>}
            </button>
          );
        })}
      </nav>
      <div className="repo-footer">
        <button className="repo-nav-item" onClick={() => onAction("成员面板已打开：RO、Owner、SRE 审批人")}>
          <UserCheck size={16} />
          <span>成员</span>
        </button>
        <button className="repo-nav-item" onClick={() => onAction("仓库设置已关联到流水线默认源")}>
          <Settings size={16} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}
