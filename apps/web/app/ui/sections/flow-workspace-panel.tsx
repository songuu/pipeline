"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Activity, Boxes, Database, GitBranch, Rocket, Settings, ShieldCheck } from "lucide-react";
import type { FlowNavKey } from "../layouts/flow-sidebar";
import type {
  PipelineRun,
  PlatformSnapshot,
  TektonComponent,
  TektonComponentStatus,
  TektonPipelineBinding,
  TektonWorkspaceBinding,
} from "@deploy-management/shared";

type WorkspacePanelKey = Extract<FlowNavKey, "runs" | "tekton" | "usage" | "settings">;

interface FlowWorkspacePanelProps {
  snapshot: PlatformSnapshot;
  activeKey: WorkspacePanelKey;
  onSelectRun: (runId: string) => void;
}

export function FlowWorkspacePanel({ snapshot, activeKey, onSelectRun }: FlowWorkspacePanelProps) {
  const content = panelCopy[activeKey];

  return (
    <section className="flow-content flow-workspace-panel">
      <header className="flow-workspace-head">
        <span>{content.eyebrow}</span>
        <h1>{content.title}</h1>
        <p>{content.description}</p>
      </header>

      {activeKey === "runs" && <RunsPanel snapshot={snapshot} onSelectRun={onSelectRun} />}
      {activeKey === "tekton" && <TektonPanel snapshot={snapshot} />}
      {activeKey === "usage" && <UsagePanel snapshot={snapshot} />}
      {activeKey === "settings" && <SettingsPanel snapshot={snapshot} />}
    </section>
  );
}

