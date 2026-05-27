"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Activity, Boxes, Check, Copy, MapPin, PackageCheck, Pause, Play, Rocket, RotateCcw, Server, Terminal, TrendingUp } from "lucide-react";
import type { Artifact, CanaryTrafficRegion, EnvironmentType, PackageMode, PipelineRun, PlatformSnapshot, ReleaseDeployment } from "@deploy-management/shared";
import { ReleaseEventMiniTimeline, ReleaseEventTimeline, sortReleaseEvents } from "../components/release-event-timeline";

interface ArtifactCenterProps {
  snapshot: PlatformSnapshot;
  onCopy: (value: string, label: string) => void | Promise<void>;
  onDeploy: (artifactId: string, environment: EnvironmentType) => Promise<void>;
  onCanaryDeploy: (artifactId: string, environment: EnvironmentType, regions: CanaryTrafficRegion[], baselineArtifactId?: string) => Promise<void>;
  onReleaseAction: (
    releaseId: string,
    action: "advance" | "pause" | "resume" | "promote" | "rollback",
  ) => Promise<void>;
  onRefresh: () => void;
}

const releaseTargets: EnvironmentType[] = ["test", "staging", "prod"];
const defaultCanaryRegions: CanaryTrafficRegion[] = [
  { id: "cn-hangzhou", name: "华东1（杭州）", percent: 10, enabled: true },
  { id: "cn-shanghai", name: "华东2（上海）", percent: 5, enabled: false },
  { id: "cn-beijing", name: "华北2（北京）", percent: 5, enabled: false },
  { id: "cn-shenzhen", name: "华南1（深圳）", percent: 5, enabled: false },
];

