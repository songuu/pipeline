"use client";

import { useEffect, useMemo, useState } from "react";
import { GitBranch, Play, X } from "lucide-react";
import {
  type EnvironmentType,
  type GitReferenceType,
  type PipelineDefinition,
  type PlatformSnapshot,
} from "@deploy-management/shared";
import { Field } from "../components/primitives";
import { environmentOptions } from "../data/templates";
import type { RunConfig } from "./pipeline-config-editor";

interface RunLaunchDialogProps {
  snapshot: PlatformSnapshot;
  pipeline: PipelineDefinition;
  initialConfig: RunConfig;
  onClose: () => void;
  onRun: (config: RunConfig) => void;
  onNotify: (message: string) => void;
}

export function RunLaunchDialog({
  snapshot,
  pipeline,
  initialConfig,
  onClose,
  onRun,
  onNotify,
}: RunLaunchDialogProps) {
  const [config, setConfig] = useState<RunConfig>(initialConfig);
  const repository = snapshot.repositories.find((item) => item.id === config.repositoryId) ?? snapshot.repositories[0];
  const sourcePolicy = pipeline.sourcePolicy ?? {
    allowedBranchPatterns: [repository.defaultBranch],
    allowedTagPatterns: ["v*"],
    allowRuntimeBranch: true,
    allowRuntimeTag: true,
    allowRuntimeCommit: true,
  };
  const refOptions = config.refType === "branch" ? repository.branches : repository.tags;
  const recentCommits = repository.recentCommits ?? [];
  const selectedCommit = recentCommits.find((commit) => commit.sha === config.commitSha);
  const isDefaultRef = config.refType === pipeline.defaultRefType && config.refName === pipeline.defaultRef;
  const runtimeSwitchAllowed =
    isDefaultRef ||
    (config.refType === "branch" ? sourcePolicy.allowRuntimeBranch : sourcePolicy.allowRuntimeTag);
  const patternAllowed =
    config.refType === "branch"
      ? matchesAnyPattern(config.refName, sourcePolicy.allowedBranchPatterns)
      : matchesAnyPattern(config.refName, sourcePolicy.allowedTagPatterns);
  const commitAllowed = !config.commitSha || sourcePolicy.allowRuntimeCommit;
  const canRun = Boolean(repository && config.refName && runtimeSwitchAllowed && patternAllowed && commitAllowed);

  const sourceSummary = useMemo(
    () => [
      { label: "Repository", value: `${repository.provider}/${repository.name}` },
      { label: "Revision", value: `${config.refType}/${config.refName}` },
      { label: "Commit", value: config.commitSha ?? "触发时解析" },
      { label: "Environment", value: config.environment },
    ],
    [repository.name, repository.provider, config.refType, config.refName, config.commitSha, config.environment],
  );

  useEffect(() => {
    setConfig(initialConfig);
  }, [initialConfig, pipeline.id]);

  const selectRepository = (repositoryId: string) => {
    const nextRepository = snapshot.repositories.find((item) => item.id === repositoryId) ?? repository;
    setConfig({
      ...config,
      repositoryId: nextRepository.id,
      refType: "branch",
      refName: nextRepository.defaultBranch,
      commitSha: undefined,
    });
  };

  const selectRefType = (refType: GitReferenceType) => {
    setConfig({
      ...config,
      refType,
      refName: refType === "branch" ? repository.defaultBranch : repository.tags[0] ?? repository.defaultBranch,
      commitSha: undefined,
    });
  };

  const submitRun = () => {
    if (!canRun) {
      onNotify("当前仓库 Revision 不符合流水线源策略");
      return;
    }
    onRun(config);
  };

  return (
    <div className="modal-backdrop">
      <section className="run-launch-modal" role="dialog" aria-modal="true" aria-label="运行流水线">
        <header className="run-launch-head">
          <div>
            <span>Run Pipeline</span>
            <h2>{pipeline.name}</h2>
          </div>
          <button className="plain-icon" onClick={onClose} aria-label="关闭运行配置">
            <X size={20} />
          </button>
        </header>

        <div className="run-launch-body">
          <aside className="run-launch-summary">
            {sourceSummary.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
            <div className={canRun ? "source-policy-status ok" : "source-policy-status blocked"}>
              {canRun ? "策略允许运行" : "Revision 被策略拦截"}
            </div>
          </aside>

          <main className="run-launch-form">
            <Field label="代码仓库">
              <select value={repository.id} onChange={(event) => selectRepository(event.target.value)}>
                {snapshot.repositories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.provider}/{item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="运行类型">
              <select value={config.refType} onChange={(event) => selectRefType(event.target.value as GitReferenceType)}>
                <option value="branch">分支</option>
                <option value="tag" disabled={repository.tags.length === 0}>
                  Tag
                </option>
              </select>
            </Field>
            <Field label={config.refType === "branch" ? "运行分支" : "运行 Tag"}>
              <select
                value={config.refName}
                onChange={(event) => setConfig({ ...config, refName: event.target.value, commitSha: undefined })}
              >
                {refOptions.map((ref) => (
                  <option key={ref} value={ref}>
                    {ref}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="固定 Commit（可选）">
              <select
                value={config.commitSha ?? ""}
                disabled={!sourcePolicy.allowRuntimeCommit}
                onChange={(event) => setConfig({ ...config, commitSha: event.target.value || undefined })}
              >
                <option value="">使用 {config.refName} 最新提交</option>
                {recentCommits.map((commit) => (
                  <option key={commit.sha} value={commit.sha}>
                    {commit.sha.slice(0, 12)} · {commit.message}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="目标环境">
              <select
                value={config.environment}
                onChange={(event) => setConfig({ ...config, environment: event.target.value as EnvironmentType })}
              >
                {environmentOptions.map((environment) => (
                  <option key={environment} value={environment}>
                    {environment}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="灰度比例">
              <input
                type="number"
                min={0}
                max={100}
                value={config.canaryPercent}
                onChange={(event) => setConfig({ ...config, canaryPercent: Number(event.target.value) })}
              />
            </Field>
            <div className="run-launch-commit">
              <GitBranch size={16} />
              <strong>{selectedCommit?.message ?? "运行时解析当前 Revision"}</strong>
              <span>{selectedCommit ? `${selectedCommit.author} · ${selectedCommit.sha}` : repository.url}</span>
            </div>
          </main>
        </div>

        <footer className="run-launch-footer">
          <button className="cloud-secondary" onClick={onClose}>
            取消
          </button>
          <button className="yunxiao-primary" disabled={!canRun} onClick={submitRun}>
            <Play size={15} />
            运行
          </button>
        </footer>
      </section>
    </div>
  );
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
