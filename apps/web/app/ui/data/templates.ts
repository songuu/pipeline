import type { EnvironmentType, LifecycleStageKey, PipelineDefinition } from "@deploy-management/shared";

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
  applicationId: string;
  repositoryId: string;
  environment: EnvironmentType;
  strategy: PipelineDefinition["strategy"];
  canaryPercent: number;
  requiresApproval: boolean;
  triggers: string[];
  stages: LifecycleStageKey[];
  chips: string[];
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
    applicationId: "mall-api",
    repositoryId: "repo-mall-api",
    environment: "test",
    strategy: "rolling",
    canaryPercent: 100,
    requiresApproval: false,
    triggers: ["push main", "manual"],
    stages: ["source", "test", "build"],
    chips: ["JavaScript 代码扫描", "Node.js 单元测试", "Node.js 构建"],
  },
  {
    key: "node-image-build",
    category: "Node.js",
    title: "Node.js · 测试、构建镜像",
    subtitle: "云效预置",
    badge: "云效预置",
    icon: "N",
    applicationId: "mall-api",
    repositoryId: "repo-mall-api",
    environment: "staging",
    strategy: "rolling",
    canaryPercent: 100,
    requiresApproval: false,
    triggers: ["push main", "manual"],
    stages: ["source", "test", "build", "env", "package", "upload"],
    chips: ["JavaScript 代码扫描", "Node.js 单元测试", "变量注入", "镜像构建并推送"],
  },
  {
    key: "node-k8s-release",
    category: "Node.js",
    title: "Node.js · 测试、构建镜像、发布到阿里云容器服务ACK/自有Kubernetes集群",
    subtitle: "云效预置",
    badge: "云效预置",
    icon: "N",
    applicationId: "mall-api",
    repositoryId: "repo-mall-api",
    environment: "prod",
    strategy: "canary",
    canaryPercent: 20,
    requiresApproval: true,
    triggers: ["push main", "manual", "release tag"],
    stages: ["source", "test", "build", "env", "package", "upload", "deploy", "canary", "approval", "promote"],
    chips: ["JavaScript 代码扫描", "Node.js 单元测试", "变量注入", "镜像构建并推送", "Kubernetes 发布"],
  },
  {
    key: "web-staging-release",
    category: "Node.js",
    title: "前端 · 静态包发布",
    subtitle: "Web 应用持续部署",
    badge: "推荐",
    icon: "W",
    applicationId: "admin-web",
    repositoryId: "repo-admin-web",
    environment: "staging",
    strategy: "rolling",
    canaryPercent: 100,
    requiresApproval: false,
    triggers: ["merge request", "manual"],
    stages: ["source", "test", "build", "env", "package", "upload", "deploy", "promote"],
    chips: ["npm check", "Next.js 构建", "变量注入", "OSS 静态包上传"],
  },
  {
    key: "empty-template",
    category: "空模板",
    title: "空模板 · 空模板",
    subtitle: "云效预置",
    badge: "云效预置",
    icon: "□",
    applicationId: "mall-api",
    repositoryId: "repo-mall-api",
    environment: "dev",
    strategy: "rolling",
    canaryPercent: 100,
    requiresApproval: false,
    triggers: ["manual"],
    stages: ["source"],
    chips: ["空任务"],
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
