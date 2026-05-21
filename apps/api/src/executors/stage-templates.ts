import {
  DEFAULT_PACKAGE_UPLOAD_CONFIG,
  DEFAULT_PIPELINE_BUILD_CONFIG,
  resolveImageArtifact,
  type LifecycleStageKey,
  type PackageMode,
  type PipelineDefinition,
  type PipelineRun,
} from "@deploy-management/shared";

/**
 * 各生命周期阶段的模拟时长（毫秒）。SimulatedExecutor 用其推进 stage。
 */
export const STAGE_DURATIONS: Record<LifecycleStageKey, number> = {
  source: 18_000,
  test: 96_000,
  build: 184_000,
  env: 12_000,
  package: 42_000,
  upload: 28_000,
  deploy: 76_000,
  canary: 135_000,
  approval: 0,
  promote: 58_000,
};

const DEFAULT_STAGE_TITLES: Record<LifecycleStageKey, string> = {
  source: "拉取代码",
  test: "测试与扫描",
  build: "打包构建",
  env: "注入环境变量",
  package: "生成制品",
  upload: "上传制品",
  deploy: "部署环境",
  canary: "灰度发布",
  approval: "发布审批",
  promote: "全量发布",
};

const MODE_STAGE_TITLES: Record<PackageMode, Partial<Record<LifecycleStageKey, string>>> = {
  container_image: {
    package: "镜像 SBOM 与证明",
    upload: "镜像构建并推送",
    deploy: "Kubernetes 镜像部署",
    canary: "流量灰度观测",
    promote: "镜像全量发布",
  },
  static_site: {
    build: "静态站点构建",
    package: "静态站点包归档",
    upload: "OSS/CDN 静态包上传",
    deploy: "静态站点版本切换",
    canary: "CDN 分组灰度",
    promote: "CDN 全量切换",
  },
  server_package: {
    build: "服务运行包构建",
    package: "服务运行包归档",
    upload: "包仓库上传",
    deploy: "主机批次部署",
    canary: "主机实例灰度",
    promote: "主机全量发布",
  },
  kubernetes_manifest: {
    build: "Manifest 渲染校验",
    package: "Manifest 包归档",
    upload: "Manifest 归档上传",
    deploy: "kubectl 应用 Manifest",
    canary: "工作负载灰度观测",
    promote: "Manifest 全量生效",
  },
  helm_chart: {
    build: "Helm Chart 构建",
    package: "Helm Chart 打包",
    upload: "Helm Chart 仓库上传",
    deploy: "Helm Release 升级",
    canary: "Helm 灰度参数",
    promote: "Helm 全量发布",
  },
};

export function stageTitleForPipeline(stage: LifecycleStageKey, pipeline: PipelineDefinition): string {
  const packageMode = packageModeFromPipeline(pipeline);
  return MODE_STAGE_TITLES[packageMode]?.[stage] ?? DEFAULT_STAGE_TITLES[stage];
}

export function stageTitleForRun(stage: LifecycleStageKey, run: PipelineRun): string {
  return stageTitleForPipeline(stage, run.definitionSnapshot);
}

/**
 * 阶段日志模板。失败态返回不同的诊断信息。
 */
