import type { LifecycleStageKey, PackageMode, PackageUploadConfig, PipelineDefinition, PipelineRun } from "../platform";

export const IMAGE_REGISTRY_PROVIDERS = [
  "aliyun-acr",
  "harbor",
  "docker-hub",
  "tencent-tcr",
  "aws-ecr",
  "custom",
] as const;

export type ImageRegistryProvider = (typeof IMAGE_REGISTRY_PROVIDERS)[number];

export type ImageArtifactConfig = {
  registryProvider?: ImageRegistryProvider;
  region?: string;
  registryUrl: string;
  internalRegistryUrl?: string;
  useInternalRegistry?: boolean;
  namespace: string;
  imageName: string;
  tagTemplate: string;
  serviceConnection: string;
  privateRegistry: boolean;
  registryUsername?: string;
  dockerConfigSecret?: string;
  dockerfilePath: string;
  contextPath: string;
};

export type ResolvedImageArtifact = ImageArtifactConfig & {
  tag: string;
  repository: string;
  imageRef: string;
};

export function shouldAutoIncludeRegistryUpload(imageArtifact?: Pick<
  ImageArtifactConfig,
  "registryUrl" | "namespace" | "imageName" | "tagTemplate" | "serviceConnection"
>): boolean {
  return Boolean(
    imageArtifact?.registryUrl.trim() &&
      imageArtifact.namespace.trim() &&
      imageArtifact.imageName.trim() &&
      imageArtifact.tagTemplate.trim() &&
      imageArtifact.serviceConnection.trim(),
  );
}

export function ensureRegistryUploadStage(
  stages: LifecycleStageKey[],
  imageArtifact?: Pick<ImageArtifactConfig, "registryUrl" | "namespace" | "imageName" | "tagTemplate" | "serviceConnection">,
): LifecycleStageKey[] {
  if (!shouldAutoIncludeRegistryUpload(imageArtifact) || !stages.includes("build") || stages.includes("upload")) {
    return stages;
  }
  const buildIndex = stages.indexOf("build");
  return [...stages.slice(0, buildIndex + 1), "upload", ...stages.slice(buildIndex + 1)];
}

export function shouldAutoIncludePackageUpload(
  packageMode: PackageMode | undefined,
  packageUpload?: Pick<PackageUploadConfig, "endpoint" | "serviceConnection">,
): boolean {
  return Boolean(
    packageMode &&
      packageMode !== "container_image" &&
      packageUpload?.endpoint.trim() &&
      packageUpload.serviceConnection.trim(),
  );
}

export function ensureArtifactUploadStage(
  stages: LifecycleStageKey[],
  options: {
    packageMode?: PackageMode;
    imageArtifact?: Pick<ImageArtifactConfig, "registryUrl" | "namespace" | "imageName" | "tagTemplate" | "serviceConnection">;
    packageUpload?: Pick<PackageUploadConfig, "endpoint" | "serviceConnection">;
  },
): LifecycleStageKey[] {
  if (options.packageMode === "container_image") {
    return ensureRegistryUploadStage(stages, options.imageArtifact);
  }
  if (!shouldAutoIncludePackageUpload(options.packageMode, options.packageUpload) || !stages.includes("build") || stages.includes("upload")) {
    return stages;
  }
  const buildIndex = stages.indexOf("build");
  return [...stages.slice(0, buildIndex + 1), "upload", ...stages.slice(buildIndex + 1)];
}

const ACR_PRESET_DEFAULTS: ImageArtifactConfig = {
  registryProvider: "aliyun-acr",
  region: "cn-hangzhou",
  registryUrl: "crpi-yjy3pqx1wqed2s2s.cn-hangzhou.personal.cr.aliyuncs.com",
  internalRegistryUrl: "crpi-yjy3pqx1wqed2s2s-vpc.cn-hangzhou.personal.cr.aliyuncs.com",
  useInternalRegistry: false,
  namespace: "company_sy",
  imageName: "deploy",
  tagTemplate: "${run.id}-${commit.short}",
  serviceConnection: "aliyun-acr-deploy",
  privateRegistry: true,
  registryUsername: "songyu19960525",
  dockerConfigSecret: "aliyun-acr-deploy-secret",
  dockerfilePath: "Dockerfile",
  contextPath: ".",
};

export type ImageRegistryPreset = {
  provider: ImageRegistryProvider;
  label: string;
  description: string;
  defaults: ImageArtifactConfig;
};

