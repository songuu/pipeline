import type {
  Application,
  DeploymentEnvironment,
  PipelineDefinition,
  RunnerPool,
  SourceRepository,
} from "@deploy-management/shared";

export const SEED_REPOSITORIES: SourceRepository[] = [
  {
    id: "gitcode:zhuwuwei/tianqi-app",
    name: "tianqi-app",
    provider: "gitcode",
    url: "https://gitcode.com/zhuwuwei/tianqi-app.git",
    defaultBranch: "main",
    branches: ["main", "dev"],
    tags: [],
    recentCommits: [],
    owner: "zhuwuwei",
  },
];

export const SEED_APPLICATIONS: Application[] = [
  {
    id: "tianqi-web",
    name: "天气前端",
    owner: "前端团队",
    repositoryId: "gitcode:zhuwuwei/tianqi-app",
    repository: "https://gitcode.com/zhuwuwei/tianqi-app.git",
    defaultBranch: "main",
    language: "Node.js",
    serviceType: "static_site",
    environments: ["test", "staging", "prod"],
  },
];

export const SEED_PIPELINES: PipelineDefinition[] = [
  {
    id: "pipe-frontend-static-custom",
    name: "tianqi-frontend-staging-release",
    applicationId: "tianqi-web",
    repositoryId: "gitcode:zhuwuwei/tianqi-app",
    repository: "https://gitcode.com/zhuwuwei/tianqi-app.git",
    defaultBranch: "main",
    defaultRefType: "branch",
    defaultRef: "main",
    sourcePolicy: {
      allowedBranchPatterns: ["main", "dev", "release/*", "hotfix/*"],
      allowedTagPatterns: ["v*", "tianqi-app-*", "release-*"],
      allowRuntimeBranch: true,
      allowRuntimeTag: true,
      allowRuntimeCommit: true,
    },
    targetEnvironment: "staging",
    strategy: "rolling",
    canaryPercent: 100,
    requiresApproval: false,
    stages: ["source", "test", "build", "env", "package", "upload", "deploy", "promote"],
    triggers: ["push main", "manual"],
    owner: "前端团队",
    variables: [
      {
        key: "NODE_ENV",
        value: "staging",
        description: "前端构建环境。",
        injectionTiming: "build",
        targetStages: ["test", "build", "package"],
      },
      {
        key: "PUBLIC_BASE_URL",
        value: "",
        description: "使用者填写：前端构建时使用的公开访问域名。",
        injectionTiming: "build",
        targetStages: ["build", "upload", "deploy"],
      },
      {
        key: "BUILD_ARGS",
        value: "",
        description: "使用者填写：前端打包命令需要的额外参数。",
        injectionTiming: "build",
        targetStages: ["build"],
      },
      {
        key: "DEPLOY_NAMESPACE",
        value: "tianqi-web-staging",
        description: "部署命名空间。",
        injectionTiming: "deploy",
        targetStages: ["deploy", "promote"],
      },
    ],
    runtimeVariables: [
      {
        key: "RELEASE_NOTE",
        value: "frontend static release",
        description: "运行时发布说明。",
        injectionTiming: "runtime",
        targetStages: ["deploy", "promote"],
      },
    ],
    caches: [
      {
        key: "tianqi-app-pnpm-store",
        path: "node_modules/.pnpm-store",
        restoreKeys: ["tianqi-app-", "node-"],
        enabled: true,
      },
    ],
    serviceConnections: ["gitcode-readonly", "static-server-deploy", "packages-artifact"],
    buildConfig: {
      packageMode: "static_site",
      runtime: "node",
      contextPath: ".",
      packageBuildCommandMode: "custom",
      packageBuildScript: "build",
      packageOutputPaths: ["dist", "build", "out"],
    },
    packageUpload: {
      provider: "static-server",
      customUploadCommandMode: "provider",
      endpoint: "https://static.example.com/frontend",
      targetPathTemplate: "${application.id}/${environment}/${run.id}/${artifact.name}",
      serviceConnection: "static-server-deploy",
    },
  },
];

export const SEED_ENVIRONMENTS: DeploymentEnvironment[] = [];

export const SEED_RUNNER_POOLS: RunnerPool[] = [];
