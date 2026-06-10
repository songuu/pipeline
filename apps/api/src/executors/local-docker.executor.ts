import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Injectable, Logger } from "@nestjs/common";
import {
  DEFAULT_PIPELINE_BUILD_CONFIG,
  PACKAGE_UPLOAD_PROVIDERS,
  resolvePackageBuildCommandMode,
  resolvePackageUploadCommandMode,
  toYunxiaoJobStatus,
  type JobStatus,
  type LifecycleStageKey,
  type RunEvent,
  type RunHandle,
  type RunStatus,
  type PackageUploadProvider,
  type StageInstance,
  type StartRunInput,
} from "@deploy-management/shared";
import { ExecutorAdapter } from "../lifecycle/executor-adapter";
import { STAGE_DURATIONS } from "./stage-templates";

type LocalDockerRecord = {
  input: StartRunInput;
  runDir: string;
  sourceDir: string;
  stages: StageInstance[];
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  canceled: boolean;
  events: RunEvent[];
};

type CommandOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  redact?: string[];
  timeoutMs?: number;
  record?: LocalDockerRecord;
  stageKey?: string;
  label?: string;
  onOutput?: (chunk: string, output: string) => void;
};

type CommandSpec = {
  executable: string;
  args: string[];
  display: string;
};

type StartupError = Error & {
  commandStartupFailure?: true;
};

const EXECUTOR_PARAM_KEYS = new Set([
  "ENVIRONMENT",
  "CANARY_PERCENT",
  "COMMIT",
  "REF_TYPE",
  "REF_NAME",
  "REGISTRY_PROVIDER",
  "IMAGE_REGISTRY",
  "IMAGE_REPOSITORY",
  "IMAGE_NAME",
  "IMAGE_NAMESPACE",
  "IMAGE_TAG",
  "IMAGE_REF",
  "DOCKERFILE_PATH",
  "BUILD_CONTEXT",
  "BUILD_RUNTIME",
  "REGISTRY_SERVICE_CONNECTION",
  "REGISTRY_USERNAME",
  "REGISTRY_DOCKER_SECRET",
  "PACKAGE_MODE",
  "PACKAGE_BUILD_COMMAND_MODE",
  "PACKAGE_BUILD_SCRIPT",
  "PACKAGE_BUILD_COMMAND",
  "PACKAGE_OUTPUT_PATHS",
  "PACKAGE_UPLOAD_PROVIDER",
  "PACKAGE_UPLOAD_COMMAND_MODE",
  "PACKAGE_UPLOAD_ENDPOINT",
  "PACKAGE_UPLOAD_PUBLIC_BASE_URL",
  "PACKAGE_UPLOAD_ACCESS_DOMAIN",
  "PACKAGE_UPLOAD_TARGET_PATH",
  "PACKAGE_UPLOAD_SERVICE_CONNECTION",
  "PACKAGE_UPLOAD_COMMAND",
  "DOCKER_BUILD_ARGS",
  "SUPABASE_DB_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

@Injectable()
export class LocalDockerExecutor implements ExecutorAdapter {
  readonly backend: RunHandle["backend"] = "local-docker";

  private readonly logger = new Logger(LocalDockerExecutor.name);
  private readonly records = new Map<string, LocalDockerRecord>();
  private readonly workRoot = path.resolve(process.env.LOCAL_DOCKER_WORKDIR ?? path.join(process.cwd(), ".codex-tmp", "local-docker-runs"));
  private readonly retainedRunDirs = localDockerRetainedRunDirs();

  async start(input: StartRunInput): Promise<RunHandle> {
    const runDir = path.join(this.workRoot, sanitizePathSegment(input.pipelineRunId));
    const record: LocalDockerRecord = {
      input,
      runDir,
      sourceDir: path.join(runDir, "source"),
      stages: input.stages.map((stage, index) => createStage(stage, index)),
      status: "RUNNING",
      startedAt: new Date().toISOString(),
      canceled: false,
      events: [],
    };
    this.records.set(input.pipelineRunId, record);
    void this.execute(record).catch((error) => {
      this.logger.error(`local docker run ${input.pipelineRunId} failed: ${describe(error)}`);
      this.failCurrentStage(record, describe(error));
    });
    return { runId: input.pipelineRunId, backend: this.backend };
  }

  async status(handle: RunHandle): Promise<RunStatus> {
    const record = this.requireRecord(handle.runId);
    return {
      runId: handle.runId,
      status: record.status,
      stages: record.stages,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
    };
  }

  async cancel(handle: RunHandle): Promise<void> {
    const record = this.records.get(handle.runId);
    if (!record) return;
    record.canceled = true;
    record.status = "CANCELED";
    record.finishedAt = new Date().toISOString();
    record.stages = record.stages.map((stage) =>
      ["INIT", "QUEUED", "RUNNING"].includes(stage.status)
        ? { ...stage, status: "CANCELED", jobs: stage.jobs.map((job) => ({ ...job, status: "CANCELED", finishedAt: record.finishedAt })) }
        : stage,
    );
    this.pushEvent(record, "status", { status: "CANCELED" });
  }

  async *events(handle: RunHandle): AsyncIterable<RunEvent> {
    const record = this.requireRecord(handle.runId);
    let cursor = 0;
    while (true) {
      while (cursor < record.events.length) {
        yield record.events[cursor++];
      }
      if (record.finishedAt || record.canceled || ["SUCCESS", "FAIL", "CANCELED"].includes(record.status)) {
        return;
      }
      await delay(160);
    }
  }

  private async execute(record: LocalDockerRecord): Promise<void> {
    try {
      await rm(record.runDir, { force: true, recursive: true });
      await mkdir(record.runDir, { recursive: true });

      for (const stage of record.stages) {
        if (record.canceled) return;
        await this.runStage(record, stage);
        if (record.status === "FAIL") return;
      }

      record.status = "SUCCESS";
      record.finishedAt = new Date().toISOString();
      this.pushEvent(record, "status", { status: "SUCCESS" });
    } finally {
      await this.pruneOldRunDirs(record.runDir);
    }
  }

  private async runStage(record: LocalDockerRecord, stage: StageInstance): Promise<void> {
    this.markStageRunning(record, stage);
    const started = Date.now();
    try {
      this.pushEvent(record, "log", {
        stageKey: stage.name,
        message: `进入 ${stage.name} 阶段，开始执行真实命令。`,
      });
      const result =
        stage.name === "source"
          ? await this.checkoutSource(record)
          : stage.name === "test"
            ? await this.runOptionalTest(record)
            : stage.name === "build"
              ? await this.packageBuild(record)
              : stage.name === "upload"
                ? await this.uploadArtifact(record)
                : await this.runControlPlaneStage(record, stage.name as LifecycleStageKey);

      const skipped = result["skipped"] === "true";
      this.markStageFinished(record, stage, skipped ? "SKIPPED" : "SUCCESS", Date.now() - started, result);
    } catch (error) {
      this.markStageFinished(record, stage, "FAIL", Date.now() - started, { error: describe(error) });
      record.status = "FAIL";
      record.finishedAt = new Date().toISOString();
      this.pushEvent(record, "status", { status: "FAIL", error: describe(error) });
    }
  }

  private async checkoutSource(record: LocalDockerRecord): Promise<Record<string, string>> {
    const source = record.input.sources[0];
    if (!source?.endpoint) {
      throw new Error("local-docker source stage requires a git-url");
    }
    const revision = source.branch || source.tag || "main";
    await mkdir(record.runDir, { recursive: true });
    try {
      await this.runCommand("git", ["clone", "--depth", String(source.cloneDepth ?? 1), "--branch", revision, source.endpoint, record.sourceDir], {
        cwd: record.runDir,
        record,
        stageKey: "source",
        label: "克隆指定分支",
      });
    } catch {
      await this.runCommand("git", ["clone", "--depth", String(source.cloneDepth ?? 1), source.endpoint, record.sourceDir], {
        cwd: record.runDir,
        record,
        stageKey: "source",
        label: "克隆默认分支",
      });
      await this.runCommand("git", ["checkout", revision], {
        cwd: record.sourceDir,
        record,
        stageKey: "source",
        label: "切换 Revision",
      });
    }
    const commit = await this.runCommand("git", ["rev-parse", "HEAD"], {
      cwd: record.sourceDir,
      record,
      stageKey: "source",
      label: "解析提交 SHA",
    });
    return { commit: commit.trim(), revision };
  }

  private async runOptionalTest(record: LocalDockerRecord): Promise<Record<string, string>> {
    const contextDir = this.buildContextDir(record);
    const runtime = await this.detectBuildRuntime(record, contextDir);
    if (runtime === "go") {
      if (!(await exists(path.join(contextDir, "go.mod")))) {
        throw new Error(`go.mod does not exist in build context: ${contextDir}`);
      }
      await this.runCommand("go", ["test", "./..."], {
        cwd: contextDir,
        record,
        stageKey: "test",
        label: "执行 Go 单元测试",
      });
      return { runtime, script: "go test ./..." };
    }
    const packageJson = await this.readPackageJson(contextDir);
    if (!packageJson.scripts?.test) {
      return { skipped: "true", reason: "package.json has no test script" };
    }
    await this.installDependencies(contextDir, record, "test");
    await this.runPackageManagerScript(contextDir, "test", record, "test", envForStage(record.input, "test"));
    return { script: "test" };
  }

  private async packageBuild(record: LocalDockerRecord): Promise<Record<string, string>> {
    const contextDir = this.buildContextDir(record);
    const script = globalParamValue(record.input, "PACKAGE_BUILD_SCRIPT") || "build";
    const configuredCommand = globalParamValue(record.input, "PACKAGE_BUILD_COMMAND").trim();
    const configuredCommandMode = normalizeBuildCommandModeParam(globalParamValue(record.input, "PACKAGE_BUILD_COMMAND_MODE"));
    const command = resolvePackageBuildCommandMode({
      packageBuildCommandMode: configuredCommandMode,
      packageBuildCommand: configuredCommand,
    }) === "custom"
      ? configuredCommand
      : "";
    const configuredOutputPaths = splitList(globalParamValue(record.input, "PACKAGE_OUTPUT_PATHS"));
    const outputPaths = configuredOutputPaths.length > 0 ? configuredOutputPaths : DEFAULT_PIPELINE_BUILD_CONFIG.packageOutputPaths;
    const runtime = await this.detectBuildRuntime(record, contextDir);
    const buildEnv = runtime === "node" || runtime === "generic"
      ? withLocalDockerBuildMemoryLimit(envForStage(record.input, "build"))
      : envForStage(record.input, "build");
    if (runtime === "generic") {
      if (!command) {
        throw new Error("generic build runtime requires PACKAGE_BUILD_COMMAND");
      }
      await this.runCommandLine(command, {
        cwd: contextDir,
        record,
        stageKey: "build",
        label: "执行通用自定义打包命令",
        env: buildEnv,
        redact: redactValuesFromEnv(buildEnv),
      });
      return await this.archiveBuildOutputs(record, contextDir, outputPaths, runtime);
    }
    if (runtime === "go") {
      if (!(await exists(path.join(contextDir, "go.mod")))) {
        throw new Error(`go.mod does not exist in build context: ${contextDir}`);
      }
      await mkdir(path.join(contextDir, "bin"), { recursive: true });
      await this.runCommand("go", ["mod", "download"], {
        cwd: contextDir,
        record,
        stageKey: "build",
        label: "下载 Go 依赖",
        env: buildEnv,
      });
      if (command) {
        await this.runCommandLine(command, {
          cwd: contextDir,
          record,
          stageKey: "build",
          label: "执行自定义 Go 打包命令",
          env: buildEnv,
          redact: redactValuesFromEnv(buildEnv),
        });
      } else {
        await this.runCommand("go", ["build", "-o", "bin/application", "."], {
          cwd: contextDir,
          record,
          stageKey: "build",
          label: "执行 Go 构建",
          env: buildEnv,
        });
      }
      return await this.archiveBuildOutputs(record, contextDir, outputPaths, runtime);
    }
    const packageJson = await this.readPackageJson(contextDir);
    if (!command && !packageJson.scripts?.[script]) {
      throw new Error(`package.json scripts.${script} does not exist`);
    }

    await this.installDependencies(contextDir, record, "build");
    if (command) {
      await this.runCommandLine(command, {
        cwd: contextDir,
        record,
        stageKey: "build",
        label: "执行自定义打包命令",
        env: buildEnv,
        redact: redactValuesFromEnv(buildEnv),
      });
    } else {
      await this.runPackageManagerScript(contextDir, script, record, "build", buildEnv);
    }

    return await this.archiveBuildOutputs(record, contextDir, outputPaths, runtime);
  }

  private async archiveBuildOutputs(
    record: LocalDockerRecord,
    contextDir: string,
    outputPaths: string[],
    runtime: string,
  ): Promise<Record<string, string>> {
    const existingOutputs: string[] = [];
    for (const outputPath of outputPaths) {
      const absolute = safeJoin(contextDir, outputPath);
      if (await exists(absolute)) {
        existingOutputs.push(outputPath);
      }
    }
    if (existingOutputs.length === 0) {
      throw new Error(`build succeeded but no configured output path exists under ${contextDir}: ${outputPaths.join(", ")}`);
    }

    const artifactPath = path.join(record.runDir, `${sanitizePathSegment(record.input.pipelineRunId)}.tar.gz`);
    await this.runCommand("tar", ["-czf", artifactPath, ...existingOutputs], {
      cwd: contextDir,
      record,
      stageKey: "build",
      label: "打包构建产物",
    });
    const packageDigest = await sha256File(artifactPath);
    return {
      runtime,
      "package-path": artifactPath,
      "package-digest": `sha256:${packageDigest}`,
      "package-outputs": existingOutputs.join(","),
    };
  }

  private async uploadArtifact(record: LocalDockerRecord): Promise<Record<string, string>> {
    const packageMode = globalParamValue(record.input, "PACKAGE_MODE") || "container_image";
    if (packageMode === "container_image") {
      return this.dockerBuildAndPush(record);
    }
    return this.uploadPackageArtifact(record, packageMode);
  }

  private async dockerBuildAndPush(record: LocalDockerRecord): Promise<Record<string, string>> {
    const imageRef = globalParamValue(record.input, "IMAGE_REF");
    if (!imageRef) throw new Error("IMAGE_REF is required for local-docker upload");
    const registry = globalParamValue(record.input, "IMAGE_REGISTRY") || registryFromImageRef(imageRef);
    const dockerfile = safeJoin(this.buildContextDir(record), globalParamValue(record.input, "DOCKERFILE_PATH") || "Dockerfile");
    const contextDir = this.buildContextDir(record);
    if (!(await exists(dockerfile))) {
      throw new Error(`Dockerfile does not exist: ${dockerfile}`);
    }

    await this.assertDockerAvailable(record);
    await this.dockerLoginIfNeeded(record, registry);
    const buildArgs = dockerBuildArgsFrom(record.input);
    await this.runCommand("docker", ["build", ...buildArgs.args, "-f", dockerfile, "-t", imageRef, contextDir], {
      cwd: contextDir,
      record,
      stageKey: "upload",
      label: "构建 OCI 镜像",
      redact: buildArgs.redact,
    });
    const pushOutput = await this.runCommand("docker", ["push", imageRef], {
      cwd: contextDir,
      record,
      stageKey: "upload",
      label: "推送镜像到仓库",
    });
    const digest = parseImageDigest(pushOutput) ?? await this.inspectPushedImageDigest(imageRef, contextDir, record);
    if (!digest) {
      throw new Error("docker push completed but no registry digest was returned or inspectable");
    }
    return { "image-digest": digest, "image-ref": imageRef, "docker-pull": `docker pull ${imageRef}`, imageRef };
  }

  private async uploadPackageArtifact(record: LocalDockerRecord, packageMode: string): Promise<Record<string, string>> {
    const packagePath = stageResult(record, "build", "package-path");
    const packageDigest = stageResult(record, "build", "package-digest");
    if (!packagePath || !(await exists(packagePath))) {
      throw new Error("package upload requires a build package artifact; run build before upload");
    }
    const provider = normalizePackageUploadProvider(globalParamValue(record.input, "PACKAGE_UPLOAD_PROVIDER"));
    const endpoint = globalParamValue(record.input, "PACKAGE_UPLOAD_ENDPOINT") || process.env.PACKAGE_UPLOAD_ROOT || ".codex-tmp/package-uploads";
    const targetPath = sanitizeRelativePath(globalParamValue(record.input, "PACKAGE_UPLOAD_TARGET_PATH") || `${record.input.applicationId}/${record.input.pipelineRunId}/${path.basename(packagePath)}`);
    const mirrorRoot = packageUploadMirrorRoot(endpoint);
    const destination = safeJoin(mirrorRoot, targetPath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(packagePath, destination);

    const packageUri = packageUriFrom(endpoint, targetPath, destination);
    const publicUrl = packagePublicUrl(record.input, endpoint, targetPath, destination);
    const configuredCommand = globalParamValue(record.input, "PACKAGE_UPLOAD_COMMAND").trim();
    const configuredCommandMode = normalizeUploadCommandModeParam(globalParamValue(record.input, "PACKAGE_UPLOAD_COMMAND_MODE"));
    const command = resolvePackageUploadCommandMode({
      provider,
      customUploadCommandMode: configuredCommandMode,
      customUploadCommand: configuredCommand,
    }) === "custom"
      ? configuredCommand
      : "";
    const uploadEnv = {
      ...envForStage(record.input, "upload"),
      PACKAGE_MODE: packageMode,
      PACKAGE_UPLOAD_PROVIDER: provider,
      PACKAGE_UPLOAD_ENDPOINT: endpoint,
      PACKAGE_UPLOAD_TARGET_PATH: targetPath,
      PACKAGE_ARCHIVE_PATH: packagePath,
      PACKAGE_MIRROR_PATH: destination,
      PACKAGE_DIGEST: packageDigest,
      PACKAGE_URI: packageUri,
      PACKAGE_PUBLIC_URL: publicUrl,
    };
    if (command) {
      await this.runCommandLine(command, {
        cwd: record.sourceDir,
        record,
        stageKey: "upload",
        label: "执行自定义包上传命令",
        env: uploadEnv,
        redact: redactValuesFromEnv(uploadEnv),
      });
    }
    return {
      "package-mode": packageMode,
      "package-path": packagePath,
      "package-digest": packageDigest,
      "package-uri": packageUri,
      "package-public-url": publicUrl,
      "package-storage-provider": provider,
    };
  }

  private async runControlPlaneStage(record: LocalDockerRecord, stageKey: LifecycleStageKey): Promise<Record<string, string>> {
    const commandId = `${stageKey}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const { command, label, output } = controlPlaneCommandForStage(stageKey, record.input);
    const startedAt = new Date().toISOString();
    this.pushEvent(record, "command", {
      commandId,
      stageKey,
      label,
      cwd: record.runDir,
      command,
      status: "running",
      startedAt,
      attempt: 1,
    });
    this.pushEvent(record, "command", {
      commandId,
      stageKey,
      label,
      cwd: record.runDir,
      command,
      status: "success",
      startedAt,
      finishedAt: new Date().toISOString(),
      attempt: 1,
      output,
    });
    return { summary: label };
  }

  private async assertDockerAvailable(record: LocalDockerRecord): Promise<void> {
    try {
      await this.runCommand("docker", ["version", "--format", "{{.Server.Version}}"], {
        cwd: record.runDir,
        record,
        stageKey: "upload",
        label: "检查 Docker daemon",
      });
    } catch (error) {
      throw new Error(`Docker daemon 不可用，无法执行真实镜像构建和上传：${describe(error)}`);
    }
  }

  private async inspectPushedImageDigest(imageRef: string, contextDir: string, record?: LocalDockerRecord): Promise<string | undefined> {
    try {
      const output = await this.runCommand("docker", ["image", "inspect", "--format={{index .RepoDigests 0}}", imageRef], {
        cwd: contextDir,
        record,
        stageKey: "upload",
        label: "读取镜像 digest",
      });
      return parseImageDigest(output);
    } catch {
      return undefined;
    }
  }

  private async dockerLoginIfNeeded(record: LocalDockerRecord, registry: string): Promise<void> {
    const provider = globalParamValue(record.input, "REGISTRY_PROVIDER");
    const username = firstNonEmpty(globalParamValue(record.input, "REGISTRY_USERNAME"), process.env.ACR_USERNAME, process.env.ALIYUN_ACR_USERNAME, process.env.REGISTRY_USERNAME);
    const password = firstNonEmpty(process.env.ACR_PASSWORD, process.env.ALIYUN_ACR_PASSWORD, process.env.REGISTRY_PASSWORD, process.env.DOCKER_PASSWORD);
    const needsLogin = provider === "aliyun-acr" || Boolean(username || password);
    if (!needsLogin) return;
    if (!registry) throw new Error("IMAGE_REGISTRY is required for docker login");
    if (!username) throw new Error("ACR username is missing: set REGISTRY_USERNAME, ACR_USERNAME, or ALIYUN_ACR_USERNAME");
    if (!password) throw new Error("ACR password is missing: set ACR_PASSWORD, ALIYUN_ACR_PASSWORD, REGISTRY_PASSWORD, or DOCKER_PASSWORD");
    await this.runCommand("docker", ["login", "--username", username, "--password-stdin", registry], {
      cwd: record.runDir,
      input: password,
      redact: [password],
      record,
      stageKey: "upload",
      label: "登录镜像仓库",
    });
  }

  private async installDependencies(contextDir: string, record: LocalDockerRecord, stageKey: LifecycleStageKey): Promise<void> {
    if (await exists(path.join(contextDir, "pnpm-lock.yaml"))) {
      // pnpm 10+ blocks dependency build scripts (e.g. sharp) by default and exits
      // non-zero with ERR_PNPM_IGNORED_BUILDS. A build executor already runs the
      // repo's own (untrusted) build, so allowing dependency build scripts is
      // consistent with the threat model and required to install native deps.
      await this.runCommand("pnpm", ["install", "--frozen-lockfile", "--config.dangerouslyAllowAllBuilds=true"], {
        cwd: contextDir,
        record,
        stageKey,
        label: "安装依赖 pnpm",
      });
      return;
    }
    if (await exists(path.join(contextDir, "package-lock.json"))) {
      await this.runCommand("npm", ["ci"], {
        cwd: contextDir,
        record,
        stageKey,
        label: "安装依赖 npm ci",
      });
      return;
    }
    if (await exists(path.join(contextDir, "yarn.lock"))) {
      await this.runCommand("yarn", ["install", "--frozen-lockfile"], {
        cwd: contextDir,
        record,
        stageKey,
        label: "安装依赖 yarn",
      });
      return;
    }
    await this.runCommand("npm", ["install"], {
      cwd: contextDir,
      record,
      stageKey,
      label: "安装依赖 npm install",
    });
  }

  private async runPackageManagerScript(
    contextDir: string,
    script: string,
    record: LocalDockerRecord,
    stageKey: LifecycleStageKey,
    env?: NodeJS.ProcessEnv,
  ): Promise<void> {
    if (await exists(path.join(contextDir, "pnpm-lock.yaml"))) {
      await this.runCommand("pnpm", ["run", script], {
        cwd: contextDir,
        record,
        stageKey,
        label: `执行 package.json scripts.${script}`,
        env,
        redact: redactValuesFromEnv(env),
      });
      return;
    }
    if (await exists(path.join(contextDir, "yarn.lock"))) {
      await this.runCommand("yarn", ["run", script], {
        cwd: contextDir,
        record,
        stageKey,
        label: `执行 package.json scripts.${script}`,
        env,
        redact: redactValuesFromEnv(env),
      });
      return;
    }
    await this.runCommand("npm", ["run", script], {
      cwd: contextDir,
      record,
      stageKey,
      label: `执行 package.json scripts.${script}`,
      env,
      redact: redactValuesFromEnv(env),
    });
  }

  private async readPackageJson(contextDir: string): Promise<{ scripts?: Record<string, string> }> {
    const packageJsonPath = path.join(contextDir, "package.json");
    if (!(await exists(packageJsonPath))) {
      throw new Error(`package.json does not exist in build context: ${contextDir}`);
    }
    return JSON.parse(await readFile(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
  }

  private buildContextDir(record: LocalDockerRecord): string {
    return safeJoin(record.sourceDir, globalParamValue(record.input, "BUILD_CONTEXT") || ".");
  }

  private async detectBuildRuntime(record: LocalDockerRecord, contextDir: string): Promise<"node" | "go" | "generic"> {
    const configured = globalParamValue(record.input, "BUILD_RUNTIME").trim().toLowerCase();
    if (configured === "go") return "go";
    if (configured === "node") return "node";
    if (configured === "generic") return "generic";
    if (await exists(path.join(contextDir, "go.mod"))) return "go";
    return "node";
  }

  private async runCommand(command: string, args: string[], options: CommandOptions): Promise<string> {
    const specs = resolveCommandSpecs(command, args);
    let lastStartupError: Error | undefined;
    const commandBaseId = `${options.stageKey ?? "command"}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    for (const [index, spec] of specs.entries()) {
      const commandId = `${commandBaseId}-${index + 1}`;
      const startedAt = new Date().toISOString();
      this.pushCommandEvent(options, commandId, spec, "running", { startedAt, attempt: index + 1 });
      try {
        const output = await spawnCommand(spec, {
          ...options,
          onOutput: (chunk, accumulatedOutput) => {
            this.pushCommandEvent(options, commandId, spec, "running", {
              startedAt,
              attempt: index + 1,
              streamed: true,
              outputChunk: tail(chunk),
              output: tail(accumulatedOutput),
            });
          },
        });
        this.pushCommandEvent(options, commandId, spec, "success", {
          startedAt,
          finishedAt: new Date().toISOString(),
          attempt: index + 1,
          output: tail(output),
        });
        return output;
      } catch (error) {
        this.pushCommandEvent(options, commandId, spec, "failed", {
          startedAt,
          finishedAt: new Date().toISOString(),
          attempt: index + 1,
          error: describe(error),
        });
        if (isStartupError(error) && specs.length > 1) {
          lastStartupError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastStartupError ?? new Error(`failed to start command "${command} ${args.join(" ")}" in ${options.cwd}`);
  }

  private async runCommandLine(commandLine: string, options: CommandOptions): Promise<string> {
    const spec = shellSpec(commandLine);
    return this.runCommand(spec.executable, spec.args, {
      ...options,
      label: options.label,
    });
  }

  private pushCommandEvent(
    options: CommandOptions,
    commandId: string,
    spec: CommandSpec,
    status: "running" | "success" | "failed",
    details: Record<string, unknown>,
  ): void {
    if (!options.record) return;
    this.pushEvent(options.record, "command", {
      commandId,
      stageKey: options.stageKey,
      label: options.label,
      cwd: options.cwd,
      command: redact(spec.display, options.redact),
      status,
      ...redactCommandDetails(details, options.redact),
    });
  }

  private markStageRunning(record: LocalDockerRecord, stage: StageInstance): void {
    const startedAt = new Date().toISOString();
    stage.status = "RUNNING";
    stage.jobs = stage.jobs.map((job) => ({ ...job, status: "RUNNING", startedAt }));
    this.pushEvent(record, "stage", { stageKey: stage.name, status: "RUNNING" });
  }

  private markStageFinished(record: LocalDockerRecord, stage: StageInstance, status: JobStatus, durationMs: number, result: Record<string, string>): void {
    const finishedAt = new Date().toISOString();
    stage.status = status;
    stage.jobs = stage.jobs.map((job) => ({
      ...job,
      status,
      finishedAt,
      durationMs,
      result,
      steps: job.steps.map((step) => ({ ...step, status })),
    }));
    this.pushEvent(record, "stage", { stageKey: stage.name, status, result });
  }

  private failCurrentStage(record: LocalDockerRecord, error: string): void {
    const current = record.stages.find((stage) => stage.status === "RUNNING") ?? record.stages.find((stage) => stage.status === "INIT");
    if (current) {
      this.markStageFinished(record, current, "FAIL", STAGE_DURATIONS[current.name as LifecycleStageKey] ?? 1_000, { error });
    }
    record.status = "FAIL";
    record.finishedAt = new Date().toISOString();
    this.pushEvent(record, "status", { status: "FAIL", error });
  }

  private pushEvent(record: LocalDockerRecord, type: RunEvent["type"], payload: Record<string, unknown>): void {
    record.events.push({
      runId: record.input.pipelineRunId,
      type,
      timestamp: new Date().toISOString(),
      payload,
    });
  }

  private requireRecord(runId: string): LocalDockerRecord {
    const record = this.records.get(runId);
    if (!record) throw new Error(`local-docker run ${runId} not found`);
    return record;
  }

  private async pruneOldRunDirs(currentRunDir: string): Promise<void> {
    let entries: Array<{ isDirectory(): boolean; name: string }>;
    try {
      entries = await readdir(this.workRoot, { withFileTypes: true });
    } catch {
      return;
    }
    const candidates: LocalDockerRunDirEntry[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const runDir = path.join(this.workRoot, entry.name);
      try {
        const stats = await stat(runDir);
        if (stats.isDirectory()) {
          candidates.push({ path: runDir, mtimeMs: stats.mtimeMs });
        }
      } catch {
        // Directory disappeared during cleanup; another executor tick can handle it later.
      }
    }
    for (const runDir of localDockerRunDirsToPrune(candidates, this.retainedRunDirs, currentRunDir)) {
      try {
        await rm(runDir, { force: true, recursive: true });
      } catch (error) {
        this.logger.warn(`local docker run dir cleanup failed for ${runDir}: ${describe(error)}`);
      }
    }
  }
}

export type LocalDockerRunDirEntry = {
  path: string;
  mtimeMs: number;
};

export function localDockerRunDirsToPrune(
  entries: LocalDockerRunDirEntry[],
  retainedRunDirs: number,
  currentRunDir?: string,
): string[] {
  const normalizedRetainedRunDirs = Math.max(1, Math.trunc(retainedRunDirs));
  const normalizedCurrentRunDir = currentRunDir ? path.resolve(currentRunDir) : undefined;
  const retainedNonCurrent = normalizedCurrentRunDir ? normalizedRetainedRunDirs - 1 : normalizedRetainedRunDirs;
  return entries
    .map((entry) => ({ ...entry, path: path.resolve(entry.path) }))
    .filter((entry) => entry.path !== normalizedCurrentRunDir)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(Math.max(0, retainedNonCurrent))
    .map((entry) => entry.path);
}

export function withLocalDockerBuildMemoryLimit(
  buildEnv: NodeJS.ProcessEnv,
  runtimeEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nodeOptions = buildEnv.NODE_OPTIONS ?? runtimeEnv.NODE_OPTIONS ?? "";
  if (/(^|\s)--max-old-space-size=\d+(\s|$)/.test(nodeOptions)) {
    return { ...buildEnv, ...(nodeOptions ? { NODE_OPTIONS: nodeOptions } : {}) };
  }
  return {
    ...buildEnv,
    NODE_OPTIONS: [nodeOptions.trim(), `--max-old-space-size=${localDockerNodeMaxOldSpaceMb(runtimeEnv)}`]
      .filter(Boolean)
      .join(" "),
  };
}

function spawnCommand(spec: CommandSpec, options: CommandOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.executable, spec.args, { cwd: options.cwd, env: { ...process.env, ...options.env }, shell: false, windowsHide: true });
    let output = "";
    let settled = false;
    const display = redact(spec.display, options.redact);
    const timeoutMs = options.timeoutMs ?? localDockerCommandTimeoutMs();
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill();
      settle(() => reject(new Error(`${display} timed out after ${timeoutMs}ms`)));
    }, timeoutMs);
    const collect = (chunk: Buffer): void => {
      const text = chunk.toString();
      output += text;
      options.onOutput?.(redact(text, options.redact), redact(output, options.redact));
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      settle(() => reject(startupError(`failed to start command "${display}" in ${options.cwd}: ${describe(error)}`)));
    });
    child.on("close", (code) => {
      const redacted = redact(output, options.redact);
      if (code === 0) {
        settle(() => resolve(redacted));
        return;
      }
      settle(() => reject(new Error(`${display} exited with ${code}: ${tail(redacted)}`)));
    });
    if (options.input) {
      child.stdin.end(options.input.endsWith("\n") ? options.input : `${options.input}\n`);
    }
  });
}

