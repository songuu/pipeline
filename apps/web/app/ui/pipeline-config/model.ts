import {
  DEFAULT_PIPELINE_BUILD_CONFIG,
  defaultImageArtifactConfig,
  type EnvironmentType,
  type GlobalParam,
  type ImageArtifactConfig,
  type LifecycleStageKey,
  type PackageMode,
  type PipelineBuildConfig,
  type PipelineDefinition,
  type PipelineSourcePolicy,
  type SourceRepository,
  type SourceRepositoryProvider,
  type TriggerRunRequest,
  type VariableInjectionTiming,
} from "@deploy-management/shared";

export type RunConfig = Required<
  Pick<TriggerRunRequest, "repositoryId" | "refType" | "refName" | "environment" | "canaryPercent">
> & {
  stages: LifecycleStageKey[];
  commitSha?: string;
  repositoryAccessToken?: string;
};
export type TaskPanelKind =
  | "source"
  | "quality"
  | "build"
  | "env"
  | "artifact"
  | "upload"
  | "deploy"
  | "canary"
  | "approval"
  | "promote";

export type TaskDefinition = {
  name: string;
  title: string;
  stage: LifecycleStageKey;
  kind: TaskPanelKind;
  taskRef: string;
  description: string;
  operations: string[];
  steps: string[];
  workspaces: string[];
  paramKeys: string[];
  retries: number;
  timeoutSeconds: number;
};

export const STAGE_LABELS: Record<LifecycleStageKey, string> = {
  source: "流水线源",
  test: "测试",
  build: "构建",
  env: "变量",
  package: "制品",
  upload: "上传",
  deploy: "部署",
  canary: "灰度",
  approval: "审批",
  promote: "全量",
};

export const VARIABLE_TIMING_LABELS: Record<VariableInjectionTiming, string> = {
  build: "构建时注入",
  runtime: "运行时注入",
  deploy: "部署时注入",
};

export const VARIABLE_TIMING_OPTIONS: Array<{ key: VariableInjectionTiming; label: string }> = [
  { key: "build", label: "构建时" },
  { key: "runtime", label: "运行时" },
  { key: "deploy", label: "部署时" },
];

export const TASK_DEFINITIONS: TaskDefinition[] = [
  {
    name: "拉取代码",
    title: "代码源解析",
    stage: "source",
    kind: "source",
    taskRef: "git-source-task",
    description: "解析分支、Tag 或固定 Commit，克隆代码并生成 source snapshot。",
    operations: ["校验触发来源与签名", "匹配分支和 Tag 白名单", "clone/checkout 到 source-ws"],
    steps: ["resolve-revision", "clone", "checkout"],
    workspaces: ["source-ws"],
    paramKeys: ["git-url", "revision", "ref-type", "branch-allowlist", "tag-allowlist"],
    retries: 0,
    timeoutSeconds: 300,
  },
  {
    name: "JavaScript 代码扫描",
    title: "代码扫描",
    stage: "test",
    kind: "quality",
    taskRef: "javascript-sast-task",
    description: "执行 lint、SAST 和依赖风险扫描，失败后阻断构建。",
    operations: ["恢复依赖缓存", "执行 ESLint/SAST", "写入质量门禁报告"],
    steps: ["restore-cache", "lint", "sast"],
    workspaces: ["source-ws", "cache-ws"],
    paramKeys: ["NODE_ENV", "runtime.RELEASE_NOTE"],
    retries: 0,
    timeoutSeconds: 900,
  },
  {
    name: "Node.js 单元测试",
    title: "单元测试",
    stage: "test",
    kind: "quality",
    taskRef: "node-test-task",
    description: "安装依赖并执行单元测试，输出 JUnit 和覆盖率结果。",
    operations: ["安装依赖", "执行测试", "归档 JUnit/coverage"],
    steps: ["install", "unit-test", "coverage"],
    workspaces: ["source-ws", "cache-ws"],
    paramKeys: ["NODE_ENV"],
    retries: 0,
    timeoutSeconds: 900,
  },
  {
    name: "Node.js 构建",
    title: "打包构建",
    stage: "build",
    kind: "build",
    taskRef: "node-build-task",
    description: "在隔离构建容器中完成应用打包，构建时变量会在这里生效。",
    operations: ["恢复构建缓存", "读取 package.json scripts", "执行配置的打包脚本", "归档真实产物目录"],
    steps: ["install", "package-script", "archive"],
    workspaces: ["source-ws", "cache-ws"],
    paramKeys: ["NODE_ENV", "PACKAGE_BUILD_SCRIPT", "PACKAGE_OUTPUT_PATHS", "IMAGE_TAG"],
    retries: 0,
    timeoutSeconds: 1_200,
  },
  {
    name: "镜像构建并推送",
    title: "镜像构建并推送",
    stage: "upload",
    kind: "upload",
    taskRef: "image-build-push-task",
    description: "使用 Docker CLI 构建 OCI 镜像，读取 docker-registry Secret，推送并记录 digest。",
    operations: ["docker build", "docker push", "写入 registry digest"],
    steps: ["docker-build", "docker-push", "write-digest"],
    workspaces: ["source-ws", "docker-config"],
    paramKeys: ["IMAGE_TAG", "IMAGE_REF", "DOCKERFILE_PATH", "BUILD_CONTEXT", "REGISTRY_DOCKER_SECRET"],
    retries: 1,
    timeoutSeconds: 600,
  },
  {
    name: "注入环境变量",
    title: "变量注入计划",
    stage: "env",
    kind: "env",
    taskRef: "env-injection-task",
    description: "把流水线变量按构建时、运行时、部署时拆分，避免把运行密钥打进镜像。",
    operations: ["合并流水线变量和运行变量", "按注入时机拆分", "生成 Task env 与 manifest patch"],
    steps: ["merge-vars", "classify-timing", "write-env-plan"],
    workspaces: ["source-ws"],
    paramKeys: ["target-env", "NODE_ENV", "DEPLOY_NAMESPACE", "runtime.RELEASE_NOTE"],
    retries: 0,
    timeoutSeconds: 180,
  },
  {
    name: "生成 SBOM 与证明",
    title: "SBOM 与证明",
    stage: "package",
    kind: "artifact",
    taskRef: "supply-chain-package-task",
    description: "生成 SBOM、测试报告和 provenance 原始材料，交给 Tekton Chains 签名。",
    operations: ["生成 SBOM", "收集构建材料", "输出 provenance metadata"],
    steps: ["sbom", "materials", "provenance"],
    workspaces: ["source-ws"],
    paramKeys: ["IMAGE_TAG", "NODE_ENV"],
    retries: 0,
    timeoutSeconds: 300,
  },
  {
    name: "Kubernetes 发布",
    title: "Kubernetes 发布",
    stage: "deploy",
    kind: "deploy",
    taskRef: "kubernetes-deploy-task",
    description: "渲染 Helm/Kustomize manifest，并把运行时变量注入到 Deployment。",
    operations: ["渲染 manifest", "注入运行时 env/secret", "kubectl apply"],
    steps: ["render-manifest", "inject-runtime-env", "kubectl-apply"],
    workspaces: ["source-ws", "kubeconfig"],
    paramKeys: ["target-env", "canary-percent", "DEPLOY_NAMESPACE", "runtime.RELEASE_NOTE"],
    retries: 1,
    timeoutSeconds: 900,
  },
  {
    name: "灰度观测",
    title: "灰度观测",
    stage: "canary",
    kind: "canary",
    taskRef: "canary-observe-task",
    description: "按灰度比例切流并持续观察错误率、P95 延迟和探活结果。",
    operations: ["切换灰度流量", "观察 SLO", "决定继续或阻断"],
    steps: ["route-traffic", "observe-slo", "write-verdict"],
    workspaces: ["kubeconfig"],
    paramKeys: ["target-env", "canary-percent", "DEPLOY_NAMESPACE"],
    retries: 0,
    timeoutSeconds: 1_800,
  },
  {
    name: "人工审批门禁",
    title: "人工审批",
    stage: "approval",
    kind: "approval",
    taskRef: "approval-gate-task",
    description: "生产发布在灰度通过后进入人工审批和变更窗口门禁。",
    operations: ["冻结当前 release", "等待审批人确认", "写入审计记录"],
    steps: ["create-approval", "wait-approval", "audit"],
    workspaces: [],
    paramKeys: ["target-env", "runtime.RELEASE_NOTE"],
    retries: 0,
    timeoutSeconds: 86_400,
  },
  {
    name: "全量发布",
    title: "全量发布",
    stage: "promote",
    kind: "promote",
    taskRef: "promote-stable-task",
    description: "审批通过后扩大流量到 100%，记录发布历史和最终制品版本。",
    operations: ["扩大全量流量", "确认稳定版本", "写入部署历史"],
    steps: ["promote-stable", "verify", "record-release"],
    workspaces: ["kubeconfig"],
    paramKeys: ["target-env", "DEPLOY_NAMESPACE", "runtime.RELEASE_NOTE"],
    retries: 1,
    timeoutSeconds: 900,
  },
];

export function buildSourcePolicy(
  branchPatterns: string,
  tagPatterns: string,
  allowRuntimeBranch: boolean,
  allowRuntimeTag: boolean,
  allowRuntimeCommit: boolean,
  defaultBranch: string,
): PipelineSourcePolicy {
  const branches = normalizePatternText(branchPatterns);
  return {
    allowedBranchPatterns: branches.length > 0 ? branches : [defaultBranch],
    allowedTagPatterns: normalizePatternText(tagPatterns),
    allowRuntimeBranch,
    allowRuntimeTag,
    allowRuntimeCommit,
  };
}

export function normalizePatternText(value: string): string[] {
  return Array.from(new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)));
}

export function defaultTagPatterns(tags: string[], repositoryName: string): string[] {
  const prefixes = tags
    .map((tag) => tag.match(/^[a-zA-Z-]+/)?.[0])
    .filter((prefix): prefix is string => Boolean(prefix))
    .map((prefix) => `${prefix}*`);
  return Array.from(new Set([...prefixes, "v*", `${repositoryName}-*`, "release-*"]));
}

export function uniqueRefs(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

export function repositoryNameFrom(url: string, fallback: string): string {
  const normalizedFallback = fallback.trim() || "repository";
  if (!url.trim()) return normalizedFallback;
  const path = url.replace(/\.git$/i, "").split(/[/:]/).filter(Boolean);
  return path[path.length - 1] || normalizedFallback;
}

export function providerFrom(url: string): SourceRepository["provider"] {
  const normalized = url.toLowerCase();
  if (normalized.includes("github.com")) return "github";
  if (normalized.includes("gitlab")) return "gitlab";
  if (normalized.includes("gitcode")) return "gitcode";
  if (normalized.includes("gitea")) return "gitea";
  return "codeup";
}

export function repositoryIdentityFrom(
  url: string,
  fallback: string,
  provider: SourceRepositoryProvider,
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

export function repositoryPathSegments(url: string): string[] {
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

export function pathFromHttpUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function findRepositoryPathMarkerIndex(segments: string[]): number {
  const markers = new Set(["-", "tree", "blob", "branches", "tags", "commits", "releases"]);
  return segments.findIndex((segment, index) => index >= 2 && markers.has(segment));
}

export function normalizeRepositoryUrl(url: string | undefined): string {
  return (url ?? "").trim().replace(/\.git$/i, "");
}

export function normalizeRegistryHost(value: string): string {
  return value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
}

export function normalizePipelineVariables(
  variables: GlobalParam[] | undefined,
  environment: EnvironmentType,
  applicationId: string,
): GlobalParam[] {
  const source =
    variables && variables.length > 0
      ? variables
      : [
          {
            key: "NODE_ENV",
            value: environment === "prod" ? "production" : environment,
            description: "构建时环境标识",
          },
          { key: "IMAGE_TAG", value: "${run.id}-${commit.short}", description: "构建产物版本" },
          { key: "DEPLOY_NAMESPACE", value: `${applicationId}-${environment}`, description: "部署命名空间" },
        ];
  return source.map((variable) => normalizeVariable(variable, environment));
}

export function imageArtifactFromPipeline(pipeline: PipelineDefinition): ImageArtifactConfig {
  return pipeline.imageArtifact ?? defaultImageArtifactConfig(pipeline);
}

export function buildConfigFromPipeline(pipeline: PipelineDefinition): PipelineBuildConfig {
  return {
    ...DEFAULT_PIPELINE_BUILD_CONFIG,
    ...pipeline.buildConfig,
    packageMode: pipeline.buildConfig?.packageMode ?? DEFAULT_PIPELINE_BUILD_CONFIG.packageMode,
    runtime: pipeline.buildConfig?.runtime ?? DEFAULT_PIPELINE_BUILD_CONFIG.runtime,
  };
}

export function normalizeOutputPathText(value: string): string[] {
  const normalized = parseOutputPathText(value);
  return normalized.length > 0 ? normalized : DEFAULT_PIPELINE_BUILD_CONFIG.packageOutputPaths;
}

export function packageModeLabel(packageMode: PackageMode): string {
  const labels: Record<PackageMode, string> = {
    container_image: "容器镜像",
    static_site: "静态站点包",
    server_package: "服务运行包",
    kubernetes_manifest: "Kubernetes YAML",
    helm_chart: "Helm Chart",
  };
  return labels[packageMode];
}

export function packageModeHelp(packageMode: PackageMode): string {
  const helps: Record<PackageMode, string> = {
    container_image: "生成 OCI 镜像并推送到 ACR/Harbor 等镜像仓库，灰度按流量百分比分批。",
    static_site: "生成 out/dist 等静态目录，灰度需要 OSS/CDN 分组、缓存 TTL 和回滚路径。",
    server_package: "生成 tar/zip 运行包，灰度按主机实例批次和健康检查推进。",
    kubernetes_manifest: "生成 Kubernetes YAML，灰度按 Deployment/Ingress/ServiceMesh 控制器推进。",
    helm_chart: "生成 Helm Chart，灰度按 release、values 和目标 namespace 推进。",
  };
  return helps[packageMode];
}

export function parseOutputPathText(value: string): string[] {
  return Array.from(new Set(value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)));
}

export function upsertImageTagVariable(variables: GlobalParam[], tagTemplate: string): GlobalParam[] {
  const normalizedTag = tagTemplate || "${run.id}-${commit.short}";
  const index = variables.findIndex((item) => item.key === "IMAGE_TAG");
  const variable: GlobalParam = {
    key: "IMAGE_TAG",
    value: normalizedTag,
    description: "构建产物版本",
    injectionTiming: "build",
    targetStages: ["build", "upload", "deploy"],
  };
  if (index < 0) return [...variables, variable];
  return variables.map((item, itemIndex) =>
    itemIndex === index
      ? {
          ...item,
          value: normalizedTag,
          injectionTiming: item.injectionTiming ?? "build",
          targetStages: item.targetStages?.length ? item.targetStages : ["build", "upload", "deploy"],
        }
      : item,
  );
}

export function normalizeVariable(
  variable: GlobalParam,
  environment: EnvironmentType,
  forceRecommended = false,
): GlobalParam {
  const injectionTiming =
    forceRecommended || !variable.injectionTiming
      ? defaultInjectionTimingForKey(variable.key)
      : variable.injectionTiming;
  return {
    ...variable,
    value: variable.key === "NODE_ENV" && !variable.value ? environment : variable.value,
    injectionTiming,
    targetStages:
      forceRecommended || !variable.targetStages || variable.targetStages.length === 0
        ? defaultTargetStagesForVariable(variable.key, injectionTiming)
        : variable.targetStages,
  };
}

export function defaultInjectionTimingForKey(key: string): VariableInjectionTiming {
  if (key === "NODE_ENV" || key === "IMAGE_TAG" || isPublicSupabaseBuildKey(key)) return "build";
  if (key === "DEPLOY_NAMESPACE" || isPrivateSupabaseRuntimeKey(key)) return "deploy";
  return "runtime";
}

export function defaultTargetStagesForVariable(
  key: string,
  injectionTiming: VariableInjectionTiming,
): LifecycleStageKey[] {
  if (key === "NODE_ENV") return ["test", "build", "package"];
  if (key === "IMAGE_TAG") return ["build", "upload", "deploy"];
  if (isPublicSupabaseBuildKey(key)) return ["test", "build", "package"];
  if (isPrivateSupabaseRuntimeKey(key)) return ["deploy", "canary", "promote"];
  if (key === "DEPLOY_NAMESPACE") return ["deploy", "canary", "promote"];
  if (injectionTiming === "build") return ["test", "build", "package"];
  if (injectionTiming === "deploy") return ["deploy", "canary", "promote"];
  return ["deploy", "canary", "approval", "promote"];
}

export function isPublicSupabaseBuildKey(key: string): boolean {
  return [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ].includes(key);
}

export function isPrivateSupabaseRuntimeKey(key: string): boolean {
  return ["SUPABASE_DB_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"].includes(key);
}

export function variablesForStage(variables: GlobalParam[], stage: LifecycleStageKey): GlobalParam[] {
  return variables
    .map((variable) => normalizeVariable(variable, "dev"))
    .filter((variable) => variable.targetStages?.includes(stage));
}

export function splitVariablesByTiming(variables: GlobalParam[]): Record<VariableInjectionTiming, GlobalParam[]> {
  return variables.reduce<Record<VariableInjectionTiming, GlobalParam[]>>(
    (groups, variable) => {
      const timing = variable.injectionTiming ?? defaultInjectionTimingForKey(variable.key);
      groups[timing].push(variable);
      return groups;
    },
    { build: [], runtime: [], deploy: [] },
  );
}