export const IMAGE_REGISTRY_PRESETS: Record<ImageRegistryProvider, ImageRegistryPreset> = {
  "aliyun-acr": {
    provider: "aliyun-acr",
    label: "阿里云 ACR",
    description: "使用阿里云容器镜像服务，当前已接入 deploy 仓库。",
    defaults: ACR_PRESET_DEFAULTS,
  },
  harbor: {
    provider: "harbor",
    label: "Harbor",
    description: "适合企业自建 Harbor，凭据通过 docker-registry Secret 注入。",
    defaults: {
      registryProvider: "harbor",
      registryUrl: "harbor.example.com",
      namespace: "library",
      imageName: "application",
      tagTemplate: "${run.id}-${commit.short}",
      serviceConnection: "harbor-push",
      privateRegistry: true,
      dockerConfigSecret: "harbor-registry-secret",
      dockerfilePath: "Dockerfile",
      contextPath: ".",
    },
  },
  "docker-hub": {
    provider: "docker-hub",
    label: "Docker Hub",
    description: "使用 Docker Hub 推送镜像，namespace 通常是组织或用户名。",
    defaults: {
      registryProvider: "docker-hub",
      registryUrl: "docker.io",
      namespace: "library",
      imageName: "application",
      tagTemplate: "${run.id}-${commit.short}",
      serviceConnection: "dockerhub-push",
      privateRegistry: true,
      dockerConfigSecret: "dockerhub-registry-secret",
      dockerfilePath: "Dockerfile",
      contextPath: ".",
    },
  },
  "tencent-tcr": {
    provider: "tencent-tcr",
    label: "腾讯云 TCR",
    description: "使用腾讯云容器镜像服务，按企业版或个人版域名填写 registry。",
    defaults: {
      registryProvider: "tencent-tcr",
      registryUrl: "ccr.ccs.tencentyun.com",
      namespace: "default",
      imageName: "application",
      tagTemplate: "${run.id}-${commit.short}",
      serviceConnection: "tencent-tcr-push",
      privateRegistry: true,
      dockerConfigSecret: "tencent-tcr-secret",
      dockerfilePath: "Dockerfile",
      contextPath: ".",
    },
  },
  "aws-ecr": {
    provider: "aws-ecr",
    label: "AWS ECR",
    description: "使用 AWS ECR，登录凭据建议由外部任务刷新为 docker-registry Secret。",
    defaults: {
      registryProvider: "aws-ecr",
      region: "ap-east-1",
      registryUrl: "000000000000.dkr.ecr.ap-east-1.amazonaws.com",
      namespace: "default",
      imageName: "application",
      tagTemplate: "${run.id}-${commit.short}",
      serviceConnection: "aws-ecr-push",
      privateRegistry: true,
      dockerConfigSecret: "aws-ecr-secret",
      dockerfilePath: "Dockerfile",
      contextPath: ".",
    },
  },
  custom: {
    provider: "custom",
    label: "自定义 Registry",
    description: "用于后续新增镜像托管，只需要填写 registry、namespace、secret 与服务连接。",
    defaults: {
      registryProvider: "custom",
      registryUrl: "registry.example.com",
      namespace: "library",
      imageName: "application",
      tagTemplate: "${run.id}-${commit.short}",
      serviceConnection: "custom-registry-push",
      privateRegistry: true,
      dockerConfigSecret: "custom-registry-secret",
      dockerfilePath: "Dockerfile",
      contextPath: ".",
    },
  },
};
export function resolveImageArtifact(
  definition: PipelineDefinition,
  run?: Pick<PipelineRun, "id" | "commit" | "refName" | "environment" | "applicationId">,
): ResolvedImageArtifact {
  const config = definition.imageArtifact ?? defaultImageArtifactConfig(definition);
  const registryUrl = normalizeRegistryUrl(
    config.useInternalRegistry && config.internalRegistryUrl ? config.internalRegistryUrl : config.registryUrl,
  );
  const namespace = sanitizeImagePathSegment(config.namespace || definition.applicationId);
  const imageName = sanitizeImagePathSegment(config.imageName || definition.applicationId);
  const tag = renderImageTag(config.tagTemplate || "${run.id}-${commit.short}", definition, run);
  const repository = [registryUrl, namespace, imageName].filter(Boolean).join("/");
  return {
    ...config,
    registryUrl,
    namespace,
    imageName,
    tag,
    repository,
    imageRef: `${repository}:${tag}`,
  };
}

export function defaultImageArtifactConfig(
  definition: Pick<PipelineDefinition, "applicationId" | "name" | "serviceConnections">,
): ImageArtifactConfig {
  const preset = IMAGE_REGISTRY_PRESETS["aliyun-acr"].defaults;
  return {
    ...preset,
    serviceConnection: definition.serviceConnections?.[1] ?? preset.serviceConnection,
  };
}

function renderImageTag(
  template: string,
  definition: PipelineDefinition,
  run?: Pick<PipelineRun, "id" | "commit" | "refName" | "environment" | "applicationId">,
): string {
  const commit = run?.commit ?? "commit";
  const values: Record<string, string> = {
    "run.id": run?.id ?? "run",
    commit,
    "commit.short": commit.slice(0, 8),
    "ref.name": run?.refName ?? definition.defaultRef,
    environment: run?.environment ?? definition.targetEnvironment,
    "application.id": run?.applicationId ?? definition.applicationId,
  };
  const rendered = template.replace(/\$\{([^}]+)\}/g, (_, key: string) => values[key.trim()] ?? "unknown");
  return sanitizeImageTag(rendered);
}

function normalizeRegistryUrl(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/g, "");
}

function sanitizeImagePathSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^\/+|\/+$/g, "");
  return normalized || "application";
}

function sanitizeImageTag(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
  return normalized || "latest";
}
