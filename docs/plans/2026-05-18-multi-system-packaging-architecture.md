---
title: "多系统打包架构分析 — PackagePlugin / BuilderEngine / 自定义打包"
type: analysis
status: completed
created: "2026-05-18"
updated: "2026-05-18"
tags: [analysis, architecture, packaging, plugin, builder, multi-platform]
aliases: ["多系统打包架构", "PackagePlugin 架构"]
parent_thread: ["docs/plans/2026-05-15-package-mode-rollout.md", "docs/plans/2026-05-15-cicd-optimization-analysis.md"]
---

# 多系统打包架构分析

> **目的：** 当系统未来需要支持「不同目标系统的打包」（apk/ipa/exe/jar/lambda/原生二进制 等）以及「用户自定义打包」（自带 Dockerfile/Step/builder 镜像/Pipeline YAML）时，应该如何架构。
>
> **结论先行：** 不要一上来就上完整插件化。当前 `PACKAGE_MODES` 5 枚举 + `ImageArtifactConfig` 已经覆盖了 80% web/容器/k8s 场景。真正的缺口是 **(1) builder 引擎只锁死 docker；(2) 单 run 只产单一产物；(3) 缺自定义 Pipeline YAML 通道**。按 S/M/L 三档渐进引入即可，本文给出三档的具体改造路径。

---

## 0. 现状能力矩阵

> 数据来源：`packages/shared/src/platform/index.ts`、`registry/index.ts`、`release/index.ts`、`apps/api/src/executors/local-docker.executor.ts`、`services/tekton-bridge/internal/backend/tekton.go`、`docs/plans/2026-05-15-package-mode-rollout.md`

### PackageMode × 真实执行路径

| PackageMode | Build 路径（local-docker） | Build 路径（tekton） | Rollout policy | 落地度 |
|---|---|---|---|---|
| `container_image` | `docker build -f Dockerfile -t imageRef .` + `docker push` | hardcode 5 Tekton task（source/test/build/upload/deploy） | `CanaryRolloutPolicy` 真 `docker pull/run` + 真 `kubectl set image + rollout status` | ✅ 完整 |
| `static_site` | 真解包到 `STATIC_SITE_DEPLOY_ROOT` + 切 `current` 软链 | 同上 | `StaticSiteRolloutPolicy`（cohorts / CDN / cacheTtl） | ✅ 本地完整，CDN 未接 |
| `server_package` | 真解包到 `SERVER_PACKAGE_DEPLOY_ROOT` + `SERVER_PACKAGE_ACTIVATE_COMMAND` + healthcheck | 同上 | `ServerPackageRolloutPolicy`（batches / healthCheckPath / maxUnavailable） | ✅ 本地完整，远端主机组未接 |
| `kubernetes_manifest` | 真 `kubectl apply -f` + `rollout status` | 同上 | `KubernetesRolloutPolicy`（deployment / ingress / service-mesh / argo-rollouts） | ✅ Deployment 完整，ServiceMesh 未细化 |
| `helm_chart` | 真 `helm upgrade --install --wait` | 同上 | `HelmRolloutPolicy`（chart / values / namespace） | ✅ 完整，rollback revision 未接 |

### BuildRuntime × 实际作用

| Runtime | 影响的代码 | 当前作用 |
|---|---|---|
| `node` | `stage-templates.ts:30-31` 日志模板分支、`tekton.go:104` `nodeImage` 选 `node:20-alpine` | 仅切换 builder 基础镜像 + 日志文案 |
| `go` | 同上，日志改为 `go mod download` / `go build -o bin/application` | 同上 |
| `generic` | fallback | 走默认 node 镜像 |

> **缺口：** 没有 `java / python / rust / dotnet / android-sdk / xcode` 选项；runtime 既不驱动真 builder image 切换（Tekton 还是 node-only），也不驱动 builder 引擎切换（永远 `docker build`）。

### Registry × Provider × 自定义开口

| Provider | 默认值 | 自定义开口 |
|---|---|---|
| `aliyun-acr` | crpi-…cn-hangzhou.personal.cr.aliyuncs.com / company_sy | ✅ 已用 |
| `harbor` | harbor.example.com | preset，可改 |
| `docker-hub` | docker.io | preset，可改 |
| `tencent-tcr` | ccr.ccs.tencentyun.com | preset，可改 |
| `aws-ecr` | 000…dkr.ecr.ap-east-1.amazonaws.com | preset，可改 |
| `custom` | registry.example.com | ✅ escape hatch（用户填一切） |

**Registry 维度已经做得不错** — 6 个 preset + 1 个 `custom`，DTO 校验有上下界，imageRef 拼装 + tag 渲染稳定。本文不再扩展 Registry。

### 已开放给用户的「半自定义」字段

| 字段 | 类型 | 文件 |
|---|---|---|
| `dockerfilePath` | string | `registry/index.ts:27` |
| `contextPath` | string | `registry/index.ts:28` |
| `tagTemplate` | `${run.id}-${commit.short}` 模板 | `registry/index.ts:22` |
| `packageBuildScript` | npm script 名 | `platform/index.ts:113` |
| `packageOutputPaths` | string[] | `platform/index.ts:114` |
| `serviceConnections[]` | string[] 凭据引用 | `platform/index.ts:88` |
| `variables[]` + `runtimeVariables[]` | `GlobalParam[]`，含 `injectionTiming: build|runtime|deploy` | `platform/index.ts:24,96` |

**结论：** 当前架构对"在已有 builder 框架内换个 Dockerfile / 换个脚本 / 换个 registry"已经足够灵活；真正缺的是 **换 builder 引擎本身** 和 **多目标产物** 与 **自带完整 Pipeline**。

---

## 1. 三维问题分解

把"不同系统的打包 + 自定义打包"拆成正交三维，每维独立设计、独立演进，互不绑死。

### 维度 A — 目标系统扩展（Target Systems）

新增 PackageMode 的真实业务场景：

| 候选 PackageMode | 典型产物 | 典型 builder | 典型 rollout |
|---|---|---|---|
| `android_apk` | `app-release.apk` / `app-release.aab` | gradle + Android SDK | Firebase App Distribution / Google Play Console |
| `ios_ipa` | `App.ipa` | xcodebuild + fastlane | TestFlight / App Store Connect |
| `desktop_installer` | `.exe` / `.dmg` / `.deb` / `.rpm` / `.AppImage` | electron-builder / tauri / pkg | 自更新服务 / 内部分发 |
| `native_binary` | linux/amd64+arm64、windows/amd64 多产物 | go build / cargo / dotnet publish | scp + systemd / 仓库分发 |
| `lambda_zip` | `function.zip` | esbuild + zip | aws lambda update-function-code |
| `cloud_function` | layered zip | gcloud functions / fc-cli | 阿里函数计算 / GCP Cloud Functions |
| `jvm_jar` | `app-1.0.0.jar` / `app.war` | maven / gradle | jar 分发 / tomcat |
| `python_wheel` | `pkg-1.0-py3-none-any.whl` | build / setuptools | pypi / 内部 index |
| `npm_package` | tarball | `npm pack` | npm publish / verdaccio |
| `oci_artifact`（非 image）| helm chart oci / wasm / policy bundle | `oras push` | OCI registry |

**架构原则：** 不要一次全加。**只在真有业务时才扩**。每加一个，必须同时给出 (builder 命令模板 + rollout policy + UI 表单)。

### 维度 B — Builder 引擎多样化（Build Engines）

即便 `packageMode=container_image`，构建引擎也有多选择：

| Engine | 优势 | 何时用 | 当前差距 |
|---|---|---|---|
| `docker` | 默认；最通用 | 本地 + Tekton DinD | ✅ 已用 |
| `kaniko` | 无 daemon，run-as-non-root | 多租户 k8s，避免 DinD 特权 | 缺：Tekton task 模板未含 kaniko 选项 |
| `buildkit` | 缓存最好，rootless 可选 | 大型 monorepo，重复构建 | 缺：未集成 |
| `jib` | Java 无 Dockerfile，从 maven/gradle 直接 push | JVM 项目 | 缺：未支持 |
| `ko` | Go 无 Dockerfile，从代码直接 build | Go 项目 | 缺：未支持 |
| `buildpacks`（CNB） | 无 Dockerfile，按语言自动检测 | 多语言、约定大于配置 | 缺：未支持 |
| `bazel` | 远端缓存 + 增量 | 巨型 monorepo | 缺：未支持，且复杂度高 |
| `custom-script` | 用户自己写 shell | escape hatch | 缺：当前 `packageBuildScript` 仅是 npm script 名，不是完整 shell |