function localDockerCommandTimeoutMs(): number {
  const configured = Number(process.env.LOCAL_DOCKER_COMMAND_TIMEOUT_MS);
  if (Number.isInteger(configured) && configured >= 10_000) return configured;
  return 15 * 60 * 1_000;
}

function localDockerRetainedRunDirs(): number {
  const configured = Number(process.env.LOCAL_DOCKER_RETAINED_RUN_DIRS);
  if (Number.isInteger(configured) && configured >= 1) return configured;
  return 2;
}

function localDockerNodeMaxOldSpaceMb(runtimeEnv: NodeJS.ProcessEnv): number {
  const configured = Number(runtimeEnv.LOCAL_DOCKER_NODE_MAX_OLD_SPACE_MB);
  if (Number.isInteger(configured) && configured >= 256) return configured;
  return 1024;
}

function resolveCommandSpecs(command: string, args: string[]): CommandSpec[] {
  if (process.platform !== "win32") {
    return [plainSpec(command, args)];
  }

  if (command === "npm") {
    const npmCliPath = findNpmCliPath();
    return [
      ...(npmCliPath ? [plainSpec(process.execPath, [npmCliPath, ...args], `node ${quoteDisplay(npmCliPath)} ${args.map(quoteDisplay).join(" ")}`)] : []),
      cmdSpec(command, args),
    ];
  }

  if (["pnpm", "yarn", "npx"].includes(command)) {
    return [cmdSpec(command, args)];
  }

  if (command === "docker") {
    const dockerCliPaths = findDockerCliPaths();
    return [...dockerCliPaths.map((executable) => plainSpec(executable, args)), plainSpec(command, args)];
  }

  return [plainSpec(command, args)];
}

function shellSpec(commandLine: string): CommandSpec {
  if (process.platform === "win32") {
    const executable = process.env.ComSpec?.trim() || "cmd.exe";
    return {
      executable,
      args: ["/d", "/s", "/c", commandLine],
      display: `${quoteDisplay(executable)} /d /s /c ${commandLine}`,
    };
  }
  return {
    executable: "/bin/sh",
    args: ["-lc", commandLine],
    display: `/bin/sh -lc ${quoteDisplay(commandLine)}`,
  };
}

function plainSpec(executable: string, args: string[], display = `${quoteDisplay(executable)} ${args.map(quoteDisplay).join(" ")}`.trim()): CommandSpec {
  return { executable, args, display };
}

function cmdSpec(command: string, args: string[]): CommandSpec {
  const commandLine = [command, ...args].map(quoteCmdArg).join(" ");
  const executable = process.env.ComSpec?.trim() || "cmd.exe";
  return {
    executable,
    args: ["/d", "/s", "/c", commandLine],
    display: `${quoteDisplay(executable)} /d /s /c ${commandLine}`,
  };
}

function findNpmCliPath(): string | undefined {
  const candidates = [
    process.env.NPM_CLI_JS,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

function findDockerCliPaths(): string[] {
  const candidates = [
    process.env.DOCKER_CLI_PATH,
    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker",
  ];
  return Array.from(new Set(candidates.filter((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))));
}

function quoteDisplay(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

function quoteCmdArg(value: string): string {
  if (/^[a-zA-Z0-9_./:=\\-]+$/.test(value)) return value;
  return `"${value.replace(/(["^&|<>%])/g, "^$1")}"`;
}

function startupError(message: string): StartupError {
  const error = new Error(message) as StartupError;
  error.commandStartupFailure = true;
  return error;
}

function isStartupError(error: unknown): error is StartupError {
  return error instanceof Error && (error as StartupError).commandStartupFailure === true;
}

function createStage(stage: LifecycleStageKey, index: number): StageInstance {
  return {
    index,
    name: stage,
    status: toYunxiaoJobStatus("pending"),
    jobs: [
      {
        id: `${stage}-job`,
        name: stage,
        taskRef: stage,
        status: toYunxiaoJobStatus("pending"),
        steps: [{ id: `${stage}-step`, name: stage, status: toYunxiaoJobStatus("pending") }],
      },
    ],
  };
}

function globalParamValue(input: StartRunInput, key: string): string {
  return input.globalParams.find((param) => param.key === key)?.value ?? "";
}

function normalizeBuildCommandModeParam(value: string): "script" | "custom" | undefined {
  return value === "script" || value === "custom" ? value : undefined;
}

function normalizeUploadCommandModeParam(value: string): "provider" | "custom" | undefined {
  return value === "provider" || value === "custom" ? value : undefined;
}

function normalizePackageUploadProvider(value: string): PackageUploadProvider {
  return PACKAGE_UPLOAD_PROVIDERS.includes(value as PackageUploadProvider)
    ? (value as PackageUploadProvider)
    : "local-filesystem";
}

function envForStage(input: StartRunInput, stageKey: LifecycleStageKey): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const param of input.globalParams) {
    const key = param.key.trim();
    if (!key || key.startsWith("runtime.") || EXECUTOR_PARAM_KEYS.has(key) || !isEnvironmentVariableName(key)) {
      continue;
    }
    if (shouldInjectParamIntoStage(param, stageKey)) {
      env[key] = param.value;
    }
  }
  for (const param of input.globalParams) {
    const key = param.key.trim();
    if (!key.startsWith("runtime.")) continue;
    const runtimeKey = key.slice("runtime.".length);
    if (isEnvironmentVariableName(runtimeKey) && shouldInjectParamIntoStage(param, stageKey)) {
      env[runtimeKey] = param.value;
    }
  }
  return env;
}

function shouldInjectParamIntoStage(param: StartRunInput["globalParams"][number], stageKey: LifecycleStageKey): boolean {
  if (param.targetStages?.includes(stageKey)) return true;
  if (param.injectionTiming === "build") return stageKey === "test" || stageKey === "build" || stageKey === "package";
  if (param.injectionTiming === "deploy") return stageKey === "deploy" || stageKey === "canary" || stageKey === "promote";
  if (param.injectionTiming === "runtime") return stageKey === "deploy" || stageKey === "canary" || stageKey === "approval" || stageKey === "promote";
  return stageKey === "build" || stageKey === "test";
}

function isEnvironmentVariableName(value: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(value);
}

function redactValuesFromEnv(env: NodeJS.ProcessEnv | undefined): string[] {
  if (!env) return [];
  return Object.entries(env)
    .filter(([key, value]) => /SECRET|TOKEN|PASSWORD|KEY/i.test(key) && Boolean(value) && String(value).length > 3)
    .map(([, value]) => String(value));
}

function stageResult(record: LocalDockerRecord, stageKey: LifecycleStageKey, key: string): string {
  const stage = record.stages.find((item) => item.name === stageKey);
  return stage?.jobs[0]?.result?.[key] ?? "";
}

function packageUploadMirrorRoot(endpoint: string): string {
  const configuredRoot = process.env.PACKAGE_UPLOAD_ROOT;
  if (configuredRoot?.trim()) return path.resolve(configuredRoot);
  if (endpoint.startsWith("file://")) {
    return path.resolve(endpoint.replace(/^file:\/+/i, ""));
  }
  if (isLocalPath(endpoint)) {
    return path.resolve(endpoint);
  }
  return path.resolve(process.cwd(), ".codex-tmp", "package-uploads");
}

function packageUriFrom(endpoint: string, targetPath: string, destination: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed || isLocalPath(trimmed) || trimmed.startsWith("file://")) {
    return pathToFileURL(destination).toString();
  }
  return joinUrlLike(trimmed, targetPath);
}

function packagePublicUrl(input: StartRunInput, endpoint: string, targetPath: string, destination: string): string {
  const publicBase = firstNonEmpty(
    globalParamValue(input, "PACKAGE_UPLOAD_PUBLIC_BASE_URL"),
    globalParamValue(input, "PACKAGE_UPLOAD_ACCESS_DOMAIN"),
  );
  if (publicBase) return joinUrlLike(publicBase, targetPath);
  if (/^https?:\/\//i.test(endpoint)) return joinUrlLike(endpoint, targetPath);
  return pathToFileURL(destination).toString();
}

function isLocalPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith(".") || value.startsWith("/") || value.startsWith("\\");
}

function sanitizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new Error(`package upload target path escapes upload root: ${value}`);
  }
  return parts.join("/") || "package.tar.gz";
}

function joinUrlLike(base: string, relativePath: string): string {
  return `${base.replace(/\/+$/g, "")}/${relativePath.replace(/^\/+/g, "")}`;
}

function controlPlaneCommandForStage(
  stageKey: LifecycleStageKey,
  input: StartRunInput,
): { label: string; command: string; output: string } {
  if (stageKey === "env") {
    const variables = input.globalParams.filter((param) => param.value && (!EXECUTOR_PARAM_KEYS.has(param.key) || param.key.startsWith("runtime.")));
    return {
      label: "注入环境变量",
      command: variables.length > 0
        ? variables.map((param) => `${param.key}=${redactControlPlaneValue(param.key, param.value)}`).join("\n")
        : "echo \"no environment variables configured\"",
      output: `${variables.length} 个变量已准备进入构建/运行/部署上下文`,
    };
  }

  if (stageKey === "package") {
    return {
      label: "登记构建产物元数据",
      command: [
        "collect package digest",
        "record package artifact",
        "prepare SBOM / provenance metadata",
      ].join("\n"),
      output: "产物元数据将写入 Artifacts / Results / Chains 面板",
    };
  }

  if (stageKey === "deploy" || stageKey === "canary" || stageKey === "promote") {
    const imageRef = globalParamValue(input, "IMAGE_REF") || "<IMAGE_REF>";
    return {
      label: stageKey === "canary" ? "执行灰度发布动作" : stageKey === "promote" ? "执行全量上线动作" : "执行部署动作",
      command: [
        `release target: ${input.environment}`,
        `image: ${imageRef}`,
        `canary percent: ${input.canaryPercent}`,
        "handoff to release manager / Kubernetes executor",
      ].join("\n"),
      output: "上线动作由发布管理模块按包类型接管；缺少目标配置时会在发布阶段显式失败",
    };
  }

  if (stageKey === "approval") {
    return {
      label: "等待人工审批",
      command: `wait approval gate for ${input.pipelineName}`,
      output: input.requiresApproval ? "已进入人工审批门禁" : "当前流水线未启用审批，自动继续",
    };
  }

  return {
    label: "控制面动作",
    command: `control-plane stage ${stageKey}`,
    output: "阶段由控制面完成，没有外部命令可执行",
  };
}

function redactControlPlaneValue(key: string, value: string): string {
  return /SECRET|TOKEN|PASSWORD|KEY/i.test(key) && value ? "***" : value;
}

function splitList(value: string): string[] {
  return Array.from(new Set(value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)));
}

function dockerBuildArgsFrom(input: StartRunInput): { args: string[]; redact: string[] } {
  const buildArgs = new Map<string, string>();
  for (const entry of splitList(globalParamValue(input, "DOCKER_BUILD_ARGS"))) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1);
    if (isDockerBuildArgName(key)) {
      buildArgs.set(key, value);
    }
  }

  for (const [envKey, value] of Object.entries(process.env)) {
    if (!envKey.startsWith("DOCKER_BUILD_ARG_") || value === undefined) continue;
    const key = envKey.slice("DOCKER_BUILD_ARG_".length);
    if (isDockerBuildArgName(key)) {
      buildArgs.set(key, value);
    }
  }

  for (const param of input.globalParams) {
    const key = param.key.trim();
    if (!isPipelineDockerBuildArg(param) || buildArgs.has(key)) continue;
    buildArgs.set(key, param.value);
  }

  const redactValues = Array.from(buildArgs.entries())
    .filter(([key, value]) => /SECRET|TOKEN|PASSWORD|KEY|URL/i.test(key) && value.length > 3)
    .map(([, value]) => value);
  return {
    args: Array.from(buildArgs.entries()).flatMap(([key, value]) => ["--build-arg", `${key}=${value}`]),
    redact: redactValues,
  };
}

function isPipelineDockerBuildArg(param: StartRunInput["globalParams"][number]): boolean {
  const key = param.key.trim();
  if (!isDockerBuildArgName(key) || key.startsWith("runtime.") || EXECUTOR_PARAM_KEYS.has(key)) return false;
  return param.injectionTiming === "build" || key.startsWith("NEXT_PUBLIC_") || isPublicSupabaseBuildKey(key);
}

function isDockerBuildArgName(value: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(value);
}

function isPublicSupabaseBuildKey(value: string): boolean {
  return value === "SUPABASE_URL" || value === "SUPABASE_ANON_KEY" || value === "SUPABASE_PUBLISHABLE_KEY";
}

function parseImageDigest(output: string): string | undefined {
  return output.match(/(?:digest:\s*|@)(sha256:[a-f0-9]{64})/i)?.[1];
}

function registryFromImageRef(imageRef: string): string {
  const parts = imageRef.trim().split("/");
  return parts.length > 1 ? parts[0] : "";
}

function safeJoin(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`path escapes build workspace: ${relativePath}`);
  }
  return resolved;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

function sanitizePathSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "run";
}

function redact(value: string, secrets: string[] | undefined): string {
  return (secrets ?? []).filter(Boolean).reduce((text, secret) => text.split(secret).join("***"), value);
}

function redactCommandDetails(details: Record<string, unknown>, secrets: string[] | undefined): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      typeof value === "string" ? redact(value, secrets) : value,
    ]),
  );
}

function tail(value: string): string {
  return value.slice(-4_000);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