export function ArtifactCenter({ snapshot, onCopy, onDeploy, onCanaryDeploy, onReleaseAction, onRefresh }: ArtifactCenterProps) {
  const [deployingKey, setDeployingKey] = useState("");
  const [releaseActionKey, setReleaseActionKey] = useState("");
  const [copiedKey, setCopiedKey] = useState("");
  const [selectedReleaseId, setSelectedReleaseId] = useState("");
  const [canaryRegionsByArtifact, setCanaryRegionsByArtifact] = useState<Record<string, CanaryTrafficRegion[]>>({});
  const [baselineByArtifact, setBaselineByArtifact] = useState<Record<string, string>>({});
  const imageArtifacts = snapshot.artifacts.filter((artifact) => artifact.type === "image");
  const supportArtifacts = snapshot.artifacts.filter((artifact) => artifact.type !== "image");
  const latestRelease = snapshot.releases[0];
  const activeCanaries = snapshot.releases.filter((release) => release.status === "canarying" || release.status === "paused");
  const releaseEventsByReleaseId = useMemo(() => {
    return snapshot.releaseEvents.reduce<Record<string, typeof snapshot.releaseEvents>>((groups, event) => {
      groups[event.releaseId] = [...(groups[event.releaseId] ?? []), event];
      return groups;
    }, {});
  }, [snapshot.releaseEvents]);
  const selectedRelease =
    snapshot.releases.find((release) => release.id === selectedReleaseId) ??
    latestRelease ??
    snapshot.releases[0];
  const selectedReleaseEvents = selectedRelease
    ? sortReleaseEvents(releaseEventsByReleaseId[selectedRelease.id] ?? [])
    : [];
  const releaseStats = useMemo(
    () => ({
      images: imageArtifacts.length,
      packages: supportArtifacts.length,
      releases: snapshot.releases.length,
      canaries: activeCanaries.length,
      healthy: snapshot.environments.filter((environment) => environment.status === "healthy").length,
    }),
    [activeCanaries.length, imageArtifacts.length, supportArtifacts.length, snapshot.environments, snapshot.releases.length],
  );

  const copy = async (key: string, value: string, label: string) => {
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => (current === key ? "" : current)), 1500);
    await onCopy(value, label);
  };

  const deploy = async (artifactId: string, environment: EnvironmentType) => {
    const key = `${artifactId}:${environment}`;
    setDeployingKey(key);
    try {
      await onDeploy(artifactId, environment);
    } finally {
      setDeployingKey("");
    }
  };

  const canaryRegionsFor = (artifactId: string): CanaryTrafficRegion[] =>
    canaryRegionsByArtifact[artifactId] ?? defaultCanaryRegions;

  const updateCanaryRegion = (artifactId: string, regionId: string, patch: Partial<CanaryTrafficRegion>) => {
    setCanaryRegionsByArtifact((current) => {
      const regions = current[artifactId] ?? defaultCanaryRegions;
      return {
        ...current,
        [artifactId]: regions.map((region) => (region.id === regionId ? { ...region, ...patch } : region)),
      };
    });
  };

  const canaryDeploy = async (artifactId: string, environment: EnvironmentType) => {
    const key = `${artifactId}:canary:${environment}`;
    const regions = canaryRegionsFor(artifactId)
      .map((region) => ({ ...region, percent: clampPercent(region.percent) }))
      .filter((region) => region.enabled && region.percent > 0);
    const selectedBaseline = baselineByArtifact[artifactId];
    setDeployingKey(key);
    try {
      await onCanaryDeploy(artifactId, environment, regions, selectedBaseline || undefined);
    } finally {
      setDeployingKey("");
    }
  };

  const releaseAction = async (
    releaseId: string,
    action: "advance" | "pause" | "resume" | "promote" | "rollback",
  ) => {
    const key = `${releaseId}:${action}`;
    setReleaseActionKey(key);
    try {
      await onReleaseAction(releaseId, action);
    } finally {
      setReleaseActionKey("");
    }
  };

  return (
    <section className="artifact-center-page">
      <header className="artifact-center-hero">
        <div>
          <span>Artifact Registry</span>
          <h1>制品中心与上线控制台</h1>
          <p>镜像、包、provenance 和上线记录统一归档；镜像制品可以直接触发 local-docker 或后续 Kubernetes 上线。</p>
        </div>
        <button className="artifact-refresh-button" onClick={onRefresh}>
          <Server size={16} />
          刷新制品
        </button>
      </header>

      <div className="artifact-kpi-grid">
        <Metric label="镜像制品" value={releaseStats.images} />
        <Metric label="构建包" value={releaseStats.packages} />
        <Metric label="上线记录" value={releaseStats.releases} />
        <Metric label="灰度中" value={releaseStats.canaries} />
      </div>

      {latestRelease && (
        <article className={`release-live-card ${latestRelease.status}`}>
          <div>
            <Rocket size={18} />
            <span>
              <strong>{latestRelease.applicationName} 已上线到 {environmentLabel(latestRelease.environment)}</strong>
              <em>{latestRelease.imageRef}</em>
            </span>
          </div>
          <small>
            {latestRelease.target} · {latestRelease.namespace} · {releaseTrafficLabel(latestRelease)} · {latestRelease.deployedAt?.replace("T", " ").slice(0, 19) ?? "部署中"}
          </small>
          {latestRelease.rolloutSteps && <CanaryTrack release={latestRelease} />}
          <RegionTrafficMatrix release={latestRelease} />
          <ReleaseEventMiniTimeline events={releaseEventsByReleaseId[latestRelease.id] ?? []} />
          {latestRelease.endpoint && <code>{latestRelease.endpoint}</code>}
        </article>
      )}

      <div className="artifact-workspace-grid">
        <div className="artifact-main-column">
          <SectionTitle icon={<Boxes size={16} />} title="镜像制品" count={imageArtifacts.length} />
          <div className="artifact-card-grid">
            {imageArtifacts.length > 0 ? (
              imageArtifacts.map((artifact) => {
                const run = snapshot.runs.find((item) => item.id === artifact.runId);
                const release = snapshot.releases.find((item) => item.artifactId === artifact.id);
                const imageRef = artifactImageReference(artifact);
                const packageMode = run?.definitionSnapshot.buildConfig?.packageMode ?? "container_image";
                return (
                  <article key={artifact.id} className="artifact-management-card image">
                    <div className="artifact-card-head">
                      <PackageCheck size={18} />
                      <span>
                        <strong>{run?.pipelineName ?? artifact.name}</strong>
                        <em>{imageRef}</em>
                      </span>
                    </div>
                    <div className="artifact-card-meta">
                      <span className="artifact-mode-chip">{packageModeLabel(packageMode)}</span>
                      <span>{artifact.version}</span>
                      <span>{artifact.digest.slice(0, 24)}</span>
                      <span>{artifact.signed ? "signed" : "unsigned"}</span>
                    </div>
                    <div className="artifact-copy-row">
                      <button
                        className="artifact-copy-button primary"
                        onClick={() => void copy(`${artifact.id}:pull`, `docker pull ${imageRef}`, "docker pull 命令")}
                      >
                        {copiedKey === `${artifact.id}:pull` ? <Check size={15} /> : <Copy size={15} />}
                        {copiedKey === `${artifact.id}:pull` ? "已复制" : "复制 docker pull"}
                      </button>
                      <button
                        className="artifact-copy-button ghost"
                        onClick={() => void copy(`${artifact.id}:ref`, imageRef, "镜像引用")}
                      >
                        {copiedKey === `${artifact.id}:ref` ? <Check size={15} /> : <Copy size={15} />}
                        {copiedKey === `${artifact.id}:ref` ? "已复制引用" : "复制镜像引用"}
                      </button>
                    </div>
                    <div className="artifact-deploy-row">
                      {releaseTargets.map((environment) => {
                        const key = `${artifact.id}:${environment}`;
                        return (
                          <button
                            key={environment}
                            className={release?.environment === environment ? "deploy-target active" : "deploy-target"}
                            disabled={Boolean(deployingKey)}
                            onClick={() => void deploy(artifact.id, environment)}
                          >
                            <Rocket size={14} />
                            {deployingKey === key ? "上线中" : `上线 ${environmentLabel(environment)}`}
                          </button>
                        );
                      })}
                    </div>
                    <CanaryRegionConfigurator
                      regions={canaryRegionsFor(artifact.id)}
                      onChange={(regionId, patch) => updateCanaryRegion(artifact.id, regionId, patch)}
                    />
                    <BaselineVersionSelector
                      candidateArtifactId={artifact.id}
                      artifacts={imageArtifacts}
                      runs={snapshot.runs}
                      selectedBaselineId={baselineByArtifact[artifact.id] ?? ""}
                      onSelect={(baselineId) =>
                        setBaselineByArtifact((current) => ({ ...current, [artifact.id]: baselineId }))
                      }
                    />
                    <div className="artifact-deploy-row canary">
                      {releaseTargets.map((environment) => {
                        const key = `${artifact.id}:canary:${environment}`;
                        return (
                          <button
                            key={environment}
                            className="deploy-target canary"
                            disabled={Boolean(deployingKey)}
                            onClick={() => void canaryDeploy(artifact.id, environment)}
                          >
                            <TrendingUp size={14} />
                            {deployingKey === key ? "灰度中" : `${packageModeCanaryLabel(packageMode)} ${environmentLabel(environment)}`}
                          </button>
                        );
                      })}
                    </div>
                    {release && (
                      <div className="artifact-release-line">
                        <strong>{releaseStatusLabel(release.status)}</strong>
                        <span>{release.target} · {release.namespace} · {releaseTrafficLabel(release)}</span>
                        {release.endpoint && <em>{release.endpoint}</em>}
                        {release.rolloutSteps && (
                          <CanaryControlPanel
                            release={release}
                            busyKey={releaseActionKey}
                            onAction={(action) => void releaseAction(release.id, action)}
                          />
                        )}
                        <RegionTrafficMatrix release={release} />
                        <ReleaseEventMiniTimeline events={releaseEventsByReleaseId[release.id] ?? []} />
                      </div>
                    )}
                  </article>
                );
              })
            ) : (
              <div className="artifact-empty-state">
                <Terminal size={20} />
                <strong>还没有真实镜像制品</strong>
                <span>完成 build + docker push 后，这里会出现可上线的 OCI 镜像。</span>
              </div>
            )}
          </div>
          <SectionTitle icon={<PackageCheck size={16} />} title="构建包与发布包" count={supportArtifacts.length} />
          <div className="artifact-card-grid compact">
            {supportArtifacts.length > 0 ? (
              supportArtifacts.map((artifact) => {
                const run = snapshot.runs.find((item) => item.id === artifact.runId);
                const packageMode = run?.definitionSnapshot.buildConfig?.packageMode ?? "server_package";
                return (
                  <article key={artifact.id} className="artifact-management-card package">
                    <div className="artifact-card-head">
                      <PackageCheck size={18} />
                      <span>
                        <strong>{artifact.name}</strong>
                        <em>{packageModeLabel(packageMode)} · {artifact.version}</em>
                      </span>
                    </div>
                    <div className="artifact-card-meta">
                      <span>{artifact.type}</span>
                      <span>{artifact.digest.slice(0, 24)}</span>
                      <span>{artifact.signed ? "signed" : "unsigned"}</span>
                    </div>
                    <p className="artifact-mode-note">{packageModeExecutorHint(packageMode)}</p>
                    {(artifact.publicUrl || artifact.uri) && (
                      <div className="artifact-card-meta wide">
                        <span>{artifact.storageProvider ?? "package-store"}</span>
                        <span>{artifact.publicUrl || artifact.uri}</span>
                      </div>
                    )}
                    <div className="artifact-deploy-row">
                      {releaseTargets.map((environment) => {
                        const key = `${artifact.id}:${environment}`;
                        return (
                          <button
                            key={environment}
                            className="deploy-target"
                            disabled={Boolean(deployingKey)}
                            onClick={() => void deploy(artifact.id, environment)}
                          >
                            <Rocket size={14} />
                            {deployingKey === key ? "上线中" : `上线 ${environmentLabel(environment)}`}
                          </button>
                        );
                      })}
                    </div>
                    <CanaryRegionConfigurator
                      regions={canaryRegionsFor(artifact.id)}
                      onChange={(regionId, patch) => updateCanaryRegion(artifact.id, regionId, patch)}
                    />
                    <div className="artifact-deploy-row canary">
                      {releaseTargets.map((environment) => {
                        const key = `${artifact.id}:canary:${environment}`;
                        return (
                          <button
                            key={environment}
                            className="deploy-target canary"
                            disabled={Boolean(deployingKey)}
                            onClick={() => void canaryDeploy(artifact.id, environment)}
                          >
                            <TrendingUp size={14} />
                            {deployingKey === key ? "校验中" : `${packageModeCanaryLabel(packageMode)} ${environmentLabel(environment)}`}
                          </button>
                        );
                      })}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="artifact-empty-state compact">
                <PackageCheck size={18} />
                <strong>暂无构建包</strong>
                <span>配置静态站点包、服务运行包、YAML 或 Helm Chart 后会在这里统一管理。</span>
              </div>
            )}
          </div>
        </div>

        <aside className="artifact-side-column">
          <SectionTitle icon={<Rocket size={16} />} title="上线记录" count={snapshot.releases.length} />
          <div className="release-timeline">
            {snapshot.releases.length > 0 ? (
              snapshot.releases.map((release) => (
                <article
                  key={release.id}
                  className={`release-row ${release.status} ${selectedRelease?.id === release.id ? "selected" : ""}`}
                >
                  <strong>{release.applicationName}</strong>
                  <span>{environmentLabel(release.environment)} · {releaseStatusLabel(release.status)} · {releaseTrafficLabel(release)}</span>
                  <em>{release.imageRef}</em>
                  {release.rolloutSteps && <CanaryTrack release={release} />}
                  <RegionTrafficMatrix release={release} />
                  <ReleaseEventMiniTimeline events={releaseEventsByReleaseId[release.id] ?? []} />
                  {release.rolloutSteps && (
                    <CanaryControlPanel
                      release={release}
                      busyKey={releaseActionKey}
                      onAction={(action) => void releaseAction(release.id, action)}
                    />
                  )}
                  {release.endpoint && <code>{release.endpoint}</code>}
                  <div className="release-row-actions">
                    <button className="release-event-open" onClick={() => setSelectedReleaseId(release.id)} type="button">
                      查看事件与 payload
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="artifact-empty-state compact">
                <Rocket size={18} />
                <strong>暂无上线记录</strong>
                <span>选择一个镜像制品后即可触发上线。</span>
              </div>
            )}
          </div>

          <SectionTitle icon={<Activity size={16} />} title="发布事件" count={selectedReleaseEvents.length} />
          <ReleaseEventTimeline
            release={selectedRelease}
            events={selectedReleaseEvents}
            emptyText="当前发布还没有写入 release-events；触发上线、灰度推进或回滚后会从 Supabase 同步到这里。"
          />

          <SectionTitle icon={<Server size={16} />} title="环境状态" count={snapshot.environments.length} />
          <div className="environment-release-list">
            {snapshot.environments.map((environment) => (
              <article key={environment.id} className={`environment-release-row ${environment.status}`}>
                <strong>{environment.name}</strong>
                <span>{environment.cluster}</span>
                <em>{environment.currentImage ?? environment.currentVersion}</em>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span className="artifact-kpi">
      <strong>{value}</strong>
      <em>{label}</em>
    </span>
  );
}

function SectionTitle({ icon, title, count }: { icon: ReactNode; title: string; count: number }) {
  return (
    <div className="artifact-section-title">
      <span>
        {icon}
        {title}
      </span>
      <strong>{count}</strong>
    </div>
  );
}

function CanaryRegionConfigurator({
  regions,
  onChange,
}: {
  regions: CanaryTrafficRegion[];
  onChange: (regionId: string, patch: Partial<CanaryTrafficRegion>) => void;
}) {
  const enabledCount = regions.filter((region) => region.enabled && region.percent > 0).length;
  return (
    <div className="canary-region-config">
      <div className="canary-region-config-head">
        <span>
          <MapPin size={14} />
          区域灰度
        </span>
        <strong>{enabledCount} 个区域</strong>
      </div>
      <div className="canary-region-grid">
        {regions.map((region) => (
          <label key={region.id} className={region.enabled ? "canary-region-row enabled" : "canary-region-row"}>
            <input
              type="checkbox"
              checked={region.enabled}
              onChange={(event) => onChange(region.id, { enabled: event.target.checked })}
            />
            <span>
              <strong>{region.name}</strong>
              <em>{region.id}</em>
            </span>
            <input
              type="number"
              min={0}
              max={100}
              value={region.percent}
              disabled={!region.enabled}
              onChange={(event) => onChange(region.id, { percent: clampPercent(Number(event.target.value)) })}
            />
            <small>%</small>
          </label>
        ))}
      </div>
      <p>选中区域会按各自百分比先切入新版本；灰度通过后再推进到全量。</p>
    </div>
  );
}

function BaselineVersionSelector({
  candidateArtifactId,
  artifacts,
  runs,
  selectedBaselineId,
  onSelect,
}: {
  candidateArtifactId: string;
  artifacts: Artifact[];
  runs: PipelineRun[];
  selectedBaselineId: string;
  onSelect: (baselineId: string) => void;
}) {
  const options = artifacts.filter((item) => item.id !== candidateArtifactId);
  if (options.length === 0) return null;
  return (
    <div className="baseline-version-selector">
      <label>
        <span>基线版本</span>
        <select
          value={selectedBaselineId}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="">自动（最近稳定版本）</option>
          {options.map((item) => {
            const run = runs.find((r) => r.id === item.runId);
            const label = `${item.version} · ${item.digest.slice(0, 16)} · ${run?.refName ?? "unknown"}`;
            return (
              <option key={item.id} value={item.id}>
                {label}
              </option>
            );
          })}
        </select>
      </label>
    </div>
  );
}

function CanaryTrack({ release }: { release: ReleaseDeployment }) {
  const steps = release.rolloutSteps ?? [];
  if (steps.length === 0) return null;
  return (
    <div className="canary-track" aria-label="灰度批次">
      {steps.map((step) => (
        <span key={step.id} className={`canary-step ${step.status}`}>
          <i>{step.label ?? `${step.percent}%`}</i>
        </span>
      ))}
    </div>
  );
}

function RegionTrafficMatrix({ release }: { release: ReleaseDeployment }) {
  const activeStep = release.rolloutSteps?.find((step) => step.status === "active" || step.status === "paused");
  const regions = release.currentRegionTraffic ?? activeStep?.regions ?? release.rolloutPolicy?.regions;
  const activeRegions = regions?.filter((region) => region.enabled && region.percent >= 0) ?? [];
  if (activeRegions.length === 0) return null;
  return (
    <div className="region-traffic-matrix" aria-label="区域灰度流量">
      {activeRegions.map((region) => (
        <span key={region.id}>
          <strong>{region.name}</strong>
          <em>{region.percent}%</em>
        </span>
      ))}
    </div>
  );
}

function CanaryControlPanel({
  release,
  busyKey,
  onAction,
}: {
  release: ReleaseDeployment;
  busyKey: string;
  onAction: (action: "advance" | "pause" | "resume" | "promote" | "rollback") => void;
}) {
  const isCanaryRunning = release.status === "canarying";
  const isPaused = release.status === "paused";
  const canRollback = Boolean(release.rollbackImageRef) && release.status !== "rolled_back";
  if (!isCanaryRunning && !isPaused && !canRollback) return null;

  const button = (
    action: "advance" | "pause" | "resume" | "promote" | "rollback",
    label: string,
    icon: ReactNode,
    tone = "",
  ) => {
    const busy = busyKey === `${release.id}:${action}`;
    return (
      <button
        className={`canary-action ${tone}`.trim()}
        disabled={Boolean(busyKey)}
        onClick={() => onAction(action)}
      >
        {icon}
        {busy ? "执行中" : label}
      </button>
    );
  };

  return (
    <div className="canary-control-panel">
      <div>
        <Activity size={15} />
        <span>
          <strong>{releaseTrafficLabel(release)}</strong>
          <em>{canaryGateLabel(release)}</em>
        </span>
      </div>
      <div className="canary-action-row">
        {isCanaryRunning && button("advance", "推进", <TrendingUp size={14} />)}
        {isCanaryRunning && button("pause", "暂停", <Pause size={14} />)}
        {isPaused && button("resume", "继续", <Play size={14} />)}
        {(isCanaryRunning || isPaused) && button("promote", "全量", <Rocket size={14} />, "primary")}
        {canRollback && button("rollback", "回滚", <RotateCcw size={14} />, "danger")}
      </div>
    </div>
  );
}

function artifactImageReference(artifact: Artifact): string {
  if (artifact.name.includes("@sha256:")) return artifact.name;
  const lastPathSegment = artifact.name.slice(artifact.name.lastIndexOf("/") + 1);
  if (lastPathSegment.includes(":")) return artifact.name;
  return `${artifact.name}:${artifact.version}`;
}

function releaseTrafficLabel(release: ReleaseDeployment): string {
  const regionSuffix = release.currentRegionTraffic?.length
    ? ` · ${release.currentRegionTraffic.map((region) => `${region.name} ${region.percent}%`).join(" / ")}`
    : "";
  if (release.status === "success") return "100% 流量";
  if (release.status === "rolled_back") return "已回滚";
  if (release.packageMode === "static_site") return `${release.currentTrafficPercent ?? release.canaryPercent ?? 100}% 分组${regionSuffix}`;
  if (release.packageMode === "server_package") return `${release.currentTrafficPercent ?? release.canaryPercent ?? 100}% 实例${regionSuffix}`;
  if (release.packageMode === "kubernetes_manifest") return `${release.currentTrafficPercent ?? release.canaryPercent ?? 100}% 工作负载${regionSuffix}`;
  if (release.packageMode === "helm_chart") return `${release.currentTrafficPercent ?? release.canaryPercent ?? 100}% release${regionSuffix}`;
  return `${release.currentTrafficPercent ?? release.canaryPercent ?? 100}% 流量${regionSuffix}`;
}

function canaryGateLabel(release: ReleaseDeployment): string {
  const activeStep = release.rolloutSteps?.find((step) => step.status === "active" || step.status === "paused");
  const policy = release.rolloutPolicy;
  if (!activeStep || !policy) return "等待灰度状态";
  return `观测 ${policy.analysisWindowSeconds}s · 成功率 >= ${policy.minSuccessRate}% · 错误率 <= ${policy.maxErrorRate}%`;
}

function packageModeLabel(packageMode: PackageMode): string {
  const labels: Record<PackageMode, string> = {
    container_image: "容器镜像",
    static_site: "静态站点包",
    server_package: "服务运行包",
    kubernetes_manifest: "Kubernetes YAML",
    helm_chart: "Helm Chart",
  };
  return labels[packageMode];
}

function packageModeCanaryLabel(packageMode: PackageMode): string {
  const labels: Record<PackageMode, string> = {
    container_image: "流量灰度",
    static_site: "分组灰度",
    server_package: "实例灰度",
    kubernetes_manifest: "工作负载灰度",
    helm_chart: "Release 灰度",
  };
  return labels[packageMode];
}

function packageModeExecutorHint(packageMode: PackageMode): string {
  const hints: Record<PackageMode, string> = {
    container_image: "容器镜像已接入 local-docker，上线会真实 pull/run 镜像。",
    static_site: "已支持真实解包到 STATIC_SITE_DEPLOY_ROOT，并切换 current 发布目录。",
    server_package: "已支持真实解包到 SERVER_PACKAGE_DEPLOY_ROOT，可配置激活命令和健康检查。",
    kubernetes_manifest: "已支持 kubeconfig + kubectl apply，并对 Deployment 执行 rollout status。",
    helm_chart: "已支持 kubeconfig + helm upgrade --install，支持 chart、values 和 namespace。",
  };
  return hints[packageMode];
}

function environmentLabel(environment: EnvironmentType): string {
  const labels: Record<EnvironmentType, string> = {
    dev: "开发",
    test: "测试",
    staging: "预发",
    prod: "生产",
  };
  return labels[environment];
}

function releaseStatusLabel(status: PlatformSnapshot["releases"][number]["status"]): string {
  const labels: Record<PlatformSnapshot["releases"][number]["status"], string> = {
    deploying: "上线中",
    canarying: "灰度中",
    paused: "已暂停",
    success: "上线成功",
    failed: "上线失败",
    rolled_back: "已回滚",
  };
  return labels[status];
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