**架构原则：** Builder engine 应该和 PackageMode 解耦。同样产 container image，可以用 docker 或 kaniko；同样产 jar，可以用 maven 或 gradle 或 bazel。

### 维度 C — 自定义打包（Custom Packaging）

按"用户介入深度"分三档：

| 档位 | 用户配什么 | 平台做什么 | 当前支持 |
|---|---|---|---|
| **Tweak** | 改 `dockerfilePath / contextPath / buildArgs / packageBuildScript` | 平台用默认 builder 框架执行 | ✅ 80% 已有，缺 buildArgs |
| **BringYourOwnBuilder** | 指定一个 builder 镜像 + 进入容器后的命令 | 平台拉镜像 + 执行命令 + 收集产物路径 | ❌ 完全缺失 |
| **BringYourOwnPipeline** | 提交一份完整 Tekton Pipeline YAML（或 TaskRef） | 平台只负责提交、监听、收集事件 | ❌ Tekton bridge 写死 5 task |

**架构原则：** 这三档对应 80/15/5 的用户分布。一档要做得"开箱即用"，二档要做得"可控可审计"，三档要做得"够 escape，但有边界（namespace 隔离）"。

---

## 2. PackagePlugin 契约（核心抽象）

把 `PACKAGE_MODES` 从字面量枚举升级为**注册中心 + 插件契约**。这是后续所有扩展的支点。

### 2.1 契约形态

```ts
// packages/shared/src/packaging/plugin.ts （新文件，规划中）

import type { LifecycleStageKey, PipelineDefinition, PipelineRun } from "../platform";

export type PackagePluginId =
  // 内置 5 个（向后兼容旧 PACKAGE_MODES）
  | "container_image" | "static_site" | "server_package" | "kubernetes_manifest" | "helm_chart"
  // 新增（按需开启，逐个 land）
  | "android_apk" | "ios_ipa" | "desktop_installer" | "native_binary"
  | "lambda_zip" | "jvm_jar" | "python_wheel" | "npm_package" | "oci_artifact"
  // escape hatch
  | "custom";

export interface BuildSpec {
  runtime?: string;                // node / go / java / python / rust / dotnet / android / xcode / generic
  builderEngine?: BuilderEngineId; // docker / kaniko / buildkit / jib / ko / buildpacks / custom-script
  buildArgs?: Record<string, string>;
  targets?: BuildTarget[];         // multi OS×Arch；空数组 = 单产物
  customScript?: string;           // BringYourOwnBuilder 档：进入 builder 镜像后执行的 shell
  customPipelineRef?: string;      // BringYourOwnPipeline 档：Tekton PipelineRef 名
}

export interface BuildTarget {
  os: "linux" | "darwin" | "windows" | "android" | "ios";
  arch: "amd64" | "arm64" | "armv7" | "universal";
  tags?: string[];                 // build tags / 条件编译
}

export interface BuildOutput {
  artifactType: PackagePluginId;
  files: Array<{ path: string; sha256: string; sizeBytes: number; mediaType?: string }>;
  metadata: Record<string, string>; // jvm: { mainClass }, android: { applicationId, versionCode }, etc.
}

export interface RolloutAdapter {
  /** 给定一份 BuildOutput，渲染该 plugin 的 rollout step 列表 */
  planSteps(input: { output: BuildOutput; definition: PipelineDefinition; run: PipelineRun }): RolloutStep[];
  /** 执行单个 step；状态机由调用方维护 */
  executeStep(input: { step: RolloutStep; output: BuildOutput }): Promise<RolloutStepResult>;
}

export interface PackagePluginSpec {
  id: PackagePluginId;
  label: string;                       // UI 显示名
  defaultStages: LifecycleStageKey[];  // 该 plugin 推荐的 stage 顺序
  validate(definition: PipelineDefinition): ValidationIssue[]; // 配置缺失/冲突早期发现
  describeBuild(spec: BuildSpec): { commands: string[]; expectedOutputs: string[] }; // UI 预览用
  rolloutAdapter: RolloutAdapter;
}

export const PACKAGE_PLUGIN_REGISTRY = new Map<PackagePluginId, PackagePluginSpec>();

export function registerPackagePlugin(spec: PackagePluginSpec): void {
  PACKAGE_PLUGIN_REGISTRY.set(spec.id, spec);
}
```

### 2.2 与现有 `PACKAGE_MODES` 的向后兼容

**不删旧枚举。** 改造路径：

