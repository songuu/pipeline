"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelinesService = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@deploy-management/shared");
const applications_service_1 = require("../applications/applications.service");
const code_repos_service_1 = require("../code-repos/code-repos.service");
const ids_1 = require("../common/ids");
const pipelines_repository_1 = require("./pipelines.repository");
let PipelinesService = class PipelinesService {
    repo;
    applications;
    codeRepos;
    constructor(repo, applications, codeRepos) {
        this.repo = repo;
        this.applications = applications;
        this.codeRepos = codeRepos;
    }
    list() {
        return this.repo.snapshot();
    }
    get(id) {
        const pipeline = this.repo.snapshot().find((item) => item.id === id);
        if (!pipeline) {
            throw new common_1.NotFoundException(`Pipeline ${id} not found`);
        }
        return pipeline;
    }
    async create(request) {
        const application = this.findApplication(request.applicationId) ?? createDraftApplication(request);
        const realRepository = this.findRepository(request.repositoryId);
        const repository = realRepository ?? createDraftRepository(request, request.repositoryUrl);
        if (realRepository) {
            this.codeRepos.assertReference(realRepository, request.refType, request.refName);
        }
        const sourcePolicy = normalizeSourcePolicy(request.sourcePolicy, repository.defaultBranch);
        assertRefAllowedByPolicy(request.refType, request.refName, sourcePolicy);
        const buildConfig = normalizeBuildConfig(request.buildConfig);
        const imageArtifact = buildConfig.packageMode === "container_image"
            ? normalizeImageArtifact(request.imageArtifact, application.id, repository.name, request.serviceConnections?.[1])
            : undefined;
        const stages = this.normalizeStages((0, shared_1.ensureRegistryUploadStage)(request.stages, imageArtifact));
        const pipeline = {
            id: (0, ids_1.createStableId)("pipe"),
            name: request.name.trim() || `${application.id}-${request.targetEnvironment}-release`,
            applicationId: application.id,
            repositoryId: repository.id,
            repository: request.repositoryUrl?.trim() || repository.url,
            defaultBranch: request.refType === "branch" ? request.refName : repository.defaultBranch,
            defaultRefType: request.refType,
            defaultRef: request.refName,
            sourcePolicy,
            targetEnvironment: request.targetEnvironment,
            strategy: request.strategy,
            canaryPercent: request.canaryPercent,
            requiresApproval: request.requiresApproval,
            stages,
            triggers: request.triggers.length > 0 ? request.triggers : ["manual"],
            owner: request.owner.trim() || application.owner,
            variables: request.variables ?? defaultVariables(request.targetEnvironment),
            runtimeVariables: request.runtimeVariables ?? [],
            caches: request.caches ?? defaultCaches(repository.name),
            serviceConnections: request.serviceConnections ?? defaultServiceConnections(repository.provider),
            buildConfig,
            imageArtifact,
        };
        await this.repo.prepend(pipeline);
        return pipeline;
    }
    async update(id, request) {
        const current = this.get(id);
        const repositoryId = request.repositoryId ?? current.repositoryId;
        const realRepository = this.findRepository(repositoryId);
        const repository = realRepository ?? createDraftRepositoryFromPipeline(current, repositoryId, request);
        const refType = request.refType ?? current.defaultRefType;
        const refName = request.refName ??
            (repositoryId === current.repositoryId
                ? current.defaultRef
                : refType === "branch"
                    ? repository.defaultBranch
                    : repository.tags[0]);
        if (!refName) {
            throw new common_1.NotFoundException(`Repository ${repository.id} has no default ${refType}`);
        }
        if (realRepository) {
            this.codeRepos.assertReference(realRepository, refType, refName);
        }
        const sourcePolicy = normalizeSourcePolicy(request.sourcePolicy ?? current.sourcePolicy, repository.defaultBranch);
        assertRefAllowedByPolicy(refType, refName, sourcePolicy);
        const buildConfig = normalizeBuildConfig(request.buildConfig ?? current.buildConfig);
        const imageArtifact = buildConfig.packageMode === "container_image"
            ? normalizeImageArtifact(request.imageArtifact ?? current.imageArtifact, current.applicationId, repository.name, request.serviceConnections?.[1] ?? current.serviceConnections?.[1])
            : undefined;
        const patch = {
            name: request.name?.trim() || current.name,
            repositoryId: repository.id,
            repository: request.repositoryUrl?.trim() || repository.url || current.repository,
            defaultRefType: refType,
            defaultRef: refName,
            defaultBranch: refType === "branch" ? refName : repository.defaultBranch,
            sourcePolicy,
            targetEnvironment: request.targetEnvironment ?? current.targetEnvironment,
            strategy: request.strategy ?? current.strategy,
            canaryPercent: request.canaryPercent ?? current.canaryPercent,
            requiresApproval: request.requiresApproval ?? current.requiresApproval,
            stages: this.normalizeStages((0, shared_1.ensureRegistryUploadStage)(request.stages ?? current.stages, imageArtifact)),
            triggers: request.triggers ? normalizeTriggers(request.triggers) : current.triggers,
            owner: request.owner?.trim() || current.owner,
            variables: request.variables ?? current.variables ?? defaultVariables(current.targetEnvironment),
            runtimeVariables: request.runtimeVariables ?? current.runtimeVariables ?? [],
            caches: request.caches ?? current.caches ?? defaultCaches(repository.name),
            serviceConnections: request.serviceConnections ?? current.serviceConnections ?? defaultServiceConnections(repository.provider),
            buildConfig,
            imageArtifact,
        };
        return this.repo.update(id, patch);
    }
    async delete(id) {
        this.get(id);
        await this.repo.delete(id);
        return { id };
    }
    normalizeStages(stages) {
        const allKeys = new Set(shared_1.LIFECYCLE_STAGES.map((stage) => stage.key));
        const configured = stages.length > 0 ? stages : shared_1.LIFECYCLE_STAGES.map((stage) => stage.key);
        const deduped = configured.filter((stage, index) => allKeys.has(stage) && configured.indexOf(stage) === index);
        const withSource = deduped.includes("source") ? deduped : ["source", ...deduped];
        const needsEnv = withSource.some((stage) => ["package", "upload", "deploy", "canary", "promote"].includes(stage));
        if (!needsEnv || withSource.includes("env"))
            return withSource;
        const buildIndex = withSource.indexOf("build");
        const insertAt = buildIndex >= 0 ? buildIndex + 1 : Math.min(2, withSource.length);
        return [...withSource.slice(0, insertAt), "env", ...withSource.slice(insertAt)];
    }
    findApplication(id) {
        return this.applications.list().find((application) => application.id === id);
    }
    findRepository(id) {
        return this.codeRepos.list().find((repository) => repository.id === id);
    }
};
exports.PipelinesService = PipelinesService;
exports.PipelinesService = PipelinesService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(pipelines_repository_1.PipelinesRepository)),
    __param(1, (0, common_1.Inject)(applications_service_1.ApplicationsService)),
    __param(2, (0, common_1.Inject)(code_repos_service_1.CodeReposService)),
    __metadata("design:paramtypes", [pipelines_repository_1.PipelinesRepository,
        applications_service_1.ApplicationsService,
        code_repos_service_1.CodeReposService])
], PipelinesService);
function createDraftApplication(request) {
    return {
        id: request.applicationId,
        name: request.applicationId,
        owner: request.owner.trim() || "未配置",
        repositoryId: request.repositoryId,
        repository: request.repositoryUrl?.trim() || "",
        defaultBranch: "main",
        language: "Node.js",
        serviceType: "web",
        environments: [request.targetEnvironment],
    };
}
function createDraftRepository(request, repositoryUrl) {
    const url = repositoryUrl?.trim() || request.repositoryUrl?.trim() || "";
    const fallbackRef = request.refName || "main";
    const defaultBranch = request.refType === "branch" ? fallbackRef : "main";
    return {
        id: request.repositoryId,
        name: repositoryNameFrom(url, request.repositoryId),
        provider: providerFrom(url),
        url,
        defaultBranch,
        branches: unique([defaultBranch, request.refType === "branch" ? fallbackRef : undefined]),
        tags: unique([request.refType === "tag" ? fallbackRef : undefined]),
        recentCommits: [],
        owner: request.owner.trim() || "未配置",
    };
}
function createDraftRepositoryFromPipeline(pipeline, repositoryId, request) {
    const refType = request.refType ?? pipeline.defaultRefType;
    const refName = request.refName ?? pipeline.defaultRef;
    const url = request.repositoryUrl?.trim() || pipeline.repository;
    const defaultBranch = refType === "branch" ? refName : pipeline.defaultBranch || "main";
    return {
        id: repositoryId,
        name: repositoryNameFrom(url, repositoryId),
        provider: providerFrom(url),
        url,
        defaultBranch,
        branches: unique([defaultBranch, pipeline.defaultBranch, refType === "branch" ? refName : undefined]),
        tags: unique([refType === "tag" ? refName : undefined]),
        recentCommits: [],
        owner: pipeline.owner || "未配置",
    };
}
function normalizeTriggers(triggers) {
    const trimmed = triggers.map((trigger) => trigger.trim()).filter(Boolean);
    return trimmed.length > 0 ? Array.from(new Set(trimmed)) : ["manual"];
}
function unique(values) {
    return Array.from(new Set(values.map((value) => value?.trim()).filter((value) => Boolean(value))));
}
function repositoryNameFrom(url, fallback) {
    const normalizedFallback = fallback.trim() || "repository";
    if (!url.trim())
        return normalizedFallback;
    const path = url.replace(/\.git$/i, "").split(/[/:]/).filter(Boolean);
    return path[path.length - 1] || normalizedFallback;
}
function providerFrom(url) {
    if (url.includes("github.com"))
        return "github";
    if (url.includes("gitlab"))
        return "gitlab";
    if (url.includes("gitcode"))
        return "gitcode";
    if (url.includes("gitea"))
        return "gitea";
    return "codeup";
}
function normalizeSourcePolicy(sourcePolicy, defaultBranch) {
    return {
        allowedBranchPatterns: normalizePatternList(sourcePolicy?.allowedBranchPatterns, [defaultBranch, "release/*"]),
        allowedTagPatterns: normalizePatternList(sourcePolicy?.allowedTagPatterns, ["v*", "release-*"]),
        allowRuntimeBranch: sourcePolicy?.allowRuntimeBranch ?? true,
        allowRuntimeTag: sourcePolicy?.allowRuntimeTag ?? true,
        allowRuntimeCommit: sourcePolicy?.allowRuntimeCommit ?? true,
    };
}
function normalizePatternList(input, fallback) {
    const normalized = Array.from(new Set((input ?? fallback).map((item) => item.trim()).filter(Boolean)));
    return normalized.length > 0 ? normalized : fallback;
}
function assertRefAllowedByPolicy(refType, refName, sourcePolicy) {
    const patterns = refType === "branch" ? sourcePolicy.allowedBranchPatterns : sourcePolicy.allowedTagPatterns;
    if (!matchesAnyPattern(refName, patterns)) {
        throw new common_1.BadRequestException(`${refType} ${refName} is not allowed by source policy`);
    }
}
function matchesAnyPattern(value, patterns) {
    return patterns.some((pattern) => globToRegExp(pattern).test(value));
}
function globToRegExp(pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`);
}
function defaultVariables(environment) {
    return [
        {
            key: "NODE_ENV",
            value: environment === "prod" ? "production" : environment,
            description: "构建时运行环境标识，不应放入密钥。",
            injectionTiming: "build",
            targetStages: ["test", "build", "package"],
        },
        {
            key: "IMAGE_TAG",
            value: "${run.id}-${commit.short}",
            description: "构建产物版本，会写入镜像和制品元数据。",
            injectionTiming: "build",
            targetStages: ["build", "upload", "deploy"],
        },
        {
            key: "DEPLOY_NAMESPACE",
            value: environment === "prod" ? "app-prod" : `app-${environment}`,
            description: "部署时注入到 manifest，不进入镜像。",
            injectionTiming: "deploy",
            targetStages: ["deploy", "canary", "promote"],
        },
    ];
}
function defaultCaches(repositoryName) {
    return [
        {
            key: `${repositoryName}-pnpm-store`,
            path: "node_modules/.pnpm-store",
            restoreKeys: [`${repositoryName}-`, "node-"],
            enabled: true,
        },
    ];
}
function defaultServiceConnections(provider) {
    const registryServiceConnections = Object.values(shared_1.IMAGE_REGISTRY_PRESETS).map((preset) => preset.defaults.serviceConnection);
    return [`${provider}-readonly`, ...registryServiceConnections, "ack-deploy"];
}
function normalizeImageArtifact(input, applicationId, repositoryName, serviceConnection) {
    const base = (0, shared_1.defaultImageArtifactConfig)({
        applicationId,
        name: repositoryName,
        serviceConnections: serviceConnection ? ["", serviceConnection] : undefined,
    });
    return {
        registryProvider: input?.registryProvider ?? base.registryProvider,
        region: input?.region?.trim() || base.region,
        registryUrl: input?.registryUrl?.trim() || base.registryUrl,
        internalRegistryUrl: input?.internalRegistryUrl?.trim() || base.internalRegistryUrl,
        useInternalRegistry: input?.useInternalRegistry ?? base.useInternalRegistry,
        namespace: input?.namespace?.trim() || base.namespace,
        imageName: input?.imageName?.trim() || base.imageName || repositoryName,
        tagTemplate: input?.tagTemplate?.trim() || base.tagTemplate,
        serviceConnection: input?.serviceConnection?.trim() || serviceConnection || base.serviceConnection,
        privateRegistry: input?.privateRegistry ?? base.privateRegistry,
        registryUsername: input?.registryUsername?.trim() || base.registryUsername,
        dockerConfigSecret: input?.dockerConfigSecret?.trim() || base.dockerConfigSecret,
        dockerfilePath: input?.dockerfilePath?.trim() || base.dockerfilePath,
        contextPath: input?.contextPath?.trim() || base.contextPath,
    };
}
function normalizeBuildConfig(input) {
    const script = input?.packageBuildScript?.trim() || shared_1.DEFAULT_PIPELINE_BUILD_CONFIG.packageBuildScript;
    const outputPaths = Array.from(new Set((input?.packageOutputPaths?.length ? input.packageOutputPaths : shared_1.DEFAULT_PIPELINE_BUILD_CONFIG.packageOutputPaths)
        .map((item) => item.trim())
        .filter(Boolean)));
    return {
        packageMode: input?.packageMode ?? shared_1.DEFAULT_PIPELINE_BUILD_CONFIG.packageMode,
        runtime: input?.runtime ?? shared_1.DEFAULT_PIPELINE_BUILD_CONFIG.runtime,
        packageBuildScript: script,
        packageOutputPaths: outputPaths.length > 0 ? outputPaths : shared_1.DEFAULT_PIPELINE_BUILD_CONFIG.packageOutputPaths,
    };
}
//# sourceMappingURL=pipelines.service.js.map