import type {
  EnvironmentType,
  GlobalParam,
  ImageArtifactConfig,
  LifecycleStageKey,
  PackageMode,
  PipelineBuildConfig,
  PipelineCacheConfig,
  PipelineDefinition,
} from "@deploy-management/shared";

export type PipelineSurface = "landing" | "list" | "detail" | "config";
export type PipelineConfigTab = "basic" | "source" | "flow" | "trigger" | "variables";
export type TemplateMode = "visual" | "yaml";

export interface PipelineTemplate {
  key: string;
  category: string;
  title: string;
  subtitle: string;
  badge?: string;
  icon: string;
  language: "node" | "go" | "empty";
  applicationId: string;
  repositoryId: string;
  environment: EnvironmentType;
  strategy: PipelineDefinition["strategy"];
  canaryPercent: number;
  packageMode: PackageMode;
  requiresApproval: boolean;
  triggers: string[];
  stages: LifecycleStageKey[];
  chips: string[];
  flowGroups: string[][];
  buildConfig: PipelineBuildConfig;
  imageArtifact?: Partial<ImageArtifactConfig>;
  variables?: GlobalParam[];
  runtimeVariables?: GlobalParam[];
  caches?: PipelineCacheConfig[];
  serviceConnections?: string[];
  settings: ReadonlyArray<{
    label: string;
    value: string;
  }>;
}

export const templateCategories = ["Node.js", "Go", "空模板"];