```ts
// 旧（保留）
export const PACKAGE_MODES = ["container_image", "static_site", "server_package", "kubernetes_manifest", "helm_chart"] as const;
export type PackageMode = (typeof PACKAGE_MODES)[number];

// 新（追加，超集）
export type PackagePluginId = PackageMode | "android_apk" | "ios_ipa" | ... | "custom";
```

旧 `RolloutStrategyConfig` tagged union 也保留；新 plugin 的 rollout 通过 `PackagePluginSpec.rolloutAdapter` 注入，**不挤进旧 union**。这样：
- 旧 5 类继续走 `release/index.ts` 的 union；
- 新 plugin 走注册中心；
- 一旦新 plugin 稳定到所有调用方都用 adapter 模式，旧 union 可以一次性折叠到 adapter 里。

### 2.3 注册时机

- **静态注册**（推荐）：每个 plugin 在自己的模块 `import` 时调用 `registerPackagePlugin(...)`，类似 Vue plugin 机制。无运行时下载，无动态加载攻击面。
- **不要做**：远端 plugin manifest / npm 动态 install / WASM sandbox plugin。YAGNI，且引入巨大安全面。

---

## 3. BuilderEngine 端口

### 3.1 契约形态

```ts
// packages/shared/src/packaging/builder.ts （新文件，规划中）

export type BuilderEngineId =
  | "docker" | "kaniko" | "buildkit"
  | "jib" | "ko" | "buildpacks"
  | "bazel" | "custom-script";

export interface BuilderEngineSpec {
  id: BuilderEngineId;
  label: string;
  supports: PackagePluginId[];             // 这个 engine 能产哪些 plugin 的产物
  requiredCapabilities: Capability[];      // 例如 dind / privileged / buildkit-daemon
  defaultImage: string;                    // 用作 builder 的容器镜像
  renderBuildCommand(input: {
    spec: BuildSpec;
    definition: PipelineDefinition;
    run: PipelineRun;
  }): { command: string; args: string[]; workdir: string };
}

type Capability = "dind" | "buildkit-daemon" | "privileged" | "android-sdk" | "xcode";

export const BUILDER_ENGINE_REGISTRY = new Map<BuilderEngineId, BuilderEngineSpec>();
```

### 3.2 端到端选择优先级

```
用户在 UI 选 packageMode (plugin) 
  → 加载 PackagePluginSpec
  → UI 列出 spec.supportedEngines 给用户选 builder
  → 用户填 BuildSpec
  → ExecutorAdapter (simulated|local-docker|tekton)
  → 通过 builderEngine.renderBuildCommand() 渲染真命令
  → 执行
```

**关键：ExecutorAdapter 和 BuilderEngine 完全正交**。Executor 决定"在哪运行（本地 docker / k8s tekton）"，Engine 决定"用哪个工具构建（docker/kaniko/jib）"。

### 3.3 与 Tekton bridge 的对齐

`services/tekton-bridge/internal/backend/tekton.go` 当前用 env 写死 `pipelineRef / stageImage / nodeImage / dockerCli / dockerDind`（`tekton.go:101-106`）。

改造方案：

- **小改：** 增加 `kanikoImage / buildkitImage / jibImage / koImage / buildpacksImage` env，bridge 接 `BuildSpec.builderEngine` 后切 task spec 内的 image 字段。
- **中改：** `StartRunInput` 增加 `builderEngine + builderImage + builderCommand` 字段，bridge 根据这三个动态拼 Tekton Step。
- **大改：** 接受 `customPipelineRef`，bridge 不再渲染 Pipeline，直接 `kubectl create PipelineRun --ref=$customPipelineRef --param=...`。

三档对应三个 sprint 包（见第 6 章）。

---

## 4. TargetMatrix 模型（多产物）

单次 run 产多个产物的场景：

- Go 服务一次构 `linux/amd64 + linux/arm64`
- Electron 一次构 `darwin-x64 + darwin-arm64 + win32-x64 + linux-x64`
- Android 一次构 `arm64-v8a + x86_64` ABI

### 4.1 数据模型

```ts
// 已在 BuildSpec.targets[] 定义
export interface BuildTarget {
  os: "linux" | "darwin" | "windows" | "android" | "ios";
  arch: "amd64" | "arm64" | "armv7" | "universal";
  tags?: string[];
}

// PipelineRun 增加多产物收集
export interface PipelineRun {
  // ... 原字段
  buildOutputs?: BuildOutput[];   // 每个 target 一条
}
```