function RunsPanel({ snapshot, onSelectRun }: { snapshot: PlatformSnapshot; onSelectRun: (runId: string) => void }) {
  const runs = [...snapshot.runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return (
    <div className="flow-workspace-list">
      {runs.length > 0 ? (
        runs.map((run) => (
          <button key={run.id} className="flow-workspace-row" onClick={() => onSelectRun(run.id)}>
            <span className={`status-dot ${run.status}`} />
            <strong>{run.pipelineName}</strong>
            <em>{run.branch || run.refName} · {run.commit.slice(0, 8)} · {run.environment}</em>
            <small>{run.createdAt.replace("T", " ").slice(0, 19)}</small>
            <span className={`status-badge ${run.status}`}>{runStatusLabel(run.status)}</span>
          </button>
        ))
      ) : (
        <WorkspaceEmpty icon={<Activity size={20} />} title="暂无运行记录" description="触发一次流水线后，这里会展示 PipelineRun 历史。" />
      )}
    </div>
  );
}

function TektonPanel({ snapshot }: { snapshot: PlatformSnapshot }) {
  const details = useMemo(() => buildTektonDetails(snapshot), [snapshot]);
  const [selectedDetailId, setSelectedDetailId] = useState("overview");
  const readyComponents = snapshot.tekton.components.filter((component) => component.status === "ready").length;
  const selectedDetail = details.find((detail) => detail.id === selectedDetailId) ?? details[0];
  const selectDetail = (detailId: string) => setSelectedDetailId(detailId);

  return (
    <div className="flow-workspace-grid tekton-interactive-grid">
      <button
        className={selectedDetail.id === "overview" ? "flow-workspace-card primary selected" : "flow-workspace-card primary"}
        onClick={() => selectDetail("overview")}
      >
        <ShieldCheck size={18} />
        <span>控制面状态</span>
        <strong>{readyComponents}/{snapshot.tekton.components.length} Ready</strong>
        <em>{snapshot.tekton.cluster.context} · {snapshot.tekton.operator.targetNamespace}</em>
      </button>
      <button
        className={selectedDetail.id === "resolver" ? "flow-workspace-card selected" : "flow-workspace-card"}
        onClick={() => selectDetail("resolver")}
      >
        <GitBranch size={18} />
        <span>Resolver / PipelineRef</span>
        <strong>{snapshot.tekton.cluster.pipelineRefConfigured ? "已配置" : "未配置"}</strong>
        <em>{snapshot.tekton.bindings.length} 个流水线绑定</em>
      </button>
      <button
        className={selectedDetail.id === "workspaces" ? "flow-workspace-card selected" : "flow-workspace-card"}
        onClick={() => selectDetail("workspaces")}
      >
        <Database size={18} />
        <span>Workspaces</span>
        <strong>{snapshot.tekton.cluster.sourcePvcConfigured ? "PVC Ready" : "等待 source PVC"}</strong>
        <em>{snapshot.tekton.cluster.namespaces.join(" / ")}</em>
      </button>
      <div className="flow-workspace-wide tekton-components-panel">
        <h2>Tekton 组件</h2>
        <div className="flow-workspace-list compact">
          {snapshot.tekton.components.map((component) => (
            <button
              key={`${component.namespace}-${component.name}`}
              className={
                selectedDetail.id === componentDetailId(component)
                  ? "flow-workspace-row selected"
                  : "flow-workspace-row"
              }
              onClick={() => selectDetail(componentDetailId(component))}
            >
              <span className={`status-dot ${componentStatusClass(component.status)}`} />
              <strong>{component.name}</strong>
              <em>{component.namespace} · {component.version}</em>
              <small>{component.readyReplicas}/{component.desiredReplicas} replicas</small>
              <span className={`status-badge ${componentStatusClass(component.status)}`}>{component.status}</span>
            </button>
          ))}
        </div>
      </div>
      <aside className="flow-workspace-detail-panel">
        <div className="flow-detail-head">
          <span>{selectedDetail.eyebrow}</span>
          <h2>{selectedDetail.title}</h2>
          <p>{selectedDetail.description}</p>
        </div>
        <div className="flow-detail-kv">
          {selectedDetail.items.map((item) => (
            <span key={item.label}>
              <em>{item.label}</em>
              <strong>{item.value}</strong>
            </span>
          ))}
        </div>
        {selectedDetail.sections.map((section) => (
          <div key={section.title} className="flow-detail-section">
            <h3>{section.title}</h3>
            <div className="flow-detail-lines">
              {section.lines.map((line) => (
                <span key={line}>
                  {line}
                </span>
              ))}
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}

function UsagePanel({ snapshot }: { snapshot: PlatformSnapshot }) {
  return (
    <div className="flow-workspace-grid">
      {snapshot.runnerPools.map((pool) => (
        <article key={pool.id} className="flow-workspace-card">
          <Database size={18} />
          <span>{pool.name}</span>
          <strong>{pool.online}/{pool.total} 在线</strong>
          <em>队列 {pool.queue} · CPU {pool.cpuUsage}% · Memory {pool.memoryUsage}%</em>
        </article>
      ))}
      <div className="flow-workspace-wide">
        <h2>环境用量</h2>
        <div className="flow-workspace-list compact">
          {snapshot.environments.map((environment) => (
            <span key={environment.id} className="flow-workspace-row static">
              <span className={`status-dot ${environment.status}`} />
              <strong>{environment.name}</strong>
              <em>{environment.cluster} · active runs {environment.activeRuns}</em>
              <small>{environment.currentImage ?? environment.currentVersion}</small>
              <span className={`status-badge ${environment.status}`}>{environment.status}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({ snapshot }: { snapshot: PlatformSnapshot }) {
  const settings = [
    ["执行器", snapshot.tekton.cluster.executorMode],
    ["PipelineRef", snapshot.tekton.cluster.pipelineRefConfigured ? "已配置" : "未配置"],
    ["source PVC", snapshot.tekton.cluster.sourcePvcConfigured ? "已配置" : "未配置"],
    ["Docker Secret", snapshot.tekton.cluster.dockerSecretFallbackConfigured ? "已配置" : "未配置"],
    ["本地 ACR 密码", snapshot.tekton.cluster.localRegistryPasswordConfigured ? "已配置" : "未配置"],
    ["模拟兜底", snapshot.tekton.cluster.simulatedFallbackEnabled ? "开启" : "关闭"],
  ];

  return (
    <div className="flow-workspace-grid">
      <article className="flow-workspace-card primary">
        <Settings size={18} />
        <span>全局运行配置</span>
        <strong>{snapshot.tekton.cluster.executorMode}</strong>
        <em>影响拉取代码、真实打包、Docker push 和后续上线流程。</em>
      </article>
      <article className="flow-workspace-card">
        <Boxes size={18} />
        <span>制品</span>
        <strong>{snapshot.artifacts.length} 个制品</strong>
        <em>{snapshot.releases.length} 条上线记录</em>
      </article>
      <article className="flow-workspace-card">
        <Rocket size={18} />
        <span>环境</span>
        <strong>{snapshot.environments.length} 个环境</strong>
        <em>{snapshot.environments.filter((environment) => environment.status === "healthy").length} 个健康</em>
      </article>
      <div className="flow-workspace-wide">
        <h2>配置项</h2>
        <div className="flow-settings-list">
          {settings.map(([label, value]) => (
            <span key={label}>
              <em>{label}</em>
              <strong>{value}</strong>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

type TektonDetail = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  items: Array<{ label: string; value: string }>;
  sections: Array<{ title: string; lines: string[] }>;
};

function buildTektonDetails(snapshot: PlatformSnapshot): TektonDetail[] {
  const readyComponents = snapshot.tekton.components.filter((component) => component.status === "ready").length;
  const workspaceBindings = snapshot.tekton.bindings.flatMap((binding) => binding.workspaceBindings);

  return [
    {
      id: "overview",
      eyebrow: "Control Plane",
      title: "Tekton 控制面状态",
      description: "Operator、Pipeline、Triggers、Results、Chains 等组件的整体健康度。",
      items: [
        { label: "context", value: snapshot.tekton.cluster.context },
        { label: "executor", value: snapshot.tekton.cluster.executorMode },
        { label: "ready", value: `${readyComponents}/${snapshot.tekton.components.length}` },
        { label: "profile", value: snapshot.tekton.operator.profile },
        { label: "operator", value: snapshot.tekton.operator.tektonConfigName },
        { label: "namespace", value: snapshot.tekton.operator.targetNamespace },
      ],
      sections: [
        {
          title: "关键配置",
          lines: [
            `PipelineRef: ${snapshot.tekton.cluster.pipelineRefConfigured ? "已配置" : "未配置"}`,
            `source PVC: ${snapshot.tekton.cluster.sourcePvcConfigured ? "已配置" : "未配置"}`,
            `Docker Secret: ${snapshot.tekton.cluster.dockerSecretFallbackConfigured ? "已配置" : "未配置"}`,
            `模拟兜底: ${snapshot.tekton.cluster.simulatedFallbackEnabled ? "开启" : "关闭"}`,
          ],
        },
        {
          title: "命名空间",
          lines: snapshot.tekton.cluster.namespaces,
        },
      ],
    },
    {
      id: "resolver",
      eyebrow: "Resolver / PipelineRef",
      title: "Pipeline Resolver 详情",
      description: "展示当前流水线如何通过 cluster/git/bundle/hub resolver 绑定到 Tekton Pipeline。",
      items: [
        { label: "bindings", value: `${snapshot.tekton.bindings.length}` },
        { label: "configured", value: snapshot.tekton.cluster.pipelineRefConfigured ? "已配置" : "未配置" },
        { label: "default resolver", value: snapshot.tekton.bindings[0]?.resolver ?? "cluster" },
      ],
      sections: [
        {
          title: "流水线绑定",
          lines: snapshot.tekton.bindings.length > 0
            ? snapshot.tekton.bindings.map(formatBindingLine)
            : ["暂无 Pipeline 绑定，保存流水线配置后生成。"],
        },
        {
          title: "Resolver 引用",
          lines: snapshot.tekton.bindings.length > 0
            ? snapshot.tekton.bindings.map((binding) =>
                `${binding.resolverRef.resourceKind}/${binding.resolverRef.name} · ${binding.resolverRef.source} · ${binding.resolverRef.revision}`,
              )
            : ["暂无 Resolver 引用。"],
        },
      ],
    },
    {
      id: "workspaces",
      eyebrow: "Workspaces",
      title: "Workspace 绑定详情",
      description: "展示源码、缓存、docker config、kubeconfig 等 Tekton Workspace 挂载来源。",
      items: [
        { label: "source PVC", value: snapshot.tekton.cluster.sourcePvcConfigured ? "Ready" : "Pending" },
        { label: "bindings", value: `${workspaceBindings.length}` },
        { label: "namespaces", value: `${snapshot.tekton.cluster.namespaces.length}` },
      ],
      sections: [
        {
          title: "Workspace 绑定",
          lines: workspaceBindings.length > 0 ? workspaceBindings.map(formatWorkspaceLine) : ["暂无 Workspace 绑定。"],
        },
        {
          title: "命名空间",
          lines: snapshot.tekton.cluster.namespaces,
        },
      ],
    },
    ...snapshot.tekton.components.map(componentDetail),
  ];
}

function componentDetail(component: TektonComponent): TektonDetail {
  return {
    id: componentDetailId(component),
    eyebrow: "Tekton Component",
    title: `${component.name} 组件详情`,
    description: component.description,
    items: [
      { label: "namespace", value: component.namespace },
      { label: "version", value: component.version },
      { label: "status", value: component.status },
      { label: "replicas", value: `${component.readyReplicas}/${component.desiredReplicas}` },
    ],
    sections: [
      {
        title: "运行状态",
        lines: [
          `Ready replicas: ${component.readyReplicas}`,
          `Desired replicas: ${component.desiredReplicas}`,
          `状态: ${component.status}`,
        ],
      },
      {
        title: "排查入口",
        lines: [
          `kubectl -n ${component.namespace} get pods`,
          `kubectl -n ${component.namespace} describe deployment ${component.name.toLowerCase()}`,
        ],
      },
    ],
  };
}

function componentDetailId(component: TektonComponent): string {
  return `component:${component.namespace}:${component.name}`;
}

function formatBindingLine(binding: TektonPipelineBinding): string {
  return `${binding.namespace}/${binding.pipelineName} · ${binding.resolver} · SA ${binding.serviceAccountName}`;
}

function formatWorkspaceLine(workspace: TektonWorkspaceBinding): string {
  const source = workspace.claimName ?? workspace.secretName ?? workspace.configMapName ?? workspace.type;
  return `${workspace.name} · ${workspace.type} · ${source} · ${workspace.mountPath}`;
}

function WorkspaceEmpty({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flow-workspace-empty">
      {icon}
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

const panelCopy: Record<WorkspacePanelKey, { eyebrow: string; title: string; description: string }> = {
  runs: {
    eyebrow: "PipelineRun History",
    title: "运行记录",
    description: "按时间查看真实触发过的流水线运行，点击任意记录可进入实时执行详情。",
  },
  tekton: {
    eyebrow: "Tekton Control Plane",
    title: "Tekton 控制面",
    description: "查看当前执行器、组件状态、Resolver、Workspace 和 Pipeline 绑定情况。",
  },
  usage: {
    eyebrow: "Resource Usage",
    title: "资源用量",
    description: "查看 runner pool、环境活跃运行数和当前部署版本。",
  },
  settings: {
    eyebrow: "Global Settings",
    title: "全局设置",
    description: "展示影响真实拉取、打包、上传和上线的关键运行配置。",
  },
};

function runStatusLabel(status: PipelineRun["status"]): string {
  const labels: Record<PipelineRun["status"], string> = {
    queued: "Queued",
    running: "Running",
    waiting_approval: "Waiting",
    success: "Success",
    failed: "Failed",
    canceled: "Canceled",
  };
  return labels[status];
}

function componentStatusClass(status: TektonComponentStatus): string {
  return status === "ready" ? "success" : status === "degraded" ? "failed" : "skipped";
}