export const buildStageLogs = (
  stage: LifecycleStageKey,
  run: PipelineRun,
  status: "success" | "failed",
): string[] => {
  const failed = status === "failed";
  const image = resolveImageArtifact(run.definitionSnapshot, run);
  const buildConfig = run.definitionSnapshot.buildConfig ?? DEFAULT_PIPELINE_BUILD_CONFIG;
  const packageUpload = run.definitionSnapshot.packageUpload ?? DEFAULT_PACKAGE_UPLOAD_CONFIG;
  const packageMode = packageModeFromPipeline(run.definitionSnapshot);
  const isGo = buildConfig.runtime === "go";
  const templates: Record<LifecycleStageKey, string[]> = {
    source: [
      `git clone ${run.definitionSnapshot.repository}`,
      run.refType === "tag"
        ? `checkout tag ${run.refName} -> ${run.commit}`
        : `checkout branch ${run.branch}@${run.commit}`,
      "生成 source snapshot 与变更文件清单。",
    ],
    test: [
      isGo ? "恢复 Go module 与 go-build 缓存。" : "恢复依赖缓存。",
      failed
        ? isGo ? "Go 单元测试失败: go test ./... 返回错误。" : "单元测试失败: service.spec.ts timeout"
        : isGo ? "Go 单元测试通过: go test ./...。" : "单元测试通过: 284 passed, 0 failed。",
      failed ? "质量门禁阻止后续构建。" : "SAST 扫描通过，未发现高危漏洞。",
    ],
    build: [
      ...buildLogsForPackageMode(packageMode, buildConfig.packageBuildScript, buildConfig.packageOutputPaths, isGo, failed),
    ],
    env: [
      `注入环境变量: NODE_ENV=${run.environment === "prod" ? "production" : run.environment}`,
      "挂载密钥引用: ACR_TOKEN、KUBECONFIG、CANARY_ROUTER_TOKEN。",
      failed ? "变量校验失败: 缺少 DEPLOY_NAMESPACE。" : "生成 Tekton task env 与 projected secret 清单。",
    ],
    package: [
      ...packageLogsForPackageMode(packageMode, buildConfig.packageOutputPaths),
    ],
    upload: [
      ...uploadLogsForPackageMode(packageMode, image, packageUpload, failed),
    ],
    deploy: [
      ...deployLogsForPackageMode(packageMode, run, image.imageRef),
    ],
    canary: [
      ...canaryLogsForPackageMode(packageMode, run.canaryPercent),
    ],
    approval: [
      "创建生产发布审批单。",
      "等待 owner 与 SRE 双人确认。",
    ],
    promote: [
      ...promoteLogsForPackageMode(packageMode),
    ],
  };

  return templates[stage];
};

function packageModeFromPipeline(pipeline: PipelineDefinition): PackageMode {
  return pipeline.buildConfig?.packageMode ?? DEFAULT_PIPELINE_BUILD_CONFIG.packageMode ?? "container_image";
}

function buildLogsForPackageMode(
  packageMode: PackageMode,
  buildScript: string,
  outputPaths: string[],
  isGo: boolean,
  failed: boolean,
): string[] {
  const outputs = outputPaths.join(" / ");
  if (packageMode === "static_site") {
    return [
      `执行静态站点构建脚本 package.json scripts.${buildScript}。`,
      failed ? "站点构建失败: 未生成 index.html 或静态资源目录。" : `静态资源构建完成: ${outputs}。`,
    ];
  }
  if (packageMode === "server_package") {
    return [
      isGo ? "执行 go mod download 与 go build -o bin/application ." : `执行服务运行包构建脚本 package.json scripts.${buildScript}。`,
      failed ? "服务包构建失败: 未生成可运行入口。" : `服务运行包构建完成: ${outputs}。`,
    ];
  }
  if (packageMode === "kubernetes_manifest") {
    return [
      "渲染 Kubernetes YAML / Kustomize 输出。",
      failed ? "Manifest 校验失败: kubectl dry-run 未通过。" : `Manifest 校验完成: ${outputs}。`,
    ];
  }
  if (packageMode === "helm_chart") {
    return [
      "执行 helm lint 与 helm template。",
      failed ? "Helm Chart 校验失败: values 或模板渲染错误。" : `Helm Chart 构建完成: ${outputs}。`,
    ];
  }
  return [
    isGo ? "执行 go mod download 与 go build -o bin/application ." : `执行 package.json scripts.${buildScript}。`,
    failed ? "打包失败: 未生成配置的真实产物目录。" : `打包完成，准备 OCI 镜像上下文: ${outputs}。`,
  ];
}

function packageLogsForPackageMode(packageMode: PackageMode, outputPaths: string[]): string[] {
  const outputs = outputPaths.join(" / ");
  if (packageMode === "static_site") {
    return ["归档静态站点目录并生成 asset manifest。", "写入静态包 digest 与 CDN 回滚元数据。"];
  }
  if (packageMode === "server_package") {
    return ["归档服务运行目录、启动脚本和部署元数据。", "写入服务包 digest 与主机批次部署材料。"];
  }
  if (packageMode === "kubernetes_manifest") {
    return ["归档 Kubernetes YAML / Kustomize 输出。", "生成资源 diff 与 manifest digest。"];
  }
  if (packageMode === "helm_chart") {
    return ["执行 helm package 生成 chart tgz。", "写入 chart digest、version 和 provenance。"];
  }
  return [`为镜像上下文收集构建材料: ${outputs}。`, "生成镜像 SBOM、测试报告与 provenance 原始材料。"];
}

