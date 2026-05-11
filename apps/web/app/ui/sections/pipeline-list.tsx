"use client";

import { useMemo, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Filter,
  HardDrive,
  History,
  ListChecks,
  MoreHorizontal,
  Play,
  Plus,
  Rocket,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { PipelineDefinition, PipelineRun, PlatformSnapshot, TektonPipelineBinding } from "@deploy-management/shared";

interface PipelineListProps {
  snapshot: PlatformSnapshot;
  query: string;
  onQueryChange: (value: string) => void;
  selectedPipelineId?: string;
  onOpenTemplates: () => void;
  onRefresh: () => void;
  onSelectPipeline: (pipelineId: string) => void;
  onSelectRun: (runId: string, pipelineId: string) => void;
  onRunPipeline: (pipeline: PipelineDefinition) => void;
  onEditPipeline: (pipeline: PipelineDefinition) => void;
  onCopy: (value: string, label: string) => void;
  onNotify: (message: string) => void;
}

export function PipelineList({
  snapshot,
  query,
  onQueryChange,
  selectedPipelineId,
  onOpenTemplates,
  onRefresh,
  onSelectPipeline,
  onSelectRun,
  onRunPipeline,
  onEditPipeline,
  onCopy,
  onNotify,
}: PipelineListProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [activeScope, setActiveScope] = useState<"joined" | "favorite">("joined");
  const [viewMode, setViewMode] = useState<"compact" | "detail">("compact");
  const [showFilters, setShowFilters] = useState(false);
  const [environmentFilter, setEnvironmentFilter] = useState("all");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const pipelines = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return snapshot.pipelines.filter((pipeline) => {
      const matchesKeyword =
        !keyword ||
        [pipeline.name, pipeline.repository, pipeline.owner, pipeline.targetEnvironment].some((value) =>
          value.toLowerCase().includes(keyword),
        );
      const matchesEnvironment = environmentFilter === "all" || pipeline.targetEnvironment === environmentFilter;
      const matchesScope = activeScope === "joined" || favoriteIds.includes(pipeline.id);
      return matchesKeyword && matchesEnvironment && matchesScope;
    });
  }, [activeScope, environmentFilter, favoriteIds, query, snapshot.pipelines]);

  const tekton = snapshot.tekton;
  const readyComponents = tekton.components.filter((component) => component.status === "ready").length;
  const taskRunCount = tekton.runRecords.reduce((total, record) => total + record.childReferences.length, 0);
  const resultRecords = tekton.bindings.reduce((total, binding) => total + binding.results.records, 0);
  const signedArtifacts = tekton.bindings.reduce((total, binding) => total + binding.chains.signedArtifacts, 0);
  const allVisibleSelected = pipelines.length > 0 && pipelines.every((pipeline) => selectedIds.includes(pipeline.id));

  const toggleFavorite = (pipeline: PipelineDefinition) => {
    const favorited = favoriteIds.includes(pipeline.id);
    setFavoriteIds(
      favorited ? favoriteIds.filter((id) => id !== pipeline.id) : [...favoriteIds, pipeline.id],
    );
    onNotify(favorited ? "已取消收藏" : "已收藏流水线");
  };

  const toggleSelect = (pipelineId: string) => {
    setSelectedIds((ids) =>
      ids.includes(pipelineId) ? ids.filter((id) => id !== pipelineId) : [...ids, pipelineId],
    );
  };

  const toggleSelectAll = () => {
    setSelectedIds(allVisibleSelected ? [] : pipelines.map((pipeline) => pipeline.id));
  };

  return (
    <section className="flow-content">
      <div className="flow-header">
        <h1>我的流水线</h1>
        <div className="flow-tools">
          <label className="cloud-search">
            <Search size={16} />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索流水线、仓库、环境"
            />
          </label>
          <button className="cloud-icon-button" aria-label="刷新" onClick={onRefresh}>
            <Activity size={16} />
          </button>
          <button className="yunxiao-primary" onClick={onOpenTemplates}>
            <Rocket size={15} />
            新建流水线
          </button>
        </div>
      </div>
      <div className="flow-health-strip">
        <article className="flow-health-card ready">
          <span>Tekton 控制面</span>
          <strong>
            {readyComponents}/{tekton.components.length} 组件 Ready
          </strong>
          <small>{tekton.operator.tektonConfigName} · profile {tekton.operator.profile}</small>
        </article>
        <article className="flow-health-card">
          <span>PipelineRun / TaskRun</span>
          <strong>
            {tekton.runRecords.length} / {taskRunCount}
          </strong>
          <small>{tekton.cluster.context}</small>
        </article>
        <article className="flow-health-card">
          <span>Results 记录</span>
          <strong>{resultRecords}</strong>
          <small>长期日志、Run Record、审计查询</small>
        </article>
        <article className="flow-health-card">
          <span>Chains 签名制品</span>
          <strong>{signedArtifacts}</strong>
          <small>SLSA provenance / in-toto attestation</small>
        </article>
      </div>
      <div className="flow-tabs">
        <button className={activeScope === "joined" ? "active" : ""} onClick={() => setActiveScope("joined")}>
          我参与的
        </button>
        <button className={activeScope === "favorite" ? "active" : ""} onClick={() => setActiveScope("favorite")}>
          我的收藏
        </button>
        <button onClick={onOpenTemplates}>
          <Plus size={15} /> 添加
        </button>
        <div className="flow-view-tools">
          <button className="icon-only" aria-label="聚焦搜索" onClick={() => searchInputRef.current?.focus()}>
            <Search size={16} />
          </button>
          <button
            className={showFilters ? "icon-only active" : "icon-only"}
            aria-label="筛选"
            onClick={() => setShowFilters((value) => !value)}
          >
            <Filter size={16} />
          </button>
          <button className="icon-only" aria-label="批量选择" onClick={toggleSelectAll}>
            <ListChecks size={16} />
          </button>
          <button className={viewMode === "compact" ? "active" : ""} onClick={() => setViewMode("compact")}>
            <ListChecks size={15} />
            精简
          </button>
          <button className={viewMode === "detail" ? "active" : ""} onClick={() => setViewMode("detail")}>
            <HardDrive size={15} />
            详细
          </button>
        </div>
      </div>
      {showFilters && (
        <div className="flow-filter-bar">
          <label>
            环境
            <select value={environmentFilter} onChange={(event) => setEnvironmentFilter(event.target.value)}>
              <option value="all">全部</option>
              <option value="dev">dev</option>
              <option value="test">test</option>
              <option value="staging">staging</option>
              <option value="prod">prod</option>
            </select>
          </label>
          <button
            className="cloud-secondary"
            onClick={() => {
              setEnvironmentFilter("all");
              onQueryChange("");
            }}
          >
            清空筛选
          </button>
        </div>
      )}
      <div className={viewMode === "detail" ? "flow-table detail" : "flow-table"}>
        <div className="flow-table-head">
          <span>
            <input type="checkbox" aria-label="全选流水线" checked={allVisibleSelected} onChange={toggleSelectAll} />
          </span>
          <span>流水线名称</span>
          <span>代码源</span>
          <span>Tekton Pipeline</span>
          <span>最近运行</span>
          <span>Results / Chains</span>
          <span>操作</span>
        </div>
        {pipelines.map((pipeline) => {
          const latestRun = snapshot.runs
            .filter((run) => run.pipelineId === pipeline.id)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
          const binding = snapshot.tekton.bindings.find((item) => item.pipelineId === pipeline.id);
          return (
            <PipelineRow
              key={pipeline.id}
              pipeline={pipeline}
              binding={binding}
              isSelected={pipeline.id === selectedPipelineId}
              latestRun={latestRun}
              selected={selectedIds.includes(pipeline.id)}
              favorited={favoriteIds.includes(pipeline.id)}
              menuOpen={openMenuId === pipeline.id}
              onToggleSelected={() => toggleSelect(pipeline.id)}
              onToggleFavorite={() => toggleFavorite(pipeline)}
              onClickName={() => onSelectPipeline(pipeline.id)}
              onClickRunTime={() =>
                latestRun ? onSelectRun(latestRun.id, pipeline.id) : onSelectPipeline(pipeline.id)
              }
              onRun={() => onRunPipeline(pipeline)}
              onEdit={() => onEditPipeline(pipeline)}
              onCopy={() => void onCopy(pipeline.id, "流水线 ID")}
              onToggleMenu={() => setOpenMenuId(openMenuId === pipeline.id ? null : pipeline.id)}
            />
          );
        })}
        {pipelines.length === 0 && (
          <div className="flow-empty-state">没有匹配的流水线，调整筛选条件或新建流水线。</div>
        )}
      </div>
    </section>
  );
}

interface PipelineRowProps {
  pipeline: PipelineDefinition;
  binding?: TektonPipelineBinding;
  isSelected: boolean;
  latestRun?: PipelineRun;
  selected: boolean;
  favorited: boolean;
  menuOpen: boolean;
  onToggleSelected: () => void;
  onToggleFavorite: () => void;
  onClickName: () => void;
  onClickRunTime: () => void;
  onRun: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onToggleMenu: () => void;
}

function PipelineRow({
  pipeline,
  binding,
  isSelected,
  latestRun,
  selected,
  favorited,
  menuOpen,
  onToggleSelected,
  onToggleFavorite,
  onClickName,
  onClickRunTime,
  onRun,
  onEdit,
  onCopy,
  onToggleMenu,
}: PipelineRowProps) {
  return (
    <div className={isSelected ? "flow-table-row selected" : "flow-table-row"}>
      <span>
        <input type="checkbox" aria-label={`选择 ${pipeline.name}`} checked={selected} onChange={onToggleSelected} />
      </span>
      <button className="flow-name" onClick={onClickName}>
        <strong>{pipeline.name}</strong>
        <small>
          {pipeline.owner} · {pipeline.strategy} · 灰度 {pipeline.canaryPercent}%
        </small>
      </button>
      <span className="repo-cell">
        {pipeline.repository}
        <small>{pipeline.defaultRefType}: {pipeline.defaultRef}</small>
      </span>
      <span className="tekton-cell">
        <strong>{binding ? `${binding.namespace}/${binding.pipelineName}` : "未绑定"}</strong>
        <small>{binding ? `${binding.resolver} resolver · ${binding.serviceAccountName}` : "等待生成 Pipeline"}</small>
      </span>
      <button className="run-time" onClick={onClickRunTime}>
        <History size={14} />
        <span>{latestRun?.createdAt.replace("T", " ").slice(0, 16) ?? "暂无运行"}</span>
      </button>
      <span className="evidence-cell">
        <span>
          <ListChecks size={14} />
          {binding?.results.records ?? 0}
        </span>
        <span>
          <ShieldCheck size={14} />
          {binding?.chains.signedArtifacts ?? 0}
        </span>
      </span>
      <span className="row-actions">
        <button
          className={favorited ? "plain-icon active" : "plain-icon"}
          aria-label="收藏"
          onClick={onToggleFavorite}
        >
          <CheckCircle2 size={15} />
        </button>
        <button className="plain-icon" aria-label="运行" onClick={onRun}>
          <Play size={15} />
        </button>
        <button className="plain-icon" aria-label="更多" onClick={onToggleMenu}>
          <MoreHorizontal size={16} />
        </button>
        {menuOpen && (
          <div className="action-menu row-action-menu">
            <button onClick={onEdit}>编辑配置</button>
            <button onClick={onCopy}>复制流水线 ID</button>
            <button onClick={onRun}>立即运行</button>
          </div>
        )}
      </span>
    </div>
  );
}