export const pipelineTemplates: PipelineTemplate[] = [
  {
    key: "node-test-build",
    category: "Node.js",
    title: "Node.js · 测试、构建",
    subtitle: "云效预置",
    badge: "云效预置",
    icon: "N",
    language: "node",
    applicationId: "",
    repositoryId: "",
    environment: "test",
    strategy: "rolling",
    canaryPercent: 100,
    packageMode: "server_package",
    requiresApproval: false,
    triggers: ["push main", "manual"],
    stages: ["source", "test", "build"],
    chips: ["JavaScript 代码扫描", "Node.js 单元测试", "Node.js 构建"],
    flowGroups: [["JavaScript 代码扫描", "Node.js 单元测试"], ["Node.js 构建"]],
    buildConfig: {
      packageMode: "server_package",
      packageBuildScript: "build",
      packageOutputPaths: [".next", "dist", "build", "out"],
    },
    serviceConnections: ["packages-artifact"],
    settings: [
      { label: "构建环境", value: "指定容器环境 / Node.js 20" },
      { label: "测试命令", value: "package.json scripts.test" },
      { label: "构建命令", value: "package.json scripts.build" },
      { label: "上传方式", value: "云效 Packages / 公共存储归档" },
    ],
  },
  {
    key: "node-image-build",
    category: "Node.js",
    title: "Node.js · 测试、构建镜像",
    subtitle: "云效预置",
    badge: "云效预置",
    icon: "N",
    language: "node",
    applicationId: "",
    repositoryId: "",
    environment: "staging",
    strategy: "rolling",
    canaryPercent: 100,
    packageMode: "container_image",
    requiresApproval: false,
    triggers: ["push main", "manual"],
    stages: ["source", "test", "build", "env", "package", "upload"],
    chips: ["JavaScript 代码扫描", "Node.js 单元测试", "变量注入", "镜像构建并推送"],
    flowGroups: [["JavaScript 代码扫描", "Node.js 单元测试"], ["镜像构建并推送"]],
    buildConfig: {
      packageMode: "container_image",
      packageBuildScript: "build",
      packageOutputPaths: [".next", "dist", "build", "out"],
    },
    imageArtifact: {
      registryProvider: "aliyun-acr",
      serviceConnection: "aliyun-acr-deploy",
      dockerConfigSecret: "aliyun-acr-deploy-secret",
      dockerfilePath: "Dockerfile",
      contextPath: ".",
    },
    serviceConnections: ["aliyun-acr-deploy"],
    settings: [
      { label: "构建环境", value: "指定容器环境 / Node.js 20" },
      { label: "镜像任务", value: "Docker build + docker push" },
      { label: "镜像仓库", value: "阿里云 ACR 服务连接" },
      { label: "Tag 规则", value: "${run.id}-${commit.short}" },
    ],
  },
  {
    key: "node-k8s-release",
    category: "Node.js",
    title: "Node.js · 测试、构建镜像、发布到阿里云容器服务ACK/自有Kubernetes集群",
    subtitle: "云效预置",
    badge: "云效预置",
    icon: "N",
    language: "node",
    applicationId: "",
    repositoryId: "",
    environment: "prod",
    strategy: "canary",
    canaryPercent: 20,
    packageMode: "container_image",
    requiresApproval: true,
    triggers: ["push main", "manual", "release tag"],
    stages: ["source", "test", "build", "env", "package", "upload", "deploy", "canary", "approval", "promote"],
    chips: ["JavaScript 代码扫描", "Node.js 单元测试", "变量注入", "镜像构建并推送", "Kubernetes 发布"],
    flowGroups: [["JavaScript 代码扫描", "Node.js 单元测试"], ["镜像构建并推送"], ["Kubernetes 发布"]],
    buildConfig: {
      packageMode: "container_image",
      packageBuildScript: "build",
      packageOutputPaths: [".next", "dist", "build", "out"],
    },
    imageArtifact: {
      registryProvider: "aliyun-acr",
      serviceConnection: "aliyun-acr-deploy",
      dockerConfigSecret: "aliyun-acr-deploy-secret",
      dockerfilePath: "Dockerfile",
      contextPath: ".",
    },
    serviceConnections: ["aliyun-acr-deploy", "ack-deploy"],
    variables: [
      {
        key: "K8S_MANIFEST_PATH",
        value: "k8s/",
        description: "Kubernetes YAML 或 Kustomize 文件目录。",
        injectionTiming: "deploy",
        targetStages: ["deploy", "canary", "promote"],
      },
    ],
    runtimeVariables: [
      {
        key: "RELEASE_NOTE",
        value: "ack rollout",
        description: "ACK / Kubernetes 发布说明。",
        injectionTiming: "runtime",
        targetStages: ["deploy", "canary", "approval", "promote"],
      },
    ],
    settings: [
      { label: "构建环境", value: "指定容器环境 / Node.js 20" },
      { label: "镜像仓库", value: "阿里云 ACR / 私有 Registry" },
      { label: "发布目标", value: "ACK / 自有 Kubernetes 集群" },
      { label: "灰度策略", value: "20% 金丝雀 + 人工审批 + 全量发布" },
    ],
  },
  {
    key: "node-ecs-release",
    category: "Node.js",
    title: "Node.js · 测试、构建、部署到阿里云ECS/自有主机",
    subtitle: "云效预置",
    badge: "云效预置",
    icon: "N",
    language: "node",
    applicationId: "",
    repositoryId: "",
    environment: "prod",
    strategy: "rolling",
    canaryPercent: 100,
    packageMode: "server_package",
    requiresApproval: true,
    triggers: ["push main", "manual", "release tag"],
    stages: ["source", "test", "build", "env", "package", "deploy", "approval", "promote"],
    chips: ["JavaScript 代码扫描", "Node.js 单元测试", "Node.js 构建", "主机部署"],
    flowGroups: [["JavaScript 代码扫描", "Node.js 单元测试"], ["Node.js 构建"], ["主机部署"]],
    buildConfig: {
      packageMode: "server_package",
      packageBuildScript: "build",
      packageOutputPaths: [".next", "dist", "build", "public", "package.json"],
    },
    serviceConnections: ["ecs-host-deploy", "packages-artifact"],
    variables: [
      {
        key: "HOST_GROUP",
        value: "prod-web-hosts",
        description: "云效主机组或自有主机分组。",
        injectionTiming: "deploy",
        targetStages: ["deploy", "promote"],
      },
      {
        key: "DEPLOY_PATH",
        value: "/var/www/application",
        description: "主机部署目录。",
        injectionTiming: "deploy",
        targetStages: ["deploy", "promote"],
      },
    ],
    settings: [
      { label: "构建物", value: "Node.js 服务包 / Next standalone" },
      { label: "上传方式", value: "Packages 统一制品管理" },
      { label: "部署目标", value: "ECS 主机组 / 自有主机" },
      { label: "发布动作", value: "解压制品 + reload 服务" },
    ],
  },
  {
    key: "node-react-oss",
    category: "Node.js",
    title: "Node.js · React 构建上传到 OSS",
    subtitle: "云效预置",
    badge: "云效预置",
    icon: "N",
    language: "node",
    applicationId: "",
    repositoryId: "",
    environment: "staging",
    strategy: "rolling",
    canaryPercent: 100,
    packageMode: "static_site",
    requiresApproval: false,
    triggers: ["merge request", "manual"],
    stages: ["source", "test", "build", "env", "package", "upload", "deploy", "promote"],
    chips: ["npm check", "Next.js 构建", "变量注入", "OSS 静态包上传"],
    flowGroups: [["JavaScript 代码扫描", "Node.js 单元测试"], ["Node.js 构建上传"]],
    buildConfig: {
      packageMode: "static_site",
      packageBuildScript: "build",
      packageOutputPaths: ["dist", "build", "out"],
    },
    serviceConnections: ["aliyun-oss-deploy", "packages-artifact"],
    variables: [
      {
        key: "OSS_BUCKET",
        value: "frontend-static-assets",
        description: "静态资源上传的 OSS Bucket。",
        injectionTiming: "deploy",
        targetStages: ["upload", "deploy", "promote"],
      },
      {
        key: "OSS_PREFIX",
        value: "${run.id}/",
        description: "静态资源版本目录。",
        injectionTiming: "deploy",
        targetStages: ["upload", "deploy", "promote"],
      },
    ],
    settings: [
      { label: "构建命令", value: "package.json scripts.build" },
      { label: "产物目录", value: "dist / build / out" },
      { label: "上传目标", value: "阿里云 OSS Bucket" },
      { label: "发布方式", value: "OSS 前缀切换 / CDN 刷新预留" },
    ],
  },
  {
    key: "go-test-build",
    category: "Go",
    title: "Go · 测试、构建",
    subtitle: "云效预置",
    badge: "云效预置",
    icon: "GO",
    language: "go",
    applicationId: "",
    repositoryId: "",
    environment: "test",
    strategy: "rolling",
    canaryPercent: 100,
    packageMode: "server_package",
    requiresApproval: false,
    triggers: ["push main", "manual"],
    stages: ["source", "test", "build", "package"],
    chips: ["Go 单元测试", "Go 构建"],
    flowGroups: [["Go 单元测试"], ["Go 构建"]],
    buildConfig: {
      packageMode: "server_package",
      packageBuildScript: "go build ./...",
      packageOutputPaths: ["bin", "dist", "build"],
    },
    serviceConnections: ["packages-artifact"],
    caches: [
      {
        key: "go-build-cache",
        path: ".cache/go-build",
        restoreKeys: ["go-"],
        enabled: true,
      },
    ],
    settings: [
      { label: "测试命令", value: "go test ./..." },
      { label: "构建命令", value: "go build ./..." },
      { label: "缓存", value: "GOMODCACHE / go-build cache" },
      { label: "上传方式", value: "Packages 统一制品管理" },
    ],
  },
  {
    key: "go-image-build",
    category: "Go",
    title: "Go · 测试、构建镜像",
    subtitle: "云效预置",
    badge: "云效预置",
    icon: "GO",
    language: "go",
    applicationId: "",
    repositoryId: "",
    environment: "staging",
    strategy: "rolling",
    canaryPercent: 100,
    packageMode: "container_image",
    requiresApproval: false,
    triggers: ["push main", "manual"],
    stages: ["source", "test", "build", "env", "package", "upload"],
    chips: ["Go 单元测试", "镜像构建并推送"],
    flowGroups: [["Go 单元测试"], ["镜像构建并推送"]],
    buildConfig: {
      packageMode: "container_image",
      packageBuildScript: "go build ./...",
      packageOutputPaths: ["bin", "dist", "build"],
    },
    imageArtifact: {
      registryProvider: "aliyun-acr",
      serviceConnection: "aliyun-acr-deploy",
      dockerConfigSecret: "aliyun-acr-deploy-secret",
      dockerfilePath: "Dockerfile",
      contextPath: ".",
    },
    serviceConnections: ["aliyun-acr-deploy"],
    caches: [
      {
        key: "go-build-cache",
        path: ".cache/go-build",
        restoreKeys: ["go-"],
        enabled: true,
      },
    ],
    settings: [
      { label: "测试命令", value: "go test ./..." },
      { label: "镜像任务", value: "Docker build + docker push" },
      { label: "镜像仓库", value: "阿里云 ACR 服务连接" },
      { label: "Tag 规则", value: "${run.id}-${commit.short}" },
    ],
  },
  {
    key: "empty-template",
    category: "空模板",
    title: "空模板 · 空模板",
    subtitle: "云效预置",
    badge: "云效预置",
    icon: "□",
    language: "empty",
    applicationId: "",
    repositoryId: "",
    environment: "dev",
    strategy: "rolling",
    canaryPercent: 100,
    packageMode: "server_package",
    requiresApproval: false,
    triggers: ["manual"],
    stages: ["source"],
    chips: ["空任务"],
    flowGroups: [["空任务"]],
    buildConfig: {
      packageMode: "server_package",
      packageBuildScript: "build",
      packageOutputPaths: ["dist"],
    },
    settings: [
      { label: "配置方式", value: "创建后手动添加阶段与任务" },
      { label: "默认触发", value: "手动运行" },
    ],
  },
];

export const landingTemplates: ReadonlyArray<readonly [string, string, string]> = [
  ["N", "Node.js 构建", "极速构建"],
  ["H", "主机部署", "持续部署"],
  ["K", "Kubernetes 发布", "持续部署"],
];

export const environmentOptions: EnvironmentType[] = ["dev", "test", "staging", "prod"];

export const categoryIcon = (category: string): string => {
  const icons: Record<string, string> = {
    组织模板: "▦",
    Java: "♨",
    PHP: "php",
    "Node.js": "⬢",
    Go: "GO",
    Python: "py",
    ".NET Core": "NET",
    "C++": "C",
    移动端: "▯",
    空模板: "□",
    其他: "···",
  };
  return icons[category] ?? "·";
};
