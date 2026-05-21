"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, Play, X } from "lucide-react";
import {
  DEFAULT_PIPELINE_BUILD_CONFIG,
  ensureArtifactUploadStage,
  resolveImageArtifact,
  type EnvironmentType,
  type GitReferenceType,
  type PipelineDefinition,
  type PlatformSnapshot,
  type SourceRepository,
  resolvePackageBuildCommandMode,
  resolvePackageUploadCommandMode,
} from "@deploy-management/shared";
import { Field } from "../components/primitives";
import { environmentOptions } from "../data/templates";
import { fetchRepositoryRefs } from "../../lib/actions";
import type { RunConfig } from "./pipeline-config-editor";

const REMOTE_REF_TIMEOUT_MS = 8000;

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
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [remoteTags, setRemoteTags] = useState<string[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState("");
  const [repositoryAccessToken, setRepositoryAccessToken] = useState("");
  const remoteRequestId = useRef(0);
  const remoteAbortController = useRef<AbortController | null>(null);
  const repositoryProvider = providerFrom(pipeline.repository);
  const repositoryIdentity = repositoryIdentityFrom(
    pipeline.repository,
    config.repositoryId || pipeline.repositoryId || "draft-repository",
    repositoryProvider,
  );
  const selectedStaticRepository = snapshot.repositories.find((item) => item.id === config.repositoryId);
  const usesStaticRepository =
    Boolean(selectedStaticRepository) &&
    normalizeRepositoryUrl(pipeline.repository) === normalizeRepositoryUrl(selectedStaticRepository?.url ?? "");
  const draftRefName = config.refName || pipeline.defaultRef || pipeline.defaultBranch || "main";
  const draftRepository: SourceRepository = {
    id: repositoryIdentity.id,
    name: repositoryIdentity.name,
    provider: repositoryProvider,
    url: pipeline.repository,
    defaultBranch: config.refType === "branch" ? draftRefName : pipeline.defaultBranch || "main",
    branches: uniqueRefs([config.refType === "branch" ? draftRefName : undefined, pipeline.defaultBranch || "main"]),
    tags: uniqueRefs([config.refType === "tag" ? draftRefName : undefined]),
    recentCommits: [],
    owner: repositoryIdentity.owner || pipeline.owner || "未配置",
  };
  const hasRealRepositories = snapshot.repositories.length > 0;
  const repository = usesStaticRepository ? selectedStaticRepository ?? draftRepository : draftRepository;
  const sourcePolicy = pipeline.sourcePolicy ?? {
    allowedBranchPatterns: [repository.defaultBranch],
    allowedTagPatterns: ["v*"],
    allowRuntimeBranch: true,
    allowRuntimeTag: true,
    allowRuntimeCommit: true,
  };
  const remoteRefOptions = config.refType === "branch" ? remoteBranches : remoteTags;
  const staticRefOptions = config.refType === "branch" ? repository.branches : repository.tags;
  const refOptions = remoteRefOptions.length > 0 ? remoteRefOptions : staticRefOptions;
  const selectableRefOptions = refOptions.length > 0 ? refOptions : [draftRefName];
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
  const sourcePolicyAllowed = Boolean(repository.url.trim() && config.refName && runtimeSwitchAllowed && patternAllowed && commitAllowed);
  const buildConfig = pipeline.buildConfig ?? DEFAULT_PIPELINE_BUILD_CONFIG;
  const packageMode = buildConfig.packageMode ?? "container_image";
  const imageArtifact = packageMode === "container_image" ? resolveImageArtifact(pipeline) : undefined;
  const selectedStages = ensureArtifactUploadStage(config.stages.length > 0 ? config.stages : pipeline.stages, {
    packageMode,
    imageArtifact,
    packageUpload: pipeline.packageUpload,
  });
  const selectedStageKey = selectedStages.join("|");
  const realPreflightMessages = useMemo(() => {
    const stageSet = new Set(selectedStages);
    const requiresRealBuild = stageSet.has("build") || stageSet.has("upload");
    if (!requiresRealBuild) return [];

    const cluster = snapshot.tekton.cluster;
    const missing: string[] = [];
    if (cluster.executorMode !== "tekton" && cluster.executorMode !== "local-docker") {
      missing.push(`API 当前执行器是 ${cluster.executorMode}，真实打包/上传必须设置 EXECUTOR=tekton 或 EXECUTOR=local-docker`);
    }
    if (cluster.executorMode === "tekton" && cluster.simulatedFallbackEnabled) {
      missing.push("TEKTON_ALLOW_SIMULATED_FALLBACK 仍为 true，会把真实构建失败降级成模拟结果，请关闭");
    }
    if (!pipeline.repository.trim()) {
      missing.push("缺少仓库地址，无法从 Git 正式拉取代码");
    }
    if ((stageSet.has("build") || stageSet.has("upload")) && !stageSet.has("source") && !cluster.pipelineRefConfigured) {
      missing.push("inline Pipeline 的真实打包/上传必须包含 source 阶段，用于正式拉取代码");
    }
    const buildCommandMode = resolvePackageBuildCommandMode(buildConfig);
    if ((stageSet.has("build") || stageSet.has("upload")) && buildCommandMode === "custom" && !buildConfig.packageBuildCommand?.trim()) {
      missing.push("已选择手输打包命令，但命令内容为空，请在构建任务中填写完整命令或切回 package.json 脚本");
    }
    if ((stageSet.has("build") || stageSet.has("upload")) && buildCommandMode === "script" && !buildConfig.packageBuildScript.trim()) {
      missing.push("已选择 package.json 脚本打包，但脚本名为空，请在构建任务中填写脚本名或切换到手输命令");
    }
    if ((stageSet.has("build") || stageSet.has("upload")) && buildConfig.packageOutputPaths.length === 0) {
      missing.push("缺少打包产物目录，请配置 .next、dist、build 或 out 等真实输出目录");
    }
    if (!buildConfig.contextPath?.trim()) {
      missing.push("缺少构建上下文，请配置 buildConfig.contextPath");
    }
    if (
      cluster.executorMode === "tekton" &&
      (stageSet.has("build") || stageSet.has("upload")) &&
      !cluster.pipelineRefConfigured &&
      !cluster.sourcePvcConfigured
    ) {
      missing.push("缺少 TEKTON_SOURCE_PVC，inline Pipeline 需要 PVC 保存 checkout 源码、package 打包产物和 Docker build 上下文");
    }
    if (stageSet.has("upload")) {
      if (packageMode === "container_image") {
        if (!imageArtifact?.registryUrl.trim() || !imageArtifact.namespace.trim() || !imageArtifact.imageName.trim()) {
          missing.push("缺少完整镜像仓库配置，需要 registry、namespace/project 和 imageName");
        }
        if (!imageArtifact?.dockerfilePath.trim()) {
          missing.push("缺少 Dockerfile 路径，无法执行真实容器镜像构建");
        }
        if (!imageArtifact?.contextPath.trim()) {
          missing.push("缺少 Docker build 上下文路径");
        }
        if (
          cluster.executorMode === "tekton" &&
          imageArtifact?.privateRegistry &&
          !imageArtifact.dockerConfigSecret?.trim() &&
          !cluster.dockerSecretFallbackConfigured
        ) {
          missing.push("私有镜像仓库缺少 docker-registry Secret，请配置 imageArtifact.dockerConfigSecret 或 TEKTON_DOCKER_SECRET");
        }
        if (cluster.executorMode === "local-docker" && imageArtifact?.privateRegistry && !cluster.localRegistryPasswordConfigured) {
          missing.push("本机 Docker 推送私有镜像缺少 ACR_PASSWORD / ALIYUN_ACR_PASSWORD / REGISTRY_PASSWORD / DOCKER_PASSWORD");
        }
      } else {
        if (!pipeline.packageUpload?.endpoint.trim()) {
          missing.push("非镜像包上传缺少上传端点，请配置 packageUpload.endpoint");
        }
        if (!pipeline.packageUpload?.targetPathTemplate.trim()) {
          missing.push("非镜像包上传缺少目标路径模板，请配置 packageUpload.targetPathTemplate");
        }
        if (!pipeline.packageUpload?.serviceConnection.trim()) {
          missing.push("非镜像包上传缺少服务连接，请配置 packageUpload.serviceConnection");
        }
        if (pipeline.packageUpload && resolvePackageUploadCommandMode(pipeline.packageUpload) === "custom" && !pipeline.packageUpload.customUploadCommand?.trim()) {
          missing.push("已选择手输上传命令，但命令内容为空，请填写 packageUpload.customUploadCommand 或切回内置上传流程");
        }
      }
    }
    return missing;
  }, [
    imageArtifact?.contextPath,
    imageArtifact?.dockerConfigSecret,
    imageArtifact?.dockerfilePath,
    imageArtifact?.imageName,
    imageArtifact?.namespace,
    imageArtifact?.privateRegistry,
    imageArtifact?.registryUrl,
    packageMode,
    buildConfig.packageBuildCommandMode,
    buildConfig.packageBuildCommand,
    pipeline.packageUpload?.endpoint,
    pipeline.packageUpload?.serviceConnection,
    pipeline.packageUpload?.targetPathTemplate,
    pipeline.packageUpload?.customUploadCommandMode,
    pipeline.packageUpload?.customUploadCommand,
    buildConfig.contextPath,
    buildConfig.packageBuildScript,
    buildConfig.packageOutputPaths,
    pipeline.repository,
    selectedStageKey,
    snapshot.tekton.cluster.dockerSecretFallbackConfigured,
    snapshot.tekton.cluster.executorMode,
    snapshot.tekton.cluster.localRegistryPasswordConfigured,
    snapshot.tekton.cluster.pipelineRefConfigured,
    snapshot.tekton.cluster.simulatedFallbackEnabled,
    snapshot.tekton.cluster.sourcePvcConfigured,
    selectedStages,
  ]);
  const canRun = sourcePolicyAllowed && realPreflightMessages.length === 0;
  const readinessLabel = canRun
    ? "正式流程可运行"
    : sourcePolicyAllowed
      ? "正式流程缺少配置"
      : "Revision 被策略拦截";

  const sourceSummary = useMemo(
    () => [
      { label: "Repository", value: `${repository.provider}/${repository.name}` },
      { label: "Revision", value: `${config.refType}/${config.refName}` },
      { label: "Commit", value: config.commitSha ?? "触发时解析" },
      { label: "Environment", value: config.environment },
      { label: "Stages", value: selectedStages.join(" / ") },
    ],
    [repository.name, repository.provider, config.refType, config.refName, config.commitSha, config.environment, selectedStageKey],
  );

  const loadRemoteRefs = async (refType: GitReferenceType, applyDefault = false) => {
    if (!pipeline.repository.trim()) return;
    const requestId = remoteRequestId.current + 1;
    remoteRequestId.current = requestId;
    remoteAbortController.current?.abort();
    const abortController = new AbortController();
    remoteAbortController.current = abortController;
    const timeoutId = window.setTimeout(() => abortController.abort(), REMOTE_REF_TIMEOUT_MS);
    setRemoteLoading(true);
    setRemoteError("");
    try {
      const result = await fetchRepositoryRefs(
        {
          url: pipeline.repository,
          provider: repository.provider,
          accessToken: repositoryAccessToken.trim() || undefined,
          refType,
        },
        { signal: abortController.signal },
      );
      if (requestId !== remoteRequestId.current) return;
      if (refType === "branch") {
        setRemoteBranches(result.refs);
      } else {
        setRemoteTags(result.refs);
      }
      setConfig((current) => ({
        ...current,
        repositoryId: result.repositoryId,
        refType,
        refName:
          applyDefault && result.defaultRef
            ? result.defaultRef
            : result.refs.includes(current.refName)
              ? current.refName
              : result.defaultRef ?? current.refName,
        commitSha: undefined,
      }));
      if (result.warnings?.[0]) {
        setRemoteError(result.warnings[0]);
        onNotify(result.warnings[0]);
      } else {
        onNotify(`已拉取 ${result.refs.length} 个${refType === "branch" ? "分支" : "Tag"}`);
      }
    } catch (error) {
      if (requestId !== remoteRequestId.current) return;
      const message =
        isAbortError(error)
          ? `远程${refType === "branch" ? "分支" : "Tag"}列表拉取超时，已保留当前 ${draftRefName}，可以直接运行或填写令牌后刷新。`
          : error instanceof Error
            ? error.message
            : "远程仓库接口调用失败";
      setRemoteError(message);
      onNotify(message);
    } finally {
      window.clearTimeout(timeoutId);
      if (requestId === remoteRequestId.current) {
        setRemoteLoading(false);
        if (remoteAbortController.current === abortController) {
          remoteAbortController.current = null;
        }
      }
    }
  };

  useEffect(() => {
    remoteRequestId.current += 1;
    remoteAbortController.current?.abort();
    remoteAbortController.current = null;
    setConfig(initialConfig);
    setRemoteBranches([]);
    setRemoteTags([]);
    setRemoteError("");
    setRemoteLoading(false);
    setRepositoryAccessToken("");
  }, [initialConfig, pipeline.id]);

  useEffect(() => {
    return () => {
      remoteRequestId.current += 1;
      remoteAbortController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!pipeline.repository.trim()) return;
    void loadRemoteRefs(config.refType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline.id, config.refType]);

  const selectRepository = (repositoryId: string) => {
    if (repositoryId === "__remote__") {
      setConfig({
        ...config,
        repositoryId: repositoryIdentity.id,
        commitSha: undefined,
      });
      return;
    }
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
    const nextRemoteRefs = refType === "branch" ? remoteBranches : remoteTags;
    setConfig({
      ...config,
      refType,
      refName: nextRemoteRefs[0] ?? (refType === "branch" ? repository.defaultBranch : repository.tags[0] ?? repository.defaultBranch),
      commitSha: undefined,
    });
    if (pipeline.repository.trim()) {
      void loadRemoteRefs(refType, true);
    }
  };

  const submitRun = () => {
    if (!sourcePolicyAllowed) {
      onNotify("当前仓库 Revision 不符合流水线源策略");
      return;
    }
    if (realPreflightMessages.length > 0) {
      onNotify(realPreflightMessages[0]);
      return;
    }
    onRun({
      ...config,
      stages: selectedStages,
      repositoryAccessToken: repositoryAccessToken.trim() || undefined,
    });
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
              {readinessLabel}
            </div>
            {realPreflightMessages.length > 0 && (
              <div className="run-preflight-errors">
                <strong>正式环境前置检查</strong>
                {realPreflightMessages.map((message) => (
                  <span key={message}>{message}</span>
                ))}
              </div>
            )}
          </aside>

          <main className="run-launch-form">
            <Field label="代码仓库">
              {hasRealRepositories ? (
                <select
                  value={usesStaticRepository ? repository.id : "__remote__"}
                  onChange={(event) => selectRepository(event.target.value)}
                >
                  <option value="__remote__">自定义远程仓库</option>
                  {snapshot.repositories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.provider}/{item.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={config.repositoryId}
                  onChange={(event) => setConfig({ ...config, repositoryId: event.target.value })}
                />
              )}
            </Field>
            <Field label="运行类型">
              <select value={config.refType} onChange={(event) => selectRefType(event.target.value as GitReferenceType)}>
                <option value="branch">分支</option>
                <option value="tag" disabled={!pipeline.repository.trim() && repository.tags.length === 0 && remoteTags.length === 0}>
                  Tag
                </option>
              </select>
            </Field>
            <Field label={config.refType === "branch" ? "运行分支" : "运行 Tag"}>
              {usesStaticRepository || remoteRefOptions.length > 0 ? (
                <select
                  value={config.refName}
                  onChange={(event) => setConfig({ ...config, refName: event.target.value, commitSha: undefined })}
                >
                  {selectableRefOptions.map((ref) => (
                    <option key={ref} value={ref}>
                      {ref}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={config.refName}
                  onChange={(event) => setConfig({ ...config, refName: event.target.value, commitSha: undefined })}
                />
              )}
            </Field>
            <Field label="仓库访问令牌">
              <input
                type="password"
                value={repositoryAccessToken}
                placeholder="可选：未配置 GITCODE_TOKEN 时用于拉取分支 / Tag"
                onChange={(event) => setRepositoryAccessToken(event.target.value)}
              />
            </Field>
            <button
              type="button"
              className="cloud-secondary"
              disabled={remoteLoading || !pipeline.repository.trim()}
              onClick={() => void loadRemoteRefs(config.refType, true)}
            >
              {remoteLoading ? "拉取中..." : `刷新${config.refType === "branch" ? "分支" : "Tag"}列表`}
            </button>
            {remoteLoading && (
              <div className="source-policy-status pending">正在拉取远程引用；如果三方接口较慢，可先使用当前 Revision 运行。</div>
            )}
            {remoteError && <div className="source-policy-status blocked">{remoteError}</div>}
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
              <span>{selectedCommit ? `${selectedCommit.author} · ${selectedCommit.sha}` : repository.url || "请先配置仓库地址"}</span>
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function uniqueRefs(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function repositoryNameFrom(url: string, fallback: string): string {
  const normalizedFallback = fallback.trim() || "repository";
  if (!url.trim()) return normalizedFallback;
  const path = url.replace(/\.git$/i, "").split(/[/:]/).filter(Boolean);
  return path[path.length - 1] || normalizedFallback;
}

function providerFrom(url: string): SourceRepository["provider"] {
  const normalized = url.toLowerCase();
  if (normalized.includes("github.com")) return "github";
  if (normalized.includes("gitlab")) return "gitlab";
  if (normalized.includes("gitcode")) return "gitcode";
  if (normalized.includes("gitea")) return "gitea";
  return "codeup";
}

function repositoryIdentityFrom(
  url: string,
  fallback: string,
  provider: SourceRepository["provider"],
): { id: string; name: string; owner: string } {
  const normalizedFallback = fallback.trim() || "draft-repository";
  const segments = repositoryPathSegments(url);
  if (segments.length < 2) {
    return {
      id: normalizedFallback,
      name: repositoryNameFrom(url, normalizedFallback),
      owner: "未配置",
    };
  }
  const name = segments[segments.length - 1];
  const owner = segments.slice(0, -1).join("/");
  return {
    id: `${provider}:${[owner, name].join("/")}`,
    name,
    owner,
  };
}

function repositoryPathSegments(url: string): string[] {
  const trimmed = url.trim();
  if (!trimmed) return [];
  const sshMatch = trimmed.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/);
  const rawPath = sshMatch ? sshMatch[2] : pathFromHttpUrl(trimmed);
  let segments = rawPath
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments[0] === "api" && segments[2] === "repos") {
    segments = segments.slice(3);
  }

  const markerIndex = findRepositoryPathMarkerIndex(segments);
  if (markerIndex >= 0) {
    segments = segments.slice(0, markerIndex);
  }

  if (segments.length > 0) {
    segments[segments.length - 1] = decodeURIComponent(segments[segments.length - 1]).replace(/\.git$/i, "");
  }
  return segments;
}

function pathFromHttpUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function findRepositoryPathMarkerIndex(segments: string[]): number {
  const markers = new Set(["-", "tree", "blob", "branches", "tags", "commits", "releases"]);
  return segments.findIndex((segment, index) => index >= 2 && markers.has(segment));
}

function normalizeRepositoryUrl(url: string | undefined): string {
  return (url ?? "").trim().replace(/\.git$/i, "");
}
