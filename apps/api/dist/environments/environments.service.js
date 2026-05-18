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
exports.EnvironmentsService = void 0;
const common_1 = require("@nestjs/common");
const ids_1 = require("../common/ids");
const deployment_targets_repository_1 = require("./deployment-targets.repository");
const environment_locks_repository_1 = require("./environment-locks.repository");
const environments_repository_1 = require("./environments.repository");
let EnvironmentsService = class EnvironmentsService {
    repo;
    targets;
    locks;
    constructor(repo, targets, locks) {
        this.repo = repo;
        this.targets = targets;
        this.locks = locks;
    }
    list() {
        return this.repo.snapshot();
    }
    listDeploymentTargets() {
        return this.targets.snapshot();
    }
    listEnvironmentLocks() {
        return this.locks.snapshot();
    }
    getDeploymentTarget(targetId) {
        const target = this.targets.snapshot().find((item) => item.id === targetId);
        if (!target) {
            throw new common_1.BadRequestException(`DeploymentTarget ${targetId} 不存在`);
        }
        return target;
    }
    async createDeploymentTarget(input) {
        if (!input.environment || !input.adapter || !input.packageModes?.length) {
            throw new common_1.BadRequestException("创建 DeploymentTarget 需要 environment、adapter 和 packageModes");
        }
        const now = new Date().toISOString();
        return this.targets.prepend({
            id: input.id ?? (0, ids_1.createStableId)("target"),
            name: input.name?.trim() || `${environmentName(input.environment)} / ${adapterLabel(input.adapter)}`,
            environment: input.environment,
            packageModes: input.packageModes,
            adapter: input.adapter,
            namespace: input.namespace,
            serviceConnectionId: input.serviceConnectionId,
            trafficConnectionId: input.trafficConnectionId,
            workloadName: input.workloadName,
            deploymentName: input.deploymentName,
            serviceName: input.serviceName,
            ingressName: input.ingressName,
            containerName: input.containerName,
            healthCheckUrl: input.healthCheckUrl,
            healthCheckTimeoutMs: input.healthCheckTimeoutMs,
            createdAt: now,
            updatedAt: now,
        });
    }
    async resolveDeploymentTarget(input) {
        if (input.deploymentTargetId) {
            return this.getDeploymentTarget(input.deploymentTargetId);
        }
        const adapter = adapterFromReleaseTarget(input.target);
        const existing = this.targets.snapshot().find((target) => target.environment === input.environment &&
            target.adapter === adapter &&
            target.packageModes.includes(input.packageMode));
        if (existing)
            return existing;
        const now = new Date().toISOString();
        return this.targets.prepend({
            id: (0, ids_1.createStableId)("target"),
            name: `${environmentName(input.environment)} / ${adapterLabel(adapter)}`,
            environment: input.environment,
            packageModes: [input.packageMode],
            adapter,
            namespace: input.namespace,
            serviceConnectionId: input.serviceConnection,
            trafficConnectionId: input.trafficConnection,
            workloadName: input.workloadName,
            deploymentName: input.deploymentName,
            serviceName: input.serviceName,
            ingressName: input.ingressName,
            containerName: input.containerName,
            healthCheckUrl: input.healthCheckUrl,
            healthCheckTimeoutMs: input.healthCheckTimeoutMs,
            createdAt: now,
            updatedAt: now,
        });
    }
    preflightDeploymentTarget(target) {
        const issues = [];
        if (target.adapter === "kubernetes" && !target.namespace) {
            issues.push("Kubernetes DeploymentTarget 缺少 namespace");
        }
        if (target.adapter === "helm" && !target.namespace) {
            issues.push("Helm DeploymentTarget 缺少 namespace");
        }
        if (["kubernetes", "helm", "nginx-ingress", "istio", "argo-rollouts"].includes(target.adapter) && !target.serviceConnectionId) {
            issues.push(`${adapterLabel(target.adapter)} 缺少 serviceConnectionId`);
        }
        if (["nginx-ingress", "istio", "argo-rollouts", "aliyun-alb", "cdn"].includes(target.adapter) && !target.trafficConnectionId) {
            issues.push(`${adapterLabel(target.adapter)} 缺少 trafficConnectionId，区域/百分比灰度只能记录状态，不能真实切流`);
        }
        return {
            target,
            ready: issues.length === 0,
            issues,
        };
    }
    async acquireEnvironmentLock(input) {
        const activeLock = this.locks.snapshot().find((lock) => lock.status === "active" &&
            lock.environment === input.environment &&
            lock.applicationId === input.applicationId);
        if (activeLock) {
            throw new common_1.ConflictException(`${environmentName(input.environment)} 已被 ${activeLock.releaseId ?? activeLock.releaseExecutionId ?? activeLock.id} 锁定，请先完成、回滚或取消当前上线`);
        }
        const now = new Date().toISOString();
        const lock = {
            id: (0, ids_1.createStableId)("lock"),
            environment: input.environment,
            applicationId: input.applicationId,
            releaseId: input.releaseId,
            releasePlanId: input.releasePlanId,
            releaseExecutionId: input.releaseExecutionId,
            reason: input.reason,
            status: "active",
            acquiredBy: input.acquiredBy,
            acquiredAt: now,
            expiresAt: input.expiresAt,
        };
        await this.locks.prepend(lock);
        await this.markEnvironmentLocked(input.environment, lock);
        return lock;
    }
    async releaseEnvironmentLock(lockId) {
        const current = this.locks.snapshot().find((lock) => lock.id === lockId);
        if (!current || current.status !== "active")
            return current;
        const releasedAt = new Date().toISOString();
        const updated = await this.locks.update(lockId, {
            status: "released",
            releasedAt,
        });
        const environment = this.repo.snapshot().find((item) => item.id === current.environment);
        if (environment?.activeLockId === lockId) {
            await this.repo.update(environment.id, {
                activeReleaseId: undefined,
                activeReleasePlanId: undefined,
                activeReleaseExecutionId: undefined,
                activeLockId: undefined,
                status: environment.currentImage ? "healthy" : "warning",
            });
        }
        return updated;
    }
    async recordRelease(release) {
        const current = this.repo.snapshot().find((environment) => environment.id === release.environment);
        const patch = {
            currentVersion: release.version,
            currentImage: release.imageRef,
            currentDigest: release.imageDigest,
            lastReleaseId: release.id,
            activeReleaseId: undefined,
            activeReleasePlanId: undefined,
            activeReleaseExecutionId: undefined,
            activeLockId: undefined,
            deployedAt: release.deployedAt ?? release.updatedAt,
            status: release.status === "success" ? "healthy" : "warning",
            activeRuns: Math.max(1, current?.activeRuns ?? 0),
        };
        if (current) {
            return this.repo.update(current.id, patch);
        }
        return this.repo.create({
            id: release.environment,
            name: environmentName(release.environment),
            cluster: release.target === "kubernetes" ? release.serviceConnection : "local-docker",
            protection: release.environment === "prod" ? "manual approval" : "auto deploy",
            currentVersion: release.version,
            currentImage: release.imageRef,
            currentDigest: release.imageDigest,
            lastReleaseId: release.id,
            deployedAt: release.deployedAt ?? release.updatedAt,
            status: release.status === "success" ? "healthy" : "warning",
            activeRuns: 1,
        });
    }
    async markEnvironmentLocked(environment, lock) {
        const current = this.repo.snapshot().find((item) => item.id === environment);
        const patch = {
            activeReleaseId: lock.releaseId,
            activeReleasePlanId: lock.releasePlanId,
            activeReleaseExecutionId: lock.releaseExecutionId,
            activeLockId: lock.id,
            status: "locked",
            activeRuns: Math.max(1, current?.activeRuns ?? 0),
        };
        if (current) {
            await this.repo.update(current.id, patch);
            return;
        }
        await this.repo.create({
            id: environment,
            name: environmentName(environment),
            cluster: "未绑定",
            protection: environment === "prod" ? "manual approval" : "auto deploy",
            currentVersion: "none",
            status: "locked",
            activeRuns: 1,
            ...patch,
        });
    }
};
exports.EnvironmentsService = EnvironmentsService;
exports.EnvironmentsService = EnvironmentsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(environments_repository_1.EnvironmentsRepository)),
    __param(1, (0, common_1.Inject)(deployment_targets_repository_1.DeploymentTargetsRepository)),
    __param(2, (0, common_1.Inject)(environment_locks_repository_1.EnvironmentLocksRepository)),
    __metadata("design:paramtypes", [environments_repository_1.EnvironmentsRepository,
        deployment_targets_repository_1.DeploymentTargetsRepository,
        environment_locks_repository_1.EnvironmentLocksRepository])
], EnvironmentsService);
function environmentName(environment) {
    const labels = {
        dev: "开发环境",
        test: "测试环境",
        staging: "预发环境",
        prod: "生产环境",
    };
    return labels[environment];
}
function adapterFromReleaseTarget(target) {
    if (target === "local-filesystem")
        return "local-filesystem";
    return target;
}
function adapterLabel(adapter) {
    const labels = {
        "local-docker": "Local Docker",
        "local-filesystem": "Local Filesystem",
        kubernetes: "Kubernetes",
        helm: "Helm",
        "nginx-ingress": "Nginx Ingress",
        istio: "Istio",
        "argo-rollouts": "Argo Rollouts",
        "aliyun-alb": "Aliyun ALB",
        cdn: "CDN",
        ecs: "ECS",
    };
    return labels[adapter];
}
//# sourceMappingURL=environments.service.js.map