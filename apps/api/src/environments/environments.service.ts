import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import type {
  DeploymentEnvironment,
  DeploymentTarget,
  DeploymentTargetAdapter,
  EnvironmentLock,
  EnvironmentType,
  PackageMode,
  ReleaseDeployment,
  ReleaseTarget,
} from "@deploy-management/shared";
import { createStableId } from "../common/ids";
import { DeploymentTargetsRepository } from "./deployment-targets.repository";
import { EnvironmentLocksRepository } from "./environment-locks.repository";
import { EnvironmentsRepository } from "./environments.repository";

@Injectable()
export class EnvironmentsService {
  constructor(
    @Inject(EnvironmentsRepository) private readonly repo: EnvironmentsRepository,
    @Inject(DeploymentTargetsRepository) private readonly targets: DeploymentTargetsRepository,
    @Inject(EnvironmentLocksRepository) private readonly locks: EnvironmentLocksRepository,
  ) {}

  list(): DeploymentEnvironment[] {
    return this.repo.snapshot();
  }

  listDeploymentTargets(): DeploymentTarget[] {
    return this.targets.snapshot();
  }

  listEnvironmentLocks(): EnvironmentLock[] {
    return this.locks.snapshot();
  }

  getDeploymentTarget(targetId: string): DeploymentTarget {
    const target = this.targets.snapshot().find((item) => item.id === targetId);
    if (!target) {
      throw new BadRequestException(`DeploymentTarget ${targetId} 不存在`);
    }
    return target;
  }

  async createDeploymentTarget(input: CreateDeploymentTargetInput): Promise<DeploymentTarget> {
    if (!input.environment || !input.adapter || !input.packageModes?.length) {
      throw new BadRequestException("创建 DeploymentTarget 需要 environment、adapter 和 packageModes");
    }
    const now = new Date().toISOString();
    return this.targets.prepend({
      id: input.id ?? createStableId("target"),
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

  async resolveDeploymentTarget(input: ResolveDeploymentTargetInput): Promise<DeploymentTarget> {
    if (input.deploymentTargetId) {
      return this.getDeploymentTarget(input.deploymentTargetId);
    }

    const adapter = adapterFromReleaseTarget(input.target);
    const existing = this.targets.snapshot().find((target) =>
      target.environment === input.environment &&
      target.adapter === adapter &&
      target.packageModes.includes(input.packageMode)
    );
    if (existing) return existing;

    const now = new Date().toISOString();
    return this.targets.prepend({
      id: createStableId("target"),
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

  preflightDeploymentTarget(target: DeploymentTarget): DeploymentTargetPreflightResult {
    const issues: string[] = [];
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

  async acquireEnvironmentLock(input: AcquireEnvironmentLockInput): Promise<EnvironmentLock> {
    const activeLock = this.locks.snapshot().find((lock) =>
      lock.status === "active" &&
      lock.environment === input.environment &&
      lock.applicationId === input.applicationId
    );
    if (activeLock) {
      throw new ConflictException(
        `${environmentName(input.environment)} 已被 ${activeLock.releaseId ?? activeLock.releaseExecutionId ?? activeLock.id} 锁定，请先完成、回滚或取消当前上线`,
      );
    }

    const now = new Date().toISOString();
    const lock: EnvironmentLock = {
      id: createStableId("lock"),
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

  async releaseEnvironmentLock(lockId: string): Promise<EnvironmentLock | undefined> {
    const current = this.locks.snapshot().find((lock) => lock.id === lockId);
    if (!current || current.status !== "active") return current;

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

  async recordRelease(release: ReleaseDeployment): Promise<DeploymentEnvironment> {
    const current = this.repo.snapshot().find((environment) => environment.id === release.environment);
    const patch: Partial<DeploymentEnvironment> = {
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

  private async markEnvironmentLocked(environment: EnvironmentType, lock: EnvironmentLock): Promise<void> {
    const current = this.repo.snapshot().find((item) => item.id === environment);
    const patch: Partial<DeploymentEnvironment> = {
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
}

export type ResolveDeploymentTargetInput = {
  deploymentTargetId?: string;
  environment: EnvironmentType;
  packageMode: PackageMode;
  target: ReleaseTarget;
  namespace?: string;
  serviceConnection?: string;
  trafficConnection?: string;
  workloadName?: string;
  deploymentName?: string;
  serviceName?: string;
  ingressName?: string;
  containerName?: string;
  healthCheckUrl?: string;
  healthCheckTimeoutMs?: number;
};

export type CreateDeploymentTargetInput = Omit<DeploymentTarget, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export type DeploymentTargetPreflightResult = {
  target: DeploymentTarget;
  ready: boolean;
  issues: string[];
};

export type AcquireEnvironmentLockInput = {
  environment: EnvironmentType;
  applicationId: string;
  releaseId?: string;
  releasePlanId?: string;
  releaseExecutionId?: string;
  reason: string;
  acquiredBy: string;
  expiresAt?: string;
};

function environmentName(environment: DeploymentEnvironment["id"]): string {
  const labels: Record<DeploymentEnvironment["id"], string> = {
    dev: "开发环境",
    test: "测试环境",
    staging: "预发环境",
    prod: "生产环境",
  };
  return labels[environment];
}

function adapterFromReleaseTarget(target: ReleaseTarget): DeploymentTargetAdapter {
  if (target === "local-filesystem") return "local-filesystem";
  return target;
}

function adapterLabel(adapter: DeploymentTargetAdapter): string {
  const labels: Record<DeploymentTargetAdapter, string> = {
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
