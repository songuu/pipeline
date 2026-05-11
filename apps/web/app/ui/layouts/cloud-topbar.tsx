"use client";

import { Archive, CheckCircle2, ChevronDown, KeyRound, ListChecks, Plus } from "lucide-react";

interface CloudTopbarProps {
  onCreate: () => void;
  onAction: (message: string) => void;
  onOpenList: () => void;
}

export function CloudTopbar({ onCreate, onAction, onOpenList }: CloudTopbarProps) {
  const openTektonDocs = () => {
    window.open("https://tekton.dev/docs/", "_blank", "noopener,noreferrer");
    onAction("已打开 Tekton 文档");
  };

  return (
    <header className="codeup-topbar">
      <div className="cloud-left">
        <button className="app-grid" aria-label="应用菜单" onClick={() => onAction("应用菜单已展开：流水线、代码源、制品、环境")}>
          <ListChecks size={16} />
        </button>
        <div className="flow-mark topbar-flow-mark">F</div>
        <button className="breadcrumb-link breadcrumb-button" onClick={onOpenList}>
          云效 DevOps
        </button>
        <span className="breadcrumb-separator">›</span>
        <strong>流水线 Flow</strong>
        <button className="plain-icon" aria-label="切换产品" onClick={() => onAction("当前产品：流水线 Flow")}>
          <ChevronDown size={14} />
        </button>
        <span className="topbar-divider" />
        <button className="plain-icon" aria-label="代码源" onClick={() => onAction("代码源已绑定到当前流水线源")}>
          <Archive size={15} />
        </button>
        <button className="plain-icon muted" aria-label="收藏" onClick={() => onAction("已收藏 Flow 工作台")}>
          <CheckCircle2 size={15} />
        </button>
      </div>
      <div className="cloud-actions">
        <button className="round-blue" aria-label="新增" onClick={onCreate}>
          <Plus size={15} />
        </button>
        <button className="plain-icon" aria-label="帮助" onClick={openTektonDocs}>
          <KeyRound size={15} />
        </button>
        <button className="avatar avatar-button" aria-label="用户菜单" onClick={() => onAction("当前用户：RO，可保存、运行和审批流水线")}>
          RO
        </button>
      </div>
    </header>
  );
}
