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
const pipelines_repository_1 = require("./pipelines.repository");
let PipelinesService = class PipelinesService {
    repo;
    applications;
    codeRepos;
    sequence = 4;
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
        const application = this.applications.get(request.applicationId);
        const repository = this.codeRepos.get(request.repositoryId);
        this.codeRepos.assertReference(repository, request.refType, request.refName);
        const sourcePolicy = normalizeSourcePolicy(request.sourcePolicy, repository.defaultBranch);
        assertRefAllowedByPolicy(request.refType, request.refName, sourcePolicy);
        const stages = this.normalizeStages(request.stages);
        const pipeline = {
            id: `pipe-custom-${this.sequence++}`,
            name: request.name.trim() || `${application.id}-${request.targetEnvironment}-release`,
            applicationId: application.id,
            repositoryId: repository.id,
            repository: repository.url,
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
            serviceConnections: request.serviceConnections ?? ["codeup-readonly", "acr-push", "ack-deploy"],
        };
        await this.repo.prepend(pipeline);
        return pipeline;
    }
    async update(id, request) {
        const current = this.get(id);
        const repositoryId = request.repositoryId ?? current.repositoryId;
        const repository = this.codeRepos.get(repositoryId);
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
        this.codeRepos.assertReference(repository, refType, refName);
        const sourcePolicy = normalizeSourcePolicy(request.sourcePolicy ?? current.sourcePolicy, repository.defaultBranch);
        assertRefAllowedByPolicy(refType, refName, sourcePolicy);
        const patch = {
            name: request.name?.trim() || current.name,
            repositoryId: repository.id,
            repository: repository.url,
            defaultRefType: refType,
            defaultRef: refName,
            defaultBranch: refType === "branch" ? refName : repository.defaultBranch,
            sourcePolicy,
            targetEnvironment: request.targetEnvironment ?? current.targetEnvironment,
            strategy: request.strategy ?? current.strategy,
            canaryPercent: request.canaryPercent ?? current.canaryPercent,
            requiresApproval: request.requiresApproval ?? current.requiresApproval,
            stages: request.stages ? this.normalizeStages(request.stages) : current.stages,
            triggers: request.triggers ? normalizeTriggers(request.triggers) : current.triggers,
            owner: request.owner?.trim() || current.owner,
            variables: request.variables ?? current.variables ?? defaultVariables(current.targetEnvironment),
            runtimeVariables: request.runtimeVariables ?? current.runtimeVariables ?? [],
            caches: request.caches ?? current.caches ?? defaultCaches(repository.name),
            serviceConnections: request.serviceConnections ?? current.serviceConnections ?? ["codeup-readonly", "acr-push", "ack-deploy"],
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
function normalizeTriggers(triggers) {
    const trimmed = triggers.map((trigger) => trigger.trim()).filter(Boolean);
    return trimmed.length > 0 ? Array.from(new Set(trimmed)) : ["manual"];
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
        { key: "NODE_ENV", value: environment === "prod" ? "production" : environment, description: "运行环境" },
        { key: "IMAGE_TAG", value: "${run.id}-${commit.short}", description: "镜像版本" },
        { key: "DEPLOY_NAMESPACE", value: environment === "prod" ? "mall-prod" : `mall-${environment}`, description: "Kubernetes namespace" },
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
//# sourceMappingURL=pipelines.service.js.map