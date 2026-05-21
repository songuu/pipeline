import {
  DEFAULT_PIPELINE_BUILD_CONFIG,
  DEFAULT_PACKAGE_UPLOAD_CONFIG,
  defaultImageArtifactConfig,
  type EnvironmentType,
  type GlobalParam,
  type ImageArtifactConfig,
  type LifecycleStageKey,
  type PackageMode,
  type PackageUploadConfig,
  type PipelineBuildConfig,
  type PipelineDefinition,
  type PipelineSourcePolicy,
  type SourceRepository,
  type SourceRepositoryProvider,
  type TriggerRunRequest,
  type VariableInjectionTiming,
  resolvePackageBuildCommandMode,
  resolvePackageUploadCommandMode,
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

type TaskDefinitionOverride = Partial<Omit<TaskDefinition, "stage" | "kind">>;

const PACKAGE_MODE_STAGE_LABELS: Record<PackageMode, Partial<Record<LifecycleStageKey, string>>> = {
  container_image: {
    package: "镜像证明",
    upload: "镜像仓库",
    deploy: "镜像部署",
    canary: "流量灰度",
    promote: "镜像全量",
  },
  static_site: {
    build: "站点构建",
    package: "静态归档",
    upload: "OSS/CDN",
    deploy: "站点入口",
    canary: "CDN 灰度",
    promote: "CDN 全量",
  },
  server_package: {
    build: "服务构建",
    package: "运行包",
    upload: "包仓库",
    deploy: "主机部署",
    canary: "实例灰度",
    promote: "主机全量",
  },
  kubernetes_manifest: {
    build: "Manifest",
    package: "YAML 归档",
    upload: "配置归档",
    deploy: "kubectl",
    canary: "工作负载",
    promote: "配置全量",
  },
  helm_chart: {
    build: "Chart 构建",
    package: "Chart 打包",
    upload: "Chart 仓库",
    deploy: "Helm 升级",
    canary: "Helm 灰度",
    promote: "Helm 全量",
  },
};

const PACKAGE_MODE_TASK_OVERRIDES: Record<PackageMode, Partial<Record<LifecycleStageKey, TaskDefinitionOverride>>> = {
  container_image: {
    package: {
      name: "镜像 SBOM 与证明",
      title: "镜像供应链证明",
      taskRef: "image-provenance-task",
      description: "为 OCI 镜像生成 SBOM、材料清单和 provenance，供镜像部署链路验签。",
      operations: ["生成镜像 SBOM", "收集 Dockerfile 与镜像层材料", "写入 image provenance"],
      steps: ["image-sbom", "image-materials", "image-provenance"],
      paramKeys: ["IMAGE_REF", "IMAGE_TAG", "DOCKERFILE_PATH", "BUILD_CONTEXT"],
    },
    deploy: {
      name: "Kubernetes 镜像部署",
      title: "Kubernetes 镜像发布",
      taskRef: "kubernetes-image-deploy-task",
      description: "把新镜像写入 Deployment/ServiceMesh 配置，等待 Kubernetes rollout 就绪。",
      operations: ["渲染 Deployment patch", "注入运行时 env/secret", "kubectl set image 并等待 rollout"],
      steps: ["render-image-patch", "inject-runtime-env", "kubectl-rollout"],
      workspaces: ["source-ws", "kubeconfig"],
      paramKeys: ["IMAGE_REF", "target-env", "canary-percent", "DEPLOY_NAMESPACE", "runtime.RELEASE_NOTE"],
    },
    canary: {
      name: "流量灰度观测",
      title: "服务流量灰度",
      taskRef: "traffic-canary-observe-task",
      description: "通过 Ingress、ServiceMesh 或 Rollouts 控制器切换镜像版本流量并观察 SLO。",
      operations: ["切换服务流量", "观察错误率/P95", "写入灰度 verdict"],
      steps: ["route-traffic", "observe-slo", "write-verdict"],
      workspaces: ["kubeconfig"],
      paramKeys: ["IMAGE_REF", "target-env", "canary-percent", "DEPLOY_NAMESPACE"],
    },
    promote: {
      name: "镜像全量发布",
      title: "镜像稳定版本确认",
      taskRef: "image-promote-stable-task",
      description: "把镜像版本扩大到 100% 流量，记录 Kubernetes 发布历史和镜像 digest。",
      operations: ["扩大全量流量", "确认镜像 digest", "写入部署历史"],
      steps: ["promote-image", "verify-rollout", "record-release"],
      workspaces: ["kubeconfig"],
      paramKeys: ["IMAGE_REF", "target-env", "DEPLOY_NAMESPACE", "runtime.RELEASE_NOTE"],
    },
  },
  static_site: {
    build: {
      name: "静态站点构建",
      title: "静态资源构建",
      taskRef: "static-site-build-task",
      description: "执行前端构建脚本，产出 dist/build/out 等可直接托管的静态目录。",
      operations: ["恢复前端依赖缓存", "执行站点构建脚本", "校验静态资源入口"],
      steps: ["install", "site-build-script", "verify-static-entry"],
      paramKeys: ["NODE_ENV", "PACKAGE_BUILD_SCRIPT", "PACKAGE_OUTPUT_PATHS", "PACKAGE_UPLOAD_PUBLIC_BASE_URL"],
    },
    package: {
      name: "静态站点包归档",
      title: "静态包版本化",
      taskRef: "static-site-package-task",
      description: "把静态目录打成不可变版本包，并生成可回滚的 index / asset manifest。",
      operations: ["归档静态目录", "生成 asset manifest", "写入 package digest"],
      steps: ["archive-static", "asset-manifest", "write-digest"],
      workspaces: ["source-ws"],
      paramKeys: ["PACKAGE_OUTPUT_PATHS", "PACKAGE_UPLOAD_TARGET_PATH", "PACKAGE_UPLOAD_PUBLIC_BASE_URL"],
    },
    upload: {
      name: "OSS/CDN 静态包上传",
      title: "静态包上传",
      taskRef: "static-site-upload-task",
      description: "把站点包上传到 OSS、静态服务器或本地发布目录，输出 public URL。",
      operations: ["上传静态包", "写入 public URL", "预热或刷新 CDN 资源"],
      steps: ["upload-static-package", "write-public-url", "refresh-cdn"],
      workspaces: ["source-ws"],
      paramKeys: [
        "PACKAGE_UPLOAD_PROVIDER",
        "PACKAGE_UPLOAD_ENDPOINT",
        "PACKAGE_UPLOAD_TARGET_PATH",
        "PACKAGE_UPLOAD_PUBLIC_BASE_URL",
        "PACKAGE_UPLOAD_SERVICE_CONNECTION",
      ],
    },
    deploy: {
      name: "静态站点版本切换",
      title: "静态入口发布",
      taskRef: "static-site-release-task",
      description: "把站点入口切到本次 release 目录，保留旧版本用于秒级回滚。",
      operations: ["生成 release 目录", "切换 current 入口", "记录 CDN 回滚点"],
      steps: ["prepare-release-dir", "switch-current", "record-cdn-rollback"],
      workspaces: ["source-ws"],
      paramKeys: ["PACKAGE_UPLOAD_PUBLIC_BASE_URL", "PACKAGE_UPLOAD_TARGET_PATH", "target-env", "runtime.RELEASE_NOTE"],
    },
    canary: {
      name: "CDN 分组灰度",
      title: "静态站点灰度",
      taskRef: "cdn-cohort-canary-task",
      description: "按用户分组、路径或边缘规则把部分访问切到新站点版本。",
      operations: ["配置 CDN cohort", "观察 4xx/5xx 与命中率", "决定继续或阻断"],
      steps: ["route-cdn-cohort", "observe-cdn-slo", "write-verdict"],
      workspaces: [],
      paramKeys: ["canary-percent", "PACKAGE_UPLOAD_PUBLIC_BASE_URL", "runtime.RELEASE_NOTE"],
    },
    promote: {
      name: "CDN 全量切换",
      title: "静态站点全量",
      taskRef: "cdn-promote-stable-task",
      description: "把所有静态站点流量切到新版本，刷新 CDN 缓存并写入发布历史。",
      operations: ["切换 100% CDN 流量", "刷新入口缓存", "记录静态站点版本"],
      steps: ["promote-cdn", "refresh-entry-cache", "record-release"],
      workspaces: [],
      paramKeys: ["PACKAGE_UPLOAD_PUBLIC_BASE_URL", "target-env", "runtime.RELEASE_NOTE"],
    },
  },
  server_package: {
    build: {
      name: "服务运行包构建",
      title: "服务包构建",
      taskRef: "server-package-build-task",
      description: "构建 Node.js/Go 服务运行包，包含 standalone、bin 或 dist 等运行材料。",
      operations: ["恢复依赖或构建缓存", "执行服务打包命令", "校验运行入口"],
      steps: ["restore-cache", "package-script", "verify-runtime-entry"],
      paramKeys: ["NODE_ENV", "PACKAGE_BUILD_SCRIPT", "PACKAGE_BUILD_COMMAND", "PACKAGE_OUTPUT_PATHS"],
    },
    package: {
      name: "服务运行包归档",
      title: "运行包归档",
      taskRef: "server-package-archive-task",
      description: "把服务运行目录归档成 tar/zip 包，并写入包 digest 与版本元数据。",
      operations: ["归档运行目录", "写入 package digest", "生成部署元数据"],
      steps: ["archive-runtime", "write-digest", "deployment-metadata"],
      workspaces: ["source-ws"],
      paramKeys: ["PACKAGE_OUTPUT_PATHS", "PACKAGE_UPLOAD_TARGET_PATH"],
    },
    upload: {
      name: "包仓库上传",
      title: "运行包上传",
      taskRef: "server-package-upload-task",
      description: "把运行包上传到包仓库、制品库或主机可拉取的对象存储。",
      operations: ["上传运行包", "记录 package URI", "写入包仓库 digest"],
      steps: ["upload-package", "write-package-uri", "write-digest"],
      workspaces: ["source-ws"],
      paramKeys: [
        "PACKAGE_UPLOAD_PROVIDER",
        "PACKAGE_UPLOAD_ENDPOINT",
        "PACKAGE_UPLOAD_TARGET_PATH",
        "PACKAGE_UPLOAD_SERVICE_CONNECTION",
      ],
    },
    deploy: {
      name: "主机批次部署",
      title: "主机服务部署",
      taskRef: "host-package-deploy-task",
      description: "在 ECS/VM 主机组中按批次拉取运行包、解压、reload 服务并做健康检查。",
      operations: ["锁定主机批次", "拉取并解压运行包", "reload 服务并检查健康"],
      steps: ["select-host-batch", "extract-package", "reload-service"],
      workspaces: [],
      paramKeys: ["PACKAGE_UPLOAD_TARGET_PATH", "target-env", "canary-percent", "runtime.RELEASE_NOTE"],
    },
    canary: {
      name: "主机实例灰度",
      title: "实例批次灰度",
      taskRef: "host-batch-canary-task",
      description: "按主机实例批次放量，观察探活、日志错误率和负载均衡健康状态。",
      operations: ["切换实例批次", "观察主机健康", "决定继续或阻断"],
      steps: ["route-host-batch", "observe-host-health", "write-verdict"],
      workspaces: [],
      paramKeys: ["canary-percent", "target-env", "runtime.RELEASE_NOTE"],
    },
    promote: {
      name: "主机全量发布",
      title: "主机服务全量",
      taskRef: "host-package-promote-task",
      description: "把剩余主机批次升级到新运行包，确认负载均衡全部恢复健康。",
      operations: ["升级剩余主机", "确认 LB 健康", "记录服务包版本"],
      steps: ["promote-hosts", "verify-lb", "record-release"],
      workspaces: [],
      paramKeys: ["PACKAGE_UPLOAD_TARGET_PATH", "target-env", "runtime.RELEASE_NOTE"],
    },
  },
  kubernetes_manifest: {
    build: {
      name: "Manifest 渲染校验",
      title: "Kubernetes YAML 渲染",
      taskRef: "manifest-render-task",
      description: "渲染 Kustomize/YAML，并用 kubeconform 或 kubectl dry-run 校验资源结构。",
      operations: ["渲染 YAML", "执行 schema 校验", "生成 dry-run 结果"],
      steps: ["render-manifest", "schema-validate", "kubectl-dry-run"],
      paramKeys: ["DEPLOY_NAMESPACE", "PACKAGE_OUTPUT_PATHS", "runtime.RELEASE_NOTE"],
    },
    package: {
      name: "Manifest 包归档",
      title: "YAML 归档",
      taskRef: "manifest-package-task",
      description: "归档本次 Kubernetes YAML/Kustomize 输出，并记录变更摘要。",
      operations: ["归档 YAML", "生成 resource diff", "写入 manifest digest"],
      steps: ["archive-manifest", "resource-diff", "write-digest"],
      workspaces: ["source-ws"],
      paramKeys: ["PACKAGE_OUTPUT_PATHS", "DEPLOY_NAMESPACE"],
    },
    upload: {
      name: "Manifest 归档上传",
      title: "配置包上传",
      taskRef: "manifest-upload-task",
      description: "把 YAML 包上传到配置归档或对象存储，便于审计和回滚。",
      operations: ["上传 manifest 包", "记录 manifest URI", "写入审计摘要"],
      steps: ["upload-manifest", "write-uri", "audit-summary"],
      workspaces: ["source-ws"],
      paramKeys: ["PACKAGE_UPLOAD_ENDPOINT", "PACKAGE_UPLOAD_TARGET_PATH", "PACKAGE_UPLOAD_SERVICE_CONNECTION"],
    },
    deploy: {
      name: "kubectl 应用 Manifest",
      title: "Manifest 发布",
      taskRef: "kubernetes-manifest-apply-task",
      description: "对目标 namespace 执行 kubectl apply，并等待指定 workload rollout。",
      operations: ["kubectl apply", "检查资源 diff", "等待 workload rollout"],
      steps: ["kubectl-apply", "resource-diff", "rollout-status"],
      workspaces: ["kubeconfig"],
      paramKeys: ["DEPLOY_NAMESPACE", "target-env", "runtime.RELEASE_NOTE"],
    },
    canary: {
      name: "工作负载灰度观测",
      title: "Kubernetes 工作负载灰度",
      taskRef: "kubernetes-workload-canary-task",
      description: "按 Deployment/Ingress/ServiceMesh 控制器推进 YAML 工作负载灰度。",
      operations: ["调整工作负载权重", "观察 rollout 与 SLO", "写入 verdict"],
      steps: ["patch-traffic", "observe-workload", "write-verdict"],
      workspaces: ["kubeconfig"],
      paramKeys: ["DEPLOY_NAMESPACE", "canary-percent", "target-env"],
    },
    promote: {
      name: "Manifest 全量生效",
      title: "YAML 全量发布",
      taskRef: "kubernetes-manifest-promote-task",
      description: "确认 Manifest 工作负载全量生效，记录资源版本和审计事件。",
      operations: ["提升到 100% 工作负载", "确认资源健康", "记录 manifest release"],
      steps: ["promote-workload", "verify-resources", "record-release"],
      workspaces: ["kubeconfig"],
      paramKeys: ["DEPLOY_NAMESPACE", "target-env", "runtime.RELEASE_NOTE"],
    },
  },
  helm_chart: {
    build: {
      name: "Helm Chart 构建",
      title: "Chart 模板校验",
      taskRef: "helm-chart-build-task",
      description: "执行 helm lint/template，生成可部署的 Chart 输出与 values 覆盖。",
      operations: ["helm lint", "helm template", "校验 values overlay"],
      steps: ["helm-lint", "helm-template", "validate-values"],
      paramKeys: ["DEPLOY_NAMESPACE", "PACKAGE_OUTPUT_PATHS", "runtime.RELEASE_NOTE"],
    },
    package: {
      name: "Helm Chart 打包",
      title: "Chart 包归档",
      taskRef: "helm-chart-package-task",
      description: "执行 helm package，生成 Chart tgz、digest 和 release provenance。",
      operations: ["helm package", "计算 chart digest", "生成 chart provenance"],
      steps: ["helm-package", "chart-digest", "chart-provenance"],
      workspaces: ["source-ws"],
      paramKeys: ["PACKAGE_OUTPUT_PATHS", "DEPLOY_NAMESPACE"],
    },
    upload: {
      name: "Helm Chart 仓库上传",
      title: "Chart 仓库上传",
      taskRef: "helm-chart-push-task",
      description: "把 Chart 包推送到 Helm/OCI 仓库，记录 chart version 与 digest。",
      operations: ["helm push", "写入 chart digest", "更新 chart index"],
      steps: ["helm-push", "write-digest", "update-index"],
      workspaces: ["source-ws"],
      paramKeys: ["PACKAGE_UPLOAD_ENDPOINT", "PACKAGE_UPLOAD_TARGET_PATH", "PACKAGE_UPLOAD_SERVICE_CONNECTION"],
    },
    deploy: {
      name: "Helm Release 升级",
      title: "Helm 发布",
      taskRef: "helm-release-upgrade-task",
      description: "执行 helm upgrade --install，并按 namespace 观察 release 状态。",
      operations: ["helm upgrade --install", "注入 values override", "helm status"],
      steps: ["helm-upgrade", "values-override", "helm-status"],
      workspaces: ["kubeconfig"],
      paramKeys: ["DEPLOY_NAMESPACE", "target-env", "runtime.RELEASE_NOTE"],
    },
    canary: {
      name: "Helm 灰度参数",
      title: "Helm 灰度发布",
      taskRef: "helm-canary-values-task",
      description: "通过 values 覆盖灰度权重或副本策略，观察 Helm release 和工作负载状态。",
      operations: ["生成灰度 values", "升级 canary release", "观察 Helm 状态"],
      steps: ["render-canary-values", "helm-canary-upgrade", "observe-release"],
      workspaces: ["kubeconfig"],
      paramKeys: ["DEPLOY_NAMESPACE", "canary-percent", "target-env"],
    },
    promote: {
      name: "Helm 全量发布",
      title: "Helm 稳定版本",
      taskRef: "helm-promote-stable-task",
      description: "把 Helm release 切到稳定 values，确认 release revision 并记录回滚点。",
      operations: ["应用稳定 values", "确认 Helm revision", "记录 rollback revision"],
      steps: ["promote-values", "verify-revision", "record-rollback"],
      workspaces: ["kubeconfig"],
      paramKeys: ["DEPLOY_NAMESPACE", "target-env", "runtime.RELEASE_NOTE"],
    },
  },
};

export function stageLabelForPackageMode(packageMode: PackageMode, stage: LifecycleStageKey): string {
  return PACKAGE_MODE_STAGE_LABELS[packageMode]?.[stage] ?? STAGE_LABELS[stage];
}

export function taskDefinitionsForPackageMode(packageMode: PackageMode): TaskDefinition[] {
  const overrides = PACKAGE_MODE_TASK_OVERRIDES[packageMode] ?? {};
  return TASK_DEFINITIONS.map((definition) => {
    const override = overrides[definition.stage];
    return override ? { ...definition, ...override } : definition;
  });
}

export function taskDefinitionForPackageMode(
  packageMode: PackageMode,
  stage: LifecycleStageKey,
): TaskDefinition | undefined {
  return taskDefinitionsForPackageMode(packageMode).find((definition) => definition.stage === stage);
}

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
  const merged = {
    ...DEFAULT_PIPELINE_BUILD_CONFIG,
    ...pipeline.buildConfig,
    packageMode: pipeline.buildConfig?.packageMode ?? DEFAULT_PIPELINE_BUILD_CONFIG.packageMode,
    runtime: pipeline.buildConfig?.runtime ?? DEFAULT_PIPELINE_BUILD_CONFIG.runtime,
    contextPath: pipeline.buildConfig?.contextPath ?? pipeline.imageArtifact?.contextPath ?? DEFAULT_PIPELINE_BUILD_CONFIG.contextPath,
  };
  return {
    ...merged,
    packageBuildCommandMode: resolvePackageBuildCommandMode(pipeline.buildConfig ?? merged),
  };
}

export function packageUploadFromPipeline(pipeline: PipelineDefinition): PackageUploadConfig {
  const merged = {
    ...DEFAULT_PACKAGE_UPLOAD_CONFIG,
    ...pipeline.packageUpload,
    publicBaseUrl: pipeline.packageUpload?.publicBaseUrl ?? pipeline.packageUpload?.accessDomain ?? "",
    accessDomain: pipeline.packageUpload?.accessDomain ?? pipeline.packageUpload?.publicBaseUrl ?? "",
  };
  return {
    ...merged,
    customUploadCommandMode: resolvePackageUploadCommandMode(pipeline.packageUpload ?? merged),
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