### 4.2 Tekton 落地方案

利用 Tekton **`matrix`** 字段（Tekton v0.43+ 原生支持）：

```yaml
# 由 bridge 生成（不需要用户写）
spec:
  pipelineSpec:
    tasks:
      - name: build
        matrix:
          params:
            - name: os
              value: ["linux", "darwin", "windows"]
            - name: arch
              value: ["amd64", "arm64"]
        taskRef:
          name: build-binary
        params:
          - name: os
            value: "$(matrix.os)"
          - name: arch
            value: "$(matrix.arch)"
```

bridge 把 `BuildTarget[]` 翻译为 `matrix.params`，Tekton 自动起 N 个并行 TaskRun。

### 4.3 收集与展示

- bridge 在 `Events()` channel 上推每个 matrix instance 的 `RunEvent`，前端 UI 按 `os/arch` 维度聚合
- `BuildOutput[]` 写入 `PipelineRun.buildOutputs`，制品中心按 OS/Arch tab 展示

---

## 5. 自定义打包三档配置（用户视角）

### 档 1 — Tweak（80% 用户）

UI 表单（已有大部分字段，缺 `buildArgs`）：

```
PackageMode: [container_image ▼]
Builder Engine: [docker ▼]
─────────────────────────────
Dockerfile path: [./Dockerfile      ]
Build context:   [.                 ]
Build args:      [+ NODE_VERSION=20 ]  ← 新增
                 [+ SERVICE_NAME=api]
Target platforms:[+ linux/amd64    ]  ← 新增（默认 1 个）
                 [+ linux/arm64    ]
Package script:  [build             ]
Output paths:    [.next, dist       ]
```

**改动：**
- DTO：`buildConfigSchema` 增加 `buildArgs: Record<string,string>` + `targets: BuildTarget[]`
- Executor：`local-docker.executor.ts` 把 `buildArgs` 翻译成 `--build-arg KEY=VALUE` flags；`targets` 用 `docker buildx build --platform=linux/amd64,linux/arm64`
- UI：`pipeline-config-editor` 增加两个面板

### 档 2 — BringYourOwnBuilder（15% 用户）

UI 表单：

```
PackageMode: [custom ▼]
Builder Image: [my-registry/builder-jvm-21:latest     ]  ← 新增
Working dir:   [/workspace                            ]  ← 新增
Build script:  [./gradlew clean assemble              ]  ← 新增（多行 shell）
Output glob:   [build/libs/*.jar                      ]  ← 新增
Service connection (for builder pull): [acr-pull ▼   ]
```

**改动：**
- shared：`BuildSpec.customScript` + `BuildSpec.customBuilderImage` + `BuildSpec.outputGlob`
- DTO：新 schema `customBuildSchema`
- Executor (local-docker)：`docker run --rm -v $PWD:/workspace -w /workspace $builderImage sh -c "$customScript"` + `find $outputGlob`
- Executor (tekton)：bridge 增加 `custom-script` Task，inputs 为 builder image / shell / working dir
- 安全：必须强制 `serviceConnection` 校验（只能拉用户已授权的 registry）；shell 限制 timeout + 内存 quota

### 档 3 — BringYourOwnPipeline（5% 用户）

UI 表单：

```
PackageMode: [custom ▼]
Mode: [Tekton PipelineRef ▼]
Pipeline Ref:    [my-team-jvm-pipeline    ]  ← 新增
Pipeline params: [+ KEY=VAL ...           ]
Workspaces:      [+ source: my-pvc        ]
Service Account: [my-team-sa              ]
```

**改动：**
- shared：`BuildSpec.customPipelineRef` + `BuildSpec.customParams` + `BuildSpec.customWorkspaces`
- bridge (`tekton.go`)：新分支：当 `customPipelineRef` 非空时，不渲染内置 Pipeline，直接构造 PipelineRun 引用用户的 PipelineRef
- bridge 启动时校验 PipelineRef 在白名单 namespace 内（多租户隔离）
- 平台只负责：提交 PipelineRun、监听 events、收集 results → BuildOutput
- 安全：必须做 namespace 隔离 + Service Account 限制 + 资源 quota；不允许用户 Pipeline 跨 namespace 调度

---

## 6. 安全边界

引入「自定义」必然引入「任意代码执行」。三类 control 必须早期就位：

### 6.1 隔离（Isolation）

| Layer | 措施 |
|---|---|
| Process | local-docker executor 已用 `spawn` + 子进程；要加 `--cap-drop ALL --read-only --tmpfs /tmp` |
| Filesystem | Build context 限定 `runDir/source/`；产物 glob 不允许绝对路径或 `..` |
| Network | Tekton 模式下用 NetworkPolicy 阻止 build pod 访问内部服务（只允许 registry + git） |
| Namespace（k8s）| 每 application 一个独立 namespace；自定义 Pipeline 只能引用同 namespace 内的 ref |

### 6.2 配额（Quotas）

| 维度 | 默认值 | 来源 |
|---|---|---|
| CPU | 2 core | per-build pod limit |
| Memory | 4 GiB | per-build pod limit |
| Wall clock | 30 min | bridge 主动 cancel |
| Disk | 10 GiB ephemeral | emptyDir sizeLimit |
| 并发 | 5 个 build / namespace | ResourceQuota |

### 6.3 白名单（Allowlist）

| 对象 | 白名单来源 |
|---|---|
| Builder image | `service_connections` 表里登记的 registry + 平台默认 builders 列表 |
| Custom PipelineRef | 平台管理员预先 apply 到目标 namespace 的 Pipeline CRD 列表 |
| Network egress | NetworkPolicy 允许的 CIDR / DNS（git provider + registry + npm/maven 镜像） |
| Secret 引用 | 只允许引用同 namespace 内已存在的 secret name |

### 6.4 审计（Audit）

每次 build 必须落事件：
- `build.spec.snapshot`（PackagePluginId + BuilderEngine + customScript hash + buildArgs hash）
- `build.image.pulled`（builder image digest）
- `build.output.materialized`（每个产物 sha256）
- `build.exit`（exit code + duration + resource used）

这些都已有 `audit` 模块基础设施（`apps/api/src/audit/`），只需要扩字段。

---

## 7. 三档落地路径（Sprint 包提案）

按"最小可用 → 标准 → 完整插件化"分级。

### Sprint S — buildArgs + 多 target（最小可用，~1-1.5 天）

**目标：** 不动 PackageMode 枚举，只在现有 `container_image` 基础上加 `buildArgs` + `targets[]`，UI 给到 80% 用户最缺的两项。

**改动：**
- `packages/shared/src/platform/index.ts`：`PipelineBuildConfig` 加 `buildArgs?: Record<string,string>` + `targets?: BuildTarget[]`
- `packages/shared/src/packaging/build-target.ts`（新）：`BuildTarget` 类型定义
- `apps/api/src/pipelines/dto/create-pipeline.dto.ts`：`buildConfigSchema` 扩两个字段
- `apps/api/src/executors/local-docker.executor.ts`：
  - 单 target → `docker build --build-arg ...`
  - 多 target → `docker buildx build --platform=...`
- `services/tekton-bridge/internal/backend/tekton.go`：build task 模板支持 `BUILD_ARGS / TARGET_PLATFORMS` 参数
- `apps/web/app/ui/pipeline-config/build-panel.tsx`（新）：两面板表单 + 验证
- 测试：vitest 加 `buildArgs.spec.ts` + `targets.spec.ts`（10 cases）

**收益：** 解决 80% "我们 Go 项目需要 amd64+arm64" / "我们 Node 项目需要传 `NODE_VERSION` build-arg" 的痛点。
**风险：** 极低。完全在现有架构内。

---

### Sprint M — BuilderEngine 切换 + Tweak 完整化（~3-4 天）

**目标：** 落地 BuilderEngine 端口，至少支持 `docker` + `kaniko` + `buildkit` 三选一。

**改动：**
- `packages/shared/src/packaging/builder.ts`（新）：`BuilderEngineId / BuilderEngineSpec / BUILDER_ENGINE_REGISTRY`
- `packages/shared/src/packaging/engines/`（新目录）：
  - `docker.ts`：现有逻辑包装
  - `kaniko.ts`：渲染 `/kaniko/executor --context=$ctx --dockerfile=$df --destination=$image`
  - `buildkit.ts`：渲染 `buildctl build --frontend=dockerfile.v0 ...`