function uploadLogsForPackageMode(
  packageMode: PackageMode,
  image: ReturnType<typeof resolveImageArtifact>,
  packageUpload: NonNullable<PipelineDefinition["packageUpload"]>,
  failed: boolean,
): string[] {
  if (packageMode === "static_site") {
    return [
      `上传静态包到 OSS/CDN 目标 ${packageUpload.endpoint}。`,
      failed ? "OSS/CDN 上传失败: 无法写入目标路径。" : `写入静态站点 public URL: ${packageUpload.publicBaseUrl ?? packageUpload.accessDomain ?? "pending"}。`,
    ];
  }
  if (packageMode === "server_package") {
    return [
      `上传服务运行包到包仓库 ${packageUpload.endpoint}。`,
      failed ? "包仓库上传失败: service connection 无效。" : "记录 package URI 与 package digest。",
    ];
  }
  if (packageMode === "kubernetes_manifest") {
    return [
      `上传 Manifest 归档到 ${packageUpload.endpoint}。`,
      failed ? "Manifest 归档上传失败。" : "写入 manifest URI 与审计摘要。",
    ];
  }
  if (packageMode === "helm_chart") {
    return [
      `helm push chart package 到 ${packageUpload.endpoint}。`,
      failed ? "Helm Chart 上传失败: 仓库凭据或 chart version 冲突。" : "更新 chart index 并记录 chart digest。",
    ];
  }
  return [
    `docker build -f ${image.dockerfilePath} -t ${image.imageRef} ${image.contextPath}`,
    `docker push ${image.imageRef} 并记录 registry digest。`,
  ];
}

function deployLogsForPackageMode(packageMode: PackageMode, run: PipelineRun, imageRef: string): string[] {
  if (packageMode === "static_site") {
    return [`切换静态站点 ${run.environment} release 入口。`, "提交 CDN 规则并保留上一版本回滚点。"];
  }
  if (packageMode === "server_package") {
    return [`选择 ${run.environment} 主机批次并拉取服务包。`, "解压运行包，reload 服务并等待健康检查通过。"];
  }
  if (packageMode === "kubernetes_manifest") {
    return [`kubectl apply -n ${run.environment} -f manifest package。`, "等待 Deployment/StatefulSet rollout status 就绪。"];
  }
  if (packageMode === "helm_chart") {
    return [`helm upgrade --install ${run.applicationName} chart -n ${run.environment}。`, "检查 Helm release revision 与工作负载状态。"];
  }
  return [`更新 Kubernetes 工作负载镜像为 ${imageRef}。`, "提交 Kubernetes rollout 并等待副本就绪。"];
}

function canaryLogsForPackageMode(packageMode: PackageMode, canaryPercent: number): string[] {
  if (packageMode === "static_site") {
    return [`CDN cohort 灰度 ${canaryPercent}% 用户或路径。`, "观察 4xx/5xx、缓存命中率和页面可用性。"];
  }
  if (packageMode === "server_package") {
    return [`主机实例批次灰度 ${canaryPercent}%。`, "观察实例探活、日志错误率和负载均衡健康状态。"];
  }
  if (packageMode === "kubernetes_manifest") {
    return [`Kubernetes 工作负载灰度 ${canaryPercent}%。`, "观察 rollout、Pod readiness 和服务 SLO。"];
  }
  if (packageMode === "helm_chart") {
    return [`Helm values 灰度 ${canaryPercent}% 权重。`, "观察 Helm release、Pod readiness 和服务 SLO。"];
  }
  return [`灰度发布 ${canaryPercent}% 流量。`, "观察窗口 5 分钟，错误率 0.04%，P95 延迟稳定。"];
}

function promoteLogsForPackageMode(packageMode: PackageMode): string[] {
  if (packageMode === "static_site") {
    return ["切换 CDN / 静态入口至 100% 新版本。", "刷新入口缓存并写入静态站点发布历史。"];
  }
  if (packageMode === "server_package") {
    return ["升级剩余主机实例到新运行包。", "确认负载均衡全部健康并写入部署历史。"];
  }
  if (packageMode === "kubernetes_manifest") {
    return ["确认 Manifest 工作负载全量生效。", "写入资源版本、审计事件和回滚点。"];
  }
  if (packageMode === "helm_chart") {
    return ["应用稳定 Helm values 并确认 release revision。", "记录 Helm rollback revision 和审计事件。"];
  }
  return ["扩大流量至 100%。", "写入部署历史、审计事件和签名证明。"];
}