- `apps/api/src/executors/local-docker.executor.ts`：用 `BuilderEngineSpec.renderBuildCommand()` 代替硬编码
- `services/tekton-bridge/internal/backend/tekton.go`：新增 `kanikoImage / buildkitImage` env + 切 task spec
- DTO：`buildConfigSchema` 增加 `builderEngine: BuilderEngineId`
- UI：build-panel 增加 builder engine 选择 + 各 engine 的差异化配置项
- 测试：每 engine 一个 spec，验证 renderBuildCommand 产出正确

**收益：** 多租户 k8s 可以用 kaniko 避开 DinD 特权；大型 monorepo 可以用 buildkit 提升缓存命中。
**风险：** 中。Tekton bridge 需要改 task 模板；UI 表单复杂度增加。

---

### Sprint L — PackagePlugin 注册中心 + 自定义档 2/3（~6-8 天）

**目标：** 把 PackageMode 升级为可注册插件；落地 BringYourOwnBuilder + BringYourOwnPipeline 两档。

**改动：**
- `packages/shared/src/packaging/plugin.ts`（新）：`PackagePluginSpec / PACKAGE_PLUGIN_REGISTRY`
- `packages/shared/src/packaging/plugins/`（新目录）：把现有 5 个 PackageMode 重构为 5 个 `PackagePluginSpec`（adapter 包装旧 rollout policy，不删旧 union）
- `apps/api/src/packaging/` 新模块：注册中心初始化 + 校验
- `services/tekton-bridge/internal/backend/tekton.go`：
  - 接受 `customPipelineRef + customParams + customWorkspaces`
  - 启动时拉 namespace 白名单 + Service Account 白名单
  - 落 NetworkPolicy / ResourceQuota
- UI：`pipeline-config/custom-build-panel.tsx`（新）：Tweak / BringYourOwnBuilder / BringYourOwnPipeline 三档切换
- 安全：实现 §6.1-6.4 的隔离 / 配额 / 白名单 / 审计
- 文档：`docs/architecture/packaging-plugin.md` 写完整开发者指南
- 测试：每档配置 + 安全边界 e2e

**收益：** 完整支持企业级"我有自己的 builder pipeline 想跑在你的平台上"诉求；为后续 `android_apk / ios_ipa / jvm_jar` 等新 plugin 留出干净的扩展面。
**风险：** 高。涉及 k8s 安全配置、namespace 多租户隔离、Tekton ref/sa 白名单，第一次落地要格外仔细。

---

## 8. 推荐顺序

```
现在 → Sprint S（buildArgs + 多 target）
       ↓
       真实业务需要换 builder（多租户/monorepo 缓存）→ Sprint M
       ↓
       真实业务需要自带 builder image 或自带 Pipeline → Sprint L
```

**不要预先做 Sprint M/L**。S 已经覆盖 80% 真实需求；M 和 L 在没有具体业务诉求前是 YAGNI。

**判断信号：**
- 听到"我们需要构 arm64" / "我们需要传 build-arg" → S
- 听到"我们用 kaniko 因为 DinD 不让用" / "我们用 jib 因为 Java 项目" → M
- 听到"我们有自己的 Jenkins Pipeline 想搬过来" / "我们的构建用了 5 个自定义 step" → L

---

## 9. 与已有 sprint 的关系

| 已有 sprint | 关系 |
|---|---|
| `2026-05-15-package-mode-rollout.md` | **rollout** 端的多样化已落地，本文聚焦 **build/package** 端，不重复 |
| `2026-05-15-cicd-optimization-analysis.md` | T1-T8 是工程债，本文是能力扩展；两者正交 |
| `2026-05-15-cicd-optimization-sprint-1.md` | T8 vitest 基线已铺好，本文 Sprint S 的测试可以直接复用 vitest 框架 |

---

## 10. 最终决策清单

- [x] 不一次性引入完整 plugin 系统（YAGNI）
- [x] 现有 `PACKAGE_MODES` 枚举保留，新插件走注册中心，两者通过 adapter 桥接
- [x] BuilderEngine 与 PackageMode 解耦（同 image 可多 engine，同 engine 可多 mode）
- [x] 自定义打包分三档：Tweak / BringYourOwnBuilder / BringYourOwnPipeline，对应 80/15/5 用户
- [x] 安全边界（隔离 / 配额 / 白名单 / 审计）必须从 Sprint M 开始就纳入设计，不能延后
- [x] 推荐起步：**Sprint S（buildArgs + 多 target）**，1-1.5 天，零风险
