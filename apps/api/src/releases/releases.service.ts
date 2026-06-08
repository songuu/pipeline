import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type {
  Artifact,
  BaselineSource,
  CanaryAnalysisSnapshot,
  CanaryRolloutPolicy,
  CanaryRolloutStep,
  CanaryRolloutStepRegion,
  CanaryStepStatus,
  CanaryTrafficRegion,
  ReleaseCanaryActionRequest,
  DeployArtifactRequest,
  EnvironmentType,
  PackageMode,
  PipelineRun,
  ReleaseDeployment,
  ReleaseEvent,
  ReleaseEventType,
  ReleaseExecution,
  ReleaseExecutionStatus,
  ReleasePlan,
  ReleaseTarget,
  RolloutStrategyConfig,
  TrafficSnapshot,
} from "@deploy-management/shared";
import { ArtifactsService } from "../artifacts/artifacts.service";
import { AuditService } from "../audit/audit.service";
import { createStableId } from "../common/ids";
import { EnvironmentsService } from "../environments/environments.service";
import { buildReleaseFailureMessage } from "../notifications/notification-messages";
import { NotificationService } from "../notifications/notification.service";
import { RunsService } from "../runs/runs.service";
import { ReleaseEventsRepository } from "./release-events.repository";
import { ReleaseExecutionsRepository } from "./release-executions.repository";
import { ReleasePlansRepository } from "./release-plans.repository";
import { ReleasesRepository } from "./releases.repository";

type CommandResult = {
  display: string;
  output: string;
};

const DEFAULT_CANARY_REGIONS: CanaryTrafficRegion[] = [
  { id: "cn-hangzhou", name: "华东1（杭州）", percent: 10, enabled: true },
  { id: "cn-shanghai", name: "华东2（上海）", percent: 5, enabled: false },
  { id: "cn-beijing", name: "华北2（北京）", percent: 5, enabled: false },
  { id: "cn-shenzhen", name: "华南1（深圳）", percent: 5, enabled: false },
];

@Injectable()
export class ReleasesService {
  constructor(
    @Inject(ReleasesRepository) private readonly repo: ReleasesRepository,
    @Inject(ReleasePlansRepository) private readonly plans: ReleasePlansRepository,
    @Inject(ReleaseExecutionsRepository) private readonly executions: ReleaseExecutionsRepository,
    @Inject(ReleaseEventsRepository) private readonly releaseEvents: ReleaseEventsRepository,
    @Inject(ArtifactsService) private readonly artifacts: ArtifactsService,
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(EnvironmentsService) private readonly environments: EnvironmentsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  /** 旁路通知：dispatch 自身不抛错，仍兜底 catch，确保发布主流程绝不被通知拖累。 */
  private async notifyFailure(
    release: ReleaseDeployment,
    eventType: "deploy_failed" | "release_rolled_back",
    detail: string,
  ): Promise<void> {
    try {
      await this.notifications.dispatch(buildReleaseFailureMessage(release, eventType, detail));
    } catch {
      // 通知失败不影响发布/回滚结果
    }
  }

  list(): ReleaseDeployment[] {
    return this.repo.snapshot();
  }

  listReleasePlans(): ReleasePlan[] {
    return this.plans.snapshot();
  }

  listReleaseExecutions(): ReleaseExecution[] {
    return this.executions.snapshot();
  }

  listReleaseEvents(): ReleaseEvent[] {
    return this.releaseEvents.snapshot();
  }

  listReleaseEventsForRelease(releaseId: string): ReleaseEvent[] {
    this.get(releaseId);
    return this.releaseEvents.listForRelease(releaseId);
  }

  async deployArtifact(artifactId: string, request: DeployArtifactRequest): Promise<ReleaseDeployment> {
    const artifact = this.artifacts.get(artifactId);
    const run = this.runs.get(artifact.runId);
    const environment = request.environment ?? run.environment;
    const packageMode = packageModeFrom(request, run, artifact);
    const target = releaseTargetFrom(request, packageMode);
    assertDeployableArtifact(packageMode, artifact);
    assertTargetCompatible(packageMode, target);
    const rolloutStrategy = buildRolloutStrategy(request, run, packageMode);
    const rolloutPolicy = rolloutStrategy ? canaryPolicyFromRolloutStrategy(rolloutStrategy, request) : undefined;
    const rolloutSteps = rolloutStrategy && rolloutPolicy ? buildRolloutSteps(rolloutStrategy, rolloutPolicy) : undefined;
    const initialStep = rolloutSteps?.find((step) => step.status === "active");
    const initialTrafficPercent = initialStep?.percent;
    const initialRegionTraffic = initialStep?.regions;
    const { stableRelease, baselineArtifactId, baselineSource } = this.resolveBaseline(
      request,
      run.applicationId,
      environment,
      packageMode,
    );
    const deploymentTarget = await this.environments.resolveDeploymentTarget({
      deploymentTargetId: request.deploymentTargetId,
      environment,
      packageMode,
      target,
      namespace: request.namespace ?? deploymentNamespace(run, environment),
      serviceConnection: request.serviceConnection ?? releaseServiceConnection(run, target),
      containerName: request.containerName ?? defaultContainerName(run, environment),
      workloadName: rolloutStrategy?.packageMode === "kubernetes_manifest" ? rolloutStrategy.policy.workloadName : undefined,
      deploymentName: rolloutStrategy?.packageMode === "kubernetes_manifest" ? rolloutStrategy.policy.workloadName : undefined,
      serviceName: rolloutStrategy?.packageMode === "kubernetes_manifest" ? rolloutStrategy.policy.serviceName : undefined,
      ingressName: rolloutStrategy?.packageMode === "kubernetes_manifest" ? rolloutStrategy.policy.ingressName : undefined,
    });
    const targetPreflight = this.environments.preflightDeploymentTarget(deploymentTarget);
    const now = new Date().toISOString();
    const releaseId = createStableId("release");
    const releasePlanId = request.releasePlanId ?? createStableId("release-plan");
    const releaseExecutionId = createStableId("release-exec");
    const actor = request.actor ?? "RO";
    const effectivePolicy = rolloutPolicy ?? fullReleasePolicy(request, run);
    const currentTraffic = trafficSnapshot(initialTrafficPercent ?? 100, initialRegionTraffic, actor);
    const lock = await this.environments.acquireEnvironmentLock({
      environment,
      applicationId: run.applicationId,
      releaseId,
      releasePlanId,
      releaseExecutionId,
      reason: `${run.pipelineName} 发布 ${artifactImageReference(artifact)}`,
      acquiredBy: actor,
    });
    const releasePlan: ReleasePlan = {
      id: releasePlanId,
      artifactId: artifact.id,
      runId: run.id,
      pipelineId: run.pipelineId,
      pipelineName: run.pipelineName,
      applicationId: run.applicationId,
      applicationName: run.applicationName,
      environment,
      packageMode,
      strategy: request.strategy ?? run.definitionSnapshot.strategy,
      targetId: deploymentTarget.id,
      target,
      policy: effectivePolicy,
      rolloutStrategy,
      baselineArtifactId,
      createdBy: actor,
      status: "running",
      createdAt: now,
      updatedAt: now,
    };
    const releaseExecution: ReleaseExecution = {
      id: releaseExecutionId,
      planId: releasePlanId,
      releaseId,
      artifactId: artifact.id,
      runId: run.id,
      applicationId: run.applicationId,
      environment,
      status: "deploying",
      stableRevision: stableRelease?.imageRef,
      candidateRevision: artifactImageReference(artifact),
      currentTraffic,
      steps: releaseStepsFromRolloutSteps(rolloutSteps, currentTraffic),
      lockId: lock.id,
      startedAt: now,
      updatedAt: now,
      logs: [
        `ReleasePlan ${releasePlanId} 已创建`,
        `DeploymentTarget ${deploymentTarget.name} (${deploymentTarget.adapter})`,
        ...targetPreflight.issues.map((issue) => `Preflight: ${issue}`),
      ],
    };
    const release: ReleaseDeployment = {
      id: releaseId,
      artifactId: artifact.id,
      runId: run.id,
      pipelineId: run.pipelineId,
      pipelineName: run.pipelineName,
      applicationId: run.applicationId,
      applicationName: run.applicationName,
      deploymentTargetId: deploymentTarget.id,
      releasePlanId,
      releaseExecutionId,
      environment,
      namespace: deploymentTarget.namespace ?? request.namespace ?? deploymentNamespace(run, environment),
      target,
      packageMode,
      imageRef: artifactImageReference(artifact),
      imageDigest: artifact.digest,
      version: artifact.version,
      strategy: request.strategy ?? run.definitionSnapshot.strategy,
      canaryPercent: request.canaryPercent ?? run.canaryPercent,
      status: "deploying",
      actor,
      serviceConnection: deploymentTarget.serviceConnectionId ?? request.serviceConnection ?? releaseServiceConnection(run, target),
      containerName: deploymentTarget.containerName ?? request.containerName ?? defaultContainerName(run, environment),
      logs: [
        `ReleasePlan ${releasePlan.id}`,
        `ReleaseExecution ${releaseExecution.id}`,
        `DeploymentTarget ${deploymentTarget.name} / ${deploymentTarget.adapter}`,
        `锁定${packageModeLabel(packageMode)}制品 ${artifact.id}`,
        `制品引用 ${artifactImageReference(artifact)}`,
        `digest ${artifact.digest}`,
        baselineSource === "user-selected"
          ? `基线版本（用户指定）: ${baselineArtifactId}`
          : stableRelease
            ? `基线版本（自动解析）: ${stableRelease.imageRef}`
            : "基线版本: 无（首次发布）",
        ...(targetPreflight.ready ? ["目标预检通过。"] : targetPreflight.issues.map((issue) => `目标预检提示：${issue}`)),
        ...(rolloutPolicy ? [`灰度批次 ${rolloutPolicy.steps.join("% -> ")}%`] : []),
        ...(rolloutPolicy?.regions?.length ? [`灰度区域 ${regionTrafficLabel(rolloutPolicy.regions)}`] : []),
        ...(rolloutPolicy && target === "local-docker"
          ? ["local-docker 已真实启动灰度镜像容器；本地没有流量网关，流量比例作为发布门禁状态记录。"]
          : []),
        ...(rolloutPolicy && target === "kubernetes"
          ? ["Kubernetes 灰度需要集群侧 Deployment/Ingress/ServiceMesh 配合；当前记录灰度状态并执行镜像上线。"]
          : []),
      ],
      rolloutPolicy,
      rolloutStrategy,
      rolloutSteps,
      currentTrafficPercent: initialTrafficPercent ?? 100,
      currentRegionTraffic: initialRegionTraffic,
      baselineArtifactId,
      baselineSource,
      stableImageRef: stableRelease?.imageRef,
      rollbackImageRef: stableRelease?.imageRef,
      rollbackReleaseId: stableRelease?.id,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.plans.prepend(releasePlan);
      await this.executions.prepend(releaseExecution);
      await this.repo.prepend(release);
      await this.recordReleaseEvent(release, "release_plan_created", "ReleasePlan 已创建并写入存储。", {
        releasePlanId: releasePlan.id,
        policy: releasePlan.policy,
        rolloutStrategy,
      });
      await this.recordReleaseEvent(release, "deployment_target_resolved", "DeploymentTarget 已解析并完成预检。", {
        deploymentTarget,
        preflight: targetPreflight,
      });
      await this.recordReleaseEvent(release, "environment_lock_acquired", "环境锁已获取。", {
        lock,
      });
      await this.recordReleaseEvent(release, "deploy_started", "开始执行制品上线。", {
        artifact,
        target,
        packageMode,
        currentTraffic,
      });
    } catch (error) {
      const failedAt = new Date().toISOString();
      const message = describe(error);
      await this.repo.update(release.id, {
        status: "failed",
        updatedAt: failedAt,
        logs: [...release.logs, `发布记录入库失败: ${message}`],
      }).catch(() => undefined);
      await this.updateReleaseExecution(release, "failed", {
        logs: [...releaseExecution.logs, `发布记录入库失败: ${message}`],
        finishedAt: failedAt,
      }).catch(() => undefined);
      await this.plans.update(releasePlan.id, {
        status: "canceled",
        updatedAt: failedAt,
      }).catch(() => undefined);
      await this.environments.releaseEnvironmentLock(lock.id).catch(() => undefined);
      throw new BadRequestException(`发布记录入库失败: ${message}`);
    }

    try {
      const executorResult =
        await this.deployByPackageMode(release, artifact, request);
      const deployedAt = new Date().toISOString();
      const releaseStatus: ReleaseDeployment["status"] = rolloutPolicy ? "canarying" : "success";
      const completed = await this.repo.update(release.id, {
        ...executorResult,
        status: releaseStatus,
        updatedAt: deployedAt,
        deployedAt: releaseStatus === "success" ? deployedAt : undefined,
        completedAt: releaseStatus === "success" ? deployedAt : undefined,
        logs: [
          ...release.logs,
          ...executorResult.logs,
          ...(rolloutPolicy
            ? [`灰度已切入 ${initialTrafficPercent}% 流量${initialRegionTraffic?.length ? `，区域 ${regionStepTrafficLabel(initialRegionTraffic)}` : ""}，等待观测后推进。`]
            : ["发布已全量完成。"]),
        ],
      });
      await this.updateReleaseExecution(completed, releaseStatus, {
        currentTraffic: trafficSnapshot(completed.currentTrafficPercent ?? 100, completed.currentRegionTraffic, completed.actor),
        logs: [...releaseExecution.logs, ...executorResult.logs],
        finishedAt: releaseStatus === "success" ? deployedAt : undefined,
      });
      await this.plans.update(releasePlan.id, {
        status: releaseStatus === "success" ? "completed" : "running",
        updatedAt: deployedAt,
      });
      if (completed.status === "success") {
        await this.environments.recordRelease(completed);
        await this.environments.releaseEnvironmentLock(lock.id);
      }
      await this.recordReleaseEvent(completed, "deploy_succeeded", releaseStatus === "success" ? "制品已全量上线。" : "制品已上线并进入灰度观测。", {
        status: releaseStatus,
        endpoint: completed.endpoint,
        currentTrafficPercent: completed.currentTrafficPercent,
        currentRegionTraffic: completed.currentRegionTraffic,
        executorLogs: executorResult.logs,
      });
      if (completed.status === "success") {
        await this.recordReleaseEvent(completed, "environment_lock_released", "全量发布完成，环境锁已释放。", {
          lockId: lock.id,
        });
      }
      await this.audit.record(completed.actor, rolloutPolicy ? "deploy_artifact_canary" : "deploy_artifact", `${completed.environment}/${completed.imageRef}`);
      return completed;
    } catch (error) {
      const failedAt = new Date().toISOString();
      const message = describe(error);
      await this.repo.update(release.id, {
        status: "failed",
        updatedAt: failedAt,
        logs: [...release.logs, `上线失败: ${message}`],
      });
      await this.updateReleaseExecution(release, "failed", {
        logs: [...releaseExecution.logs, `上线失败: ${message}`],
        finishedAt: failedAt,
      });
      await this.plans.update(releasePlan.id, {
        status: "canceled",
        updatedAt: failedAt,
      });
      await this.environments.releaseEnvironmentLock(lock.id);
      await this.recordReleaseEvent(release, "deploy_failed", `上线失败：${message}`, {
        error: message,
      });
      await this.notifyFailure(release, "deploy_failed", `上线失败：${message}`);
      await this.recordReleaseEvent(release, "environment_lock_released", "上线失败，环境锁已释放。", {
        lockId: lock.id,
        reason: "deploy_failed",
      });
      await this.audit.record(release.actor, "deploy_artifact_failed", `${release.environment}/${release.imageRef}`);
      throw new BadRequestException(`上线失败: ${message}`);
    }
  }

  get(releaseId: string): ReleaseDeployment {
    const release = this.repo.snapshot().find((item) => item.id === releaseId);
    if (!release) {
      throw new BadRequestException(`Release ${releaseId} 不存在`);
    }
    return release;
  }

  async advanceCanary(releaseId: string, request: ReleaseCanaryActionRequest): Promise<ReleaseDeployment> {
    const release = this.ensureCanaryRelease(releaseId);
    if (release.status === "paused") {
      throw new BadRequestException("灰度已暂停，请先继续灰度后再推进");
    }
    const steps = release.rolloutSteps ?? [];
    const activeIndex = steps.findIndex((step) => step.status === "active");
    if (activeIndex === -1) {
      throw new BadRequestException("灰度没有处于 active 的批次，无法推进");
    }

    const completedStep = {
      ...steps[activeIndex],
      status: "success" as const,
      finishedAt: new Date().toISOString(),
      analysis: mergeAnalysis(release, request.analysis),
      message: request.reason ?? "灰度观测通过，允许推进下一批。",
    };
    const targetIndex = nextCanaryStepIndex(steps, activeIndex, request.targetPercent);
    if (targetIndex === -1 || steps[targetIndex]?.percent >= 100) {
      return this.promoteCanary(releaseId, {
        ...request,
        reason: request.reason ?? "灰度批次已完成，推进全量。",
      });
    }

    const nextStep = {
      ...steps[targetIndex],
      status: "active" as const,
      startedAt: new Date().toISOString(),
      message: request.reason ??
        `灰度推进到 ${steps[targetIndex].percent}% 流量${steps[targetIndex].regions?.length ? `，区域 ${regionStepTrafficLabel(steps[targetIndex].regions)}` : ""}。`,
    };
    const nextSteps = steps.map((step, index) => {
      if (index === activeIndex) return completedStep;
      if (index === targetIndex) return nextStep;
      return step;
    });
    const updated = await this.repo.update(release.id, {
      status: "canarying",
      rolloutSteps: nextSteps,
      currentTrafficPercent: nextStep.percent,
      currentRegionTraffic: nextStep.regions,
      updatedAt: new Date().toISOString(),
      logs: [
        ...release.logs,
        `${request.actor ?? "RO"} 推进灰度到 ${nextStep.percent}%${nextStep.regions?.length ? `，区域 ${regionStepTrafficLabel(nextStep.regions)}` : ""}：${request.reason ?? "观测通过"}`,
      ],
    });
    await this.updateReleaseExecution(updated, "canarying", {
      currentTraffic: trafficSnapshot(nextStep.percent, nextStep.regions, request.actor ?? "RO"),
    });
    await this.recordReleaseEvent(updated, "canary_advanced", `灰度推进到 ${nextStep.percent}%`, {
      reason: request.reason,
      targetPercent: nextStep.percent,
      regions: nextStep.regions,
      analysis: completedStep.analysis,
    }, request.actor);
    await this.audit.record(request.actor ?? "RO", "canary_advance", `${updated.environment}/${updated.imageRef}`);
    return updated;
  }

  async pauseCanary(releaseId: string, request: ReleaseCanaryActionRequest): Promise<ReleaseDeployment> {
    const release = this.ensureCanaryRelease(releaseId);
    const updated = await this.repo.update(release.id, {
      status: "paused",
      rolloutSteps: markActiveStep(release.rolloutSteps, "paused", request.reason ?? "灰度已暂停，等待人工确认。"),
      updatedAt: new Date().toISOString(),
      logs: [...release.logs, `${request.actor ?? "RO"} 暂停灰度：${request.reason ?? "人工暂停"}`],
    });
    await this.updateReleaseExecution(updated, "paused");
    await this.recordReleaseEvent(updated, "canary_paused", "灰度已暂停。", {
      reason: request.reason,
    }, request.actor);
    await this.audit.record(request.actor ?? "RO", "canary_pause", `${updated.environment}/${updated.imageRef}`);
    return updated;
  }

  async resumeCanary(releaseId: string, request: ReleaseCanaryActionRequest): Promise<ReleaseDeployment> {
    const release = this.ensureCanaryRelease(releaseId);
    if (release.status !== "paused") {
      throw new BadRequestException("只有 paused 状态的灰度发布才能继续");
    }
    const updated = await this.repo.update(release.id, {
      status: "canarying",
      rolloutSteps: markActiveStep(release.rolloutSteps, "active", request.reason ?? "灰度继续观测。"),
      updatedAt: new Date().toISOString(),
      logs: [...release.logs, `${request.actor ?? "RO"} 继续灰度：${request.reason ?? "恢复执行"}`],
    });
    await this.updateReleaseExecution(updated, "canarying");
    await this.recordReleaseEvent(updated, "canary_resumed", "灰度已恢复执行。", {
      reason: request.reason,
    }, request.actor);
    await this.audit.record(request.actor ?? "RO", "canary_resume", `${updated.environment}/${updated.imageRef}`);
    return updated;
  }

  async promoteCanary(releaseId: string, request: ReleaseCanaryActionRequest): Promise<ReleaseDeployment> {
    const release = this.ensureCanaryRelease(releaseId);
    const completedAt = new Date().toISOString();
    const updated = await this.repo.update(release.id, {
      status: "success",
      currentTrafficPercent: 100,
      currentRegionTraffic: fullRegionTraffic(release.rolloutPolicy?.regions),
      rolloutSteps: (release.rolloutSteps ?? []).map((step) => ({
        ...step,
        status: "success",
        finishedAt: step.finishedAt ?? completedAt,
        analysis: step.analysis ?? mergeAnalysis(release, request.analysis),
      })),
      deployedAt: completedAt,
      completedAt,
      updatedAt: completedAt,
      logs: [...release.logs, `${request.actor ?? "RO"} 完成灰度并全量发布：${request.reason ?? "灰度通过"}`],
    });
    await this.environments.recordRelease(updated);
    await this.updateReleaseExecution(updated, "success", {
      currentTraffic: trafficSnapshot(100, updated.currentRegionTraffic, request.actor ?? "RO"),
      finishedAt: completedAt,
    });
    await this.completeReleasePlan(updated, "completed", completedAt);
    await this.releaseExecutionLock(updated);
    await this.recordReleaseEvent(updated, "canary_promoted", "灰度已全量发布。", {
      reason: request.reason,
      traffic: trafficSnapshot(100, updated.currentRegionTraffic, request.actor ?? "RO"),
    }, request.actor);
    await this.recordReleaseEvent(updated, "environment_lock_released", "灰度全量完成，环境锁已释放。", {
      reason: "canary_promoted",
    }, request.actor);
    await this.audit.record(request.actor ?? "RO", "canary_promote", `${updated.environment}/${updated.imageRef}`);
    return updated;
  }

  async rollbackRelease(releaseId: string, request: ReleaseCanaryActionRequest): Promise<ReleaseDeployment> {
    const release = this.get(releaseId);
    const stableRelease = this.resolveRollbackRelease(release);
    if (!stableRelease) {
      throw new BadRequestException("当前发布没有可回滚的稳定版本，请先完成一次成功上线后再灰度");
    }
    const rollbackAt = new Date().toISOString();
    const rollbackExecution: ReleaseDeployment = {
      ...release,
      imageRef: stableRelease.imageRef,
      imageDigest: stableRelease.imageDigest,
      version: stableRelease.version,
      status: "deploying",
      currentTrafficPercent: 100,
      currentRegionTraffic: fullRegionTraffic(release.rolloutPolicy?.regions),
      logs: [...release.logs, `回滚到稳定版本 ${stableRelease.imageRef}`],
      updatedAt: rollbackAt,
    };
    const rollbackArtifact = this.artifacts.get(stableRelease.artifactId);
    const executorResult = await this.deployByPackageMode(rollbackExecution, rollbackArtifact, {});
    const updated = await this.repo.update(release.id, {
      status: "rolled_back",
      currentTrafficPercent: 0,
      currentRegionTraffic: zeroRegionTraffic(release.rolloutPolicy?.regions),
      rolloutSteps: (release.rolloutSteps ?? []).map((step) => ({
        ...step,
        status: step.status === "success" ? step.status : "rolled_back",
        finishedAt: step.finishedAt ?? rollbackAt,
      })),
      updatedAt: rollbackAt,
      completedAt: rollbackAt,
      logs: [
        ...release.logs,
        ...executorResult.logs,
        `${request.actor ?? "RO"} 回滚灰度：${request.reason ?? "人工回滚"}；稳定版本 ${stableRelease.imageRef}`,
      ],
    });
    await this.environments.recordRelease({ ...stableRelease, actor: request.actor ?? stableRelease.actor });
    await this.updateReleaseExecution(updated, "rolled_back", {
      currentTraffic: trafficSnapshot(0, updated.currentRegionTraffic, request.actor ?? "RO"),
      logs: [...updated.logs],
      finishedAt: rollbackAt,
    });
    await this.completeReleasePlan(updated, "completed", rollbackAt);
    await this.releaseExecutionLock(updated);
    await this.recordReleaseEvent(updated, "release_rolled_back", "发布已回滚到稳定版本。", {
      reason: request.reason,
      stableReleaseId: stableRelease.id,
      stableImageRef: stableRelease.imageRef,
      rollbackTraffic: trafficSnapshot(0, updated.currentRegionTraffic, request.actor ?? "RO"),
    }, request.actor);
    await this.notifyFailure(updated, "release_rolled_back", `发布已回滚到稳定版本 ${stableRelease.imageRef}：${request.reason ?? "人工回滚"}`);
    await this.recordReleaseEvent(updated, "environment_lock_released", "回滚完成，环境锁已释放。", {
      reason: "release_rolled_back",
    }, request.actor);
    await this.audit.record(request.actor ?? "RO", "release_rollback", `${updated.environment}/${updated.imageRef}`);
    return updated;
  }

  async recordCanaryAnalysis(
    releaseId: string,
    analysis: ReleaseCanaryActionRequest["analysis"],
    actor = "system:canary-watcher",
  ): Promise<ReleaseDeployment> {
    const release = this.ensureCanaryRelease(releaseId);
    const steps = release.rolloutSteps ?? [];
    const activeIndex = steps.findIndex((step) => step.status === "active");
    if (activeIndex === -1) {
      throw new BadRequestException("灰度没有处于 active 的批次，无法写入采样结果");
    }
    const snapshot = mergeAnalysis(release, analysis);
    const updatedSteps = steps.map((step, index) =>
      index === activeIndex
        ? {
            ...step,
            analysis: snapshot,
            message: snapshot.message,
          }
        : step,
    );
    const updated = await this.repo.update(release.id, {
      rolloutSteps: updatedSteps,
      updatedAt: snapshot.sampledAt,
      logs: [...release.logs, `${actor} 采样灰度指标：${snapshot.message}`],
    });
    await this.updateReleaseExecution(updated, release.status === "paused" ? "paused" : "canarying");
    return updated;
  }

  async recordCanaryAutomationEvent(
    releaseId: string,
    type: Extract<ReleaseEventType, "canary_analysis_sampled" | "canary_auto_promoted" | "canary_auto_rolled_back">,
    message: string,
    payload: Record<string, unknown> = {},
    actor = "system:canary-watcher",
  ): Promise<ReleaseEvent> {
    const release = this.get(releaseId);
    return this.recordReleaseEvent(release, type, message, payload, actor);
  }

  private async recordReleaseEvent(
    release: ReleaseDeployment,
    type: ReleaseEventType,
    message: string,
    payload: Record<string, unknown> = {},
    actor?: string,
  ): Promise<ReleaseEvent> {
    return this.releaseEvents.append({
      releaseId: release.id,
      releasePlanId: release.releasePlanId,
      releaseExecutionId: release.releaseExecutionId,
      artifactId: release.artifactId,
      runId: release.runId,
      applicationId: release.applicationId,
      environment: release.environment,
      type,
      message,
      actor: actor ?? release.actor,
      payload,
    });
  }

  private async updateReleaseExecution(
    release: ReleaseDeployment,
    status: ReleaseExecutionStatus,
    patch: Partial<ReleaseExecution> = {},
  ): Promise<ReleaseExecution | undefined> {
    if (!release.releaseExecutionId) return undefined;
    const current = this.executions.snapshot().find((execution) => execution.id === release.releaseExecutionId);
    if (!current) return undefined;
    const updatedAt = new Date().toISOString();
    const currentTraffic = patch.currentTraffic ??
      trafficSnapshot(release.currentTrafficPercent ?? 100, release.currentRegionTraffic, release.actor);
    return this.executions.update(current.id, {
      ...patch,
      status,
      currentTraffic,
      steps: patch.steps ?? releaseStepsFromRolloutSteps(release.rolloutSteps, currentTraffic, status),
      updatedAt,
    });
  }

  private async completeReleasePlan(
    release: ReleaseDeployment,
    status: ReleasePlan["status"],
    updatedAt = new Date().toISOString(),
  ): Promise<ReleasePlan | undefined> {
    if (!release.releasePlanId) return undefined;
    const current = this.plans.snapshot().find((plan) => plan.id === release.releasePlanId);
    if (!current) return undefined;
    return this.plans.update(current.id, { status, updatedAt });
  }

  private async releaseExecutionLock(release: ReleaseDeployment): Promise<void> {
    if (!release.releaseExecutionId) return;
    const execution = this.executions.snapshot().find((item) => item.id === release.releaseExecutionId);
    if (execution?.lockId) {
      await this.environments.releaseEnvironmentLock(execution.lockId);
    }
  }

  private ensureCanaryRelease(releaseId: string): ReleaseDeployment {
    const release = this.get(releaseId);
    if (!release.rolloutPolicy || !release.rolloutSteps?.length) {
      throw new BadRequestException(`Release ${releaseId} 不是灰度发布`);
    }
    if (!["canarying", "paused"].includes(release.status)) {
      throw new BadRequestException(`Release ${releaseId} 当前状态 ${release.status} 不允许灰度操作`);
    }
    return release;
  }

  private resolveBaseline(
    request: DeployArtifactRequest,
    applicationId: string,
    environment: EnvironmentType,
    candidatePackageMode: PackageMode,
  ): { stableRelease: ReleaseDeployment | undefined; baselineArtifactId: string | undefined; baselineSource: BaselineSource } {
    if (request.baselineArtifactId) {
      const baselineArtifact = this.artifacts.get(request.baselineArtifactId);
      const baselineRun = this.runs.get(baselineArtifact.runId);
      if (baselineRun.applicationId !== applicationId) {
        throw new BadRequestException(
          `基线制品所属应用 (${baselineRun.applicationId}) 与当前应用 (${applicationId}) 不一致`,
        );
      }
      const baselinePackageMode = baselineRun.definitionSnapshot.buildConfig?.packageMode ?? "container_image";
      if (baselinePackageMode !== candidatePackageMode) {
        throw new BadRequestException(
          `基线制品的打包模式 (${baselinePackageMode}) 与候选制品 (${candidatePackageMode}) 不一致`,
        );
      }
      const stableRelease = this.repo
        .snapshot()
        .find((release) => release.artifactId === request.baselineArtifactId && release.status === "success");
      return {
        stableRelease: stableRelease ?? this.findLatestStableRelease(applicationId, environment),
        baselineArtifactId: request.baselineArtifactId,
        baselineSource: "user-selected" as const,
      };
    }
    const stableRelease = this.findLatestStableRelease(applicationId, environment);
    return { stableRelease, baselineArtifactId: undefined, baselineSource: "auto-resolved" as const };
  }

  private findLatestStableRelease(applicationId: string, environment: EnvironmentType): ReleaseDeployment | undefined {
    return this.repo
      .snapshot()
      .find((release) => release.applicationId === applicationId && release.environment === environment && release.status === "success");
  }

  private resolveRollbackRelease(release: ReleaseDeployment): ReleaseDeployment | undefined {
    const releases = this.repo.snapshot();
    return releases.find((item) => item.id === release.rollbackReleaseId) ??
      releases.find(
        (item) =>
          item.applicationId === release.applicationId &&
          item.environment === release.environment &&
          item.status === "success" &&
          item.imageRef === release.rollbackImageRef,
      ) ??
      releases.find(
        (item) =>
          item.applicationId === release.applicationId &&
          item.environment === release.environment &&
          item.status === "success",
      );
  }

  private async deployByPackageMode(
    release: ReleaseDeployment,
    artifact: Artifact,
    request: DeployArtifactRequest,
  ): Promise<Partial<ReleaseDeployment> & { logs: string[] }> {
    if (release.packageMode === "static_site") {
      return this.deployStaticSite(release, artifact);
    }
    if (release.packageMode === "server_package") {
      return this.deployServerPackage(release, artifact);
    }
    if (release.packageMode === "kubernetes_manifest") {
      return this.deployKubernetesManifest(release, artifact);
    }
    if (release.packageMode === "helm_chart") {
      return this.deployHelmChart(release, artifact);
    }
    return release.target === "kubernetes"
      ? this.deployToKubernetes(release)
      : this.deployToLocalDocker(release, request);
  }

  private async deployToLocalDocker(
    release: ReleaseDeployment,
    request: DeployArtifactRequest,
  ): Promise<Partial<ReleaseDeployment> & { logs: string[] }> {
    const containerPort = request.containerPort ?? portFromEnv("LOCAL_DOCKER_CONTAINER_PORT", 3000);
    const docker = dockerExecutable();
    const logs = [`使用 local-docker 上线目标 ${release.containerName}`, `容器端口 ${containerPort}`];

    const pull = await runCommand(docker, ["pull", release.imageRef]);
    logs.push(commandLog(pull));

    await runCommand(docker, ["rm", "-f", release.containerName ?? ""], { ignoreFailure: true });
    const portBinding = request.hostPort ? `${request.hostPort}:${containerPort}` : String(containerPort);
    const run = await runCommand(docker, [
      "run",
      "-d",
      "--name",
      release.containerName ?? defaultContainerNameFromRelease(release),
      "--restart",
      "unless-stopped",
      "-p",
      portBinding,
      release.imageRef,
    ]);
    logs.push(commandLog(run));

    const running = await runCommand(docker, [
      "inspect",
      "--format={{.State.Running}}",
      release.containerName ?? defaultContainerNameFromRelease(release),
    ]);
    if (!running.output.trim().includes("true")) {
      const containerLogs = await runCommand(docker, ["logs", "--tail", "80", release.containerName ?? ""], {
        ignoreFailure: true,
      });
      throw new Error(`容器启动后未保持运行：${tail(containerLogs.output)}`);
    }

    const port = await runCommand(docker, ["port", release.containerName ?? "", `${containerPort}/tcp`], {
      ignoreFailure: true,
    });
    const endpoint = endpointFromDockerPort(port.output, request.hostPort);
    if (endpoint) {
      logs.push(`本地访问地址 ${endpoint}`);
    }
    return { endpoint, logs };
  }

  private async deployToKubernetes(release: ReleaseDeployment): Promise<Partial<ReleaseDeployment> & { logs: string[] }> {
    const kubeconfig = process.env.KUBECONFIG;
    if (!kubeconfig) {
      throw new Error("Kubernetes 上线缺少 KUBECONFIG，请在服务器环境配置后再选择 kubernetes target");
    }
    const kubectl = process.env.KUBECTL_PATH || "kubectl";
    const deploymentName = process.env.K8S_DEPLOYMENT_NAME || sanitizeKubernetesName(release.applicationName);
    const containerName = process.env.K8S_CONTAINER_NAME || sanitizeKubernetesName(release.applicationName);
    const setImage = await runCommand(kubectl, [
      "-n",
      release.namespace,
      "set",
      "image",
      `deployment/${deploymentName}`,
      `${containerName}=${release.imageRef}`,
    ]);
    const rollout = await runCommand(kubectl, [
      "-n",
      release.namespace,
      "rollout",
      "status",
      `deployment/${deploymentName}`,
      "--timeout=120s",
    ]);
    return {
      containerName,
      logs: [
        `使用 kubeconfig ${kubeconfig}`,
        commandLog(setImage),
        commandLog(rollout),
      ],
    };
  }

  private async deployStaticSite(release: ReleaseDeployment, artifact: Artifact): Promise<Partial<ReleaseDeployment> & { logs: string[] }> {
    const extraction = await extractPackageArtifact(release, artifact, "static-site");
    const root = path.resolve(process.env.STATIC_SITE_DEPLOY_ROOT ?? path.join(process.cwd(), ".codex-tmp", "static-sites"));
    const siteRoot = safeJoin(root, sanitizePathSegment(release.applicationId), release.environment);
    const versionDir = safeJoin(siteRoot, "releases", sanitizePathSegment(release.version));
    const currentDir = safeJoin(siteRoot, "current");
    await rm(versionDir, { force: true, recursive: true });
    await mkdir(path.dirname(versionDir), { recursive: true });
    await cp(extraction.extractDir, versionDir, { recursive: true });
    await rm(currentDir, { force: true, recursive: true });
    await cp(versionDir, currentDir, { recursive: true });
    await writeFile(
      safeJoin(siteRoot, "release.json"),
      JSON.stringify({
        releaseId: release.id,
        artifactId: artifact.id,
        version: release.version,
        digest: artifact.digest,
        deployedAt: new Date().toISOString(),
      }, null, 2),
      "utf8",
    );
    const entryPath = release.rolloutStrategy?.packageMode === "static_site" ? release.rolloutStrategy.policy.entryPath : "/";
    const endpoint = pathToFileUrl(safeJoin(currentDir, entryPath.replace(/^\/+/, "")));
    return {
      endpoint,
      logs: [
        ...extraction.logs,
        `静态站点发布目录 ${currentDir}`,
        `版本目录 ${versionDir}`,
        `当前入口 ${endpoint}`,
      ],
    };
  }

  private async deployServerPackage(release: ReleaseDeployment, artifact: Artifact): Promise<Partial<ReleaseDeployment> & { logs: string[] }> {
    const extraction = await extractPackageArtifact(release, artifact, "server-package");
    const root = path.resolve(process.env.SERVER_PACKAGE_DEPLOY_ROOT ?? path.join(process.cwd(), ".codex-tmp", "server-packages"));
    const serviceRoot = safeJoin(root, sanitizePathSegment(release.applicationId), release.environment);
    const releaseDir = safeJoin(serviceRoot, "releases", sanitizePathSegment(release.version));
    const currentDir = safeJoin(serviceRoot, "current");
    await rm(releaseDir, { force: true, recursive: true });
    await mkdir(path.dirname(releaseDir), { recursive: true });
    await cp(extraction.extractDir, releaseDir, { recursive: true });
    await rm(currentDir, { force: true, recursive: true });
    await cp(releaseDir, currentDir, { recursive: true });
    await writeFile(
      safeJoin(serviceRoot, "release.json"),
      JSON.stringify({
        releaseId: release.id,
        artifactId: artifact.id,
        version: release.version,
        digest: artifact.digest,
        deployedAt: new Date().toISOString(),
      }, null, 2),
      "utf8",
    );

    const logs = [
      ...extraction.logs,
      `服务包发布目录 ${currentDir}`,
      `版本目录 ${releaseDir}`,
    ];
    const activateCommand = process.env.SERVER_PACKAGE_ACTIVATE_COMMAND;
    if (activateCommand?.trim()) {
      const result = await runCommand(powershellExecutable(), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", activateCommand], {
        cwd: currentDir,
        env: {
          DEPLOY_RELEASE_DIR: currentDir,
          DEPLOY_RELEASE_ID: release.id,
          DEPLOY_ARTIFACT_DIGEST: artifact.digest,
        },
      });
      logs.push(commandLog(result));
    } else {
      logs.push("未配置 SERVER_PACKAGE_ACTIVATE_COMMAND，已完成真实解包和 current 目录切换。");
    }
    const healthcheckUrl = process.env.SERVER_PACKAGE_HEALTHCHECK_URL;
    if (healthcheckUrl?.trim()) {
      await assertHttpHealthy(healthcheckUrl);
      logs.push(`健康检查通过 ${healthcheckUrl}`);
    }
    return {
      endpoint: healthcheckUrl,
      logs,
    };
  }

  private async deployKubernetesManifest(release: ReleaseDeployment, artifact: Artifact): Promise<Partial<ReleaseDeployment> & { logs: string[] }> {
    const kubeconfig = process.env.KUBECONFIG;
    if (!kubeconfig) {
      throw new Error("Kubernetes YAML 上线缺少 KUBECONFIG，请在服务器环境配置后再选择 kubernetes_manifest");
    }
    const extraction = await extractPackageArtifact(release, artifact, "kubernetes-manifest");
    const kubectl = process.env.KUBECTL_PATH || "kubectl";
    const manifestPath = process.env.K8S_MANIFEST_PATH
      ? safeJoin(extraction.extractDir, process.env.K8S_MANIFEST_PATH)
      : extraction.extractDir;
    if (!existsSync(manifestPath)) {
      throw new Error(`Kubernetes manifest 路径不存在：${manifestPath}`);
    }
    const apply = await runCommand(kubectl, ["-n", release.namespace, "apply", "-f", manifestPath]);
    const logs = [
      ...extraction.logs,
      `使用 kubeconfig ${kubeconfig}`,
      commandLog(apply),
    ];
    if (release.rolloutStrategy?.packageMode === "kubernetes_manifest" && release.rolloutStrategy.policy.controller === "deployment") {
      const rollout = await runCommand(kubectl, [
        "-n",
        release.namespace,
        "rollout",
        "status",
        `deployment/${release.rolloutStrategy.policy.workloadName}`,
        "--timeout=120s",
      ]);
      logs.push(commandLog(rollout));
    }
    return { logs };
  }

  private async deployHelmChart(release: ReleaseDeployment, artifact: Artifact): Promise<Partial<ReleaseDeployment> & { logs: string[] }> {
    const kubeconfig = process.env.KUBECONFIG;
    if (!kubeconfig) {
      throw new Error("Helm 上线缺少 KUBECONFIG，请在服务器环境配置后再选择 helm_chart");
    }
    if (release.rolloutStrategy?.packageMode !== "helm_chart") {
      throw new Error("Helm 上线缺少 rolloutStrategy.helm_chart 配置");
    }
    const extraction = await extractPackageArtifact(release, artifact, "helm-chart");
    const policy = release.rolloutStrategy.policy;
    const helm = process.env.HELM_PATH || "helm";
    const namespace = policy.namespace ?? release.namespace;
    const chartPath = resolvePackagePath(extraction.extractDir, process.env.HELM_CHART_PATH ?? policy.chart);
    if (!existsSync(chartPath)) {
      throw new Error(`Helm chart 路径不存在：${chartPath}`);
    }
    const valuesPath = policy.valuesPath ? resolvePackagePath(extraction.extractDir, policy.valuesPath) : undefined;
    const args = [
      "upgrade",
      "--install",
      policy.releaseName,
      chartPath,
      "-n",
      namespace,
      "--create-namespace",
      ...(valuesPath && existsSync(valuesPath) ? ["-f", valuesPath] : []),
      "--wait",
      "--timeout",
      process.env.HELM_TIMEOUT ?? "120s",
    ];
    const upgrade = await runCommand(helm, args);
    const status = await runCommand(helm, ["status", policy.releaseName, "-n", namespace], { ignoreFailure: true });
    return {
      logs: [
        ...extraction.logs,
        `使用 kubeconfig ${kubeconfig}`,
        commandLog(upgrade),
        commandLog(status),
      ],
    };
  }
}

function packageModeFrom(request: DeployArtifactRequest, run: PipelineRun, artifact: Artifact): PackageMode {
  return request.rolloutStrategy?.packageMode ??
    request.packageMode ??
    run.definitionSnapshot.buildConfig?.packageMode ??
    (artifact.type === "image" ? "container_image" : "static_site");
}

function assertDeployableArtifact(packageMode: PackageMode, artifact: Artifact): void {
  if (packageMode === "container_image" && artifact.type !== "image") {
    throw new BadRequestException(`Artifact ${artifact.id} 是 ${artifact.type} 制品，当前 container_image 上线必须选择真实镜像制品`);
  }
  if (packageMode !== "container_image" && artifact.type !== "package") {
    throw new BadRequestException(`Artifact ${artifact.id} 是 ${artifact.type} 制品，${packageModeLabel(packageMode)} 上线必须选择真实构建包`);
  }
  if (!artifact.digest.startsWith("sha256:")) {
    throw new BadRequestException(`Artifact ${artifact.id} 缺少真实 sha256 digest，不能上线`);
  }
  if (packageMode !== "container_image" && !existsSync(artifact.name)) {
    throw new BadRequestException(`构建包文件不存在：${artifact.name}。请先执行真实打包流程生成可部署产物`);
  }
}

function assertTargetCompatible(packageMode: PackageMode, target: ReleaseTarget): void {
  const allowed: Record<PackageMode, ReleaseTarget[]> = {
    container_image: ["local-docker", "kubernetes"],
    static_site: ["local-filesystem"],
    server_package: ["local-filesystem"],
    kubernetes_manifest: ["kubernetes"],
    helm_chart: ["helm"],
  };
  if (!allowed[packageMode].includes(target)) {
    throw new BadRequestException(
      `${packageModeLabel(packageMode)} 不支持 ${target} 上线目标，可用目标：${allowed[packageMode].join(", ")}`,
    );
  }
}

function buildRolloutStrategy(
  request: DeployArtifactRequest,
  run: PipelineRun,
  packageMode: PackageMode,
): RolloutStrategyConfig | undefined {
  if (request.rolloutStrategy && request.rolloutStrategy.packageMode !== packageMode) {
    throw new BadRequestException(
      `灰度配置类型 ${packageModeLabel(request.rolloutStrategy.packageMode)} 与当前打包方式 ${packageModeLabel(packageMode)} 不一致`,
    );
  }

  if (request.rolloutStrategy) {
    return request.rolloutStrategy.policy.enabled ? request.rolloutStrategy : undefined;
  }

  if (!shouldEnableRollout(request, run)) return undefined;

  if (packageMode === "container_image") {
    const policy = buildContainerRolloutPolicy(request, run);
    return policy ? { packageMode, policy } : undefined;
  }
  if (packageMode === "static_site") {
    return {
      packageMode,
      policy: {
        enabled: true,
        cohorts: ["internal", "beta", "public"],
        entryPath: "/",
        cdnProvider: "aliyun-oss",
        cacheTtlSeconds: 60,
        rollbackOnFailure: true,
      },
    };
  }
  if (packageMode === "server_package") {
    return {
      packageMode,
      policy: {
        enabled: true,
        batches: [10, 25, 50, 100],
        healthCheckPath: "/health",
        instanceSelector: "role=web",
        maxUnavailable: 1,
        rollbackOnFailure: true,
      },
    };
  }
  if (packageMode === "kubernetes_manifest") {
    return {
      packageMode,
      policy: {
        enabled: true,
        controller: "deployment",
        workloadName: sanitizeKubernetesName(run.applicationName),
        steps: [10, 25, 50, 100],
        analysisWindowSeconds: 300,
        rollbackOnFailure: true,
      },
    };
  }
  return {
    packageMode,
    policy: {
      enabled: true,
      releaseName: sanitizeKubernetesName(run.applicationName),
      chart: "./chart",
      namespace: deploymentNamespace(run, request.environment ?? run.environment),
      valuesPath: "values.yaml",
      steps: [10, 25, 50, 100],
      rollbackOnFailure: true,
    },
  };
}

function shouldEnableRollout(request: DeployArtifactRequest, run: PipelineRun): boolean {
  const requestedStrategy = request.strategy ?? run.definitionSnapshot.strategy;
  const requestedPercent = request.canaryPercent ?? run.canaryPercent;
  return (
    request.rolloutPolicy?.enabled ??
    (requestedStrategy === "canary" || (requestedPercent > 0 && requestedPercent < 100))
  );
}

function buildContainerRolloutPolicy(request: DeployArtifactRequest, run: PipelineRun): CanaryRolloutPolicy | undefined {
  const requestedStrategy = request.strategy ?? run.definitionSnapshot.strategy;
  const requestedPercent = request.canaryPercent ?? run.canaryPercent;
  const enabled =
    request.rolloutPolicy?.enabled ??
    (requestedStrategy === "canary" || (requestedPercent > 0 && requestedPercent < 100));
  if (!enabled) return undefined;

  const steps = normalizeCanarySteps(
    request.rolloutPolicy?.steps ??
      (requestedPercent > 0 && requestedPercent < 100 ? [requestedPercent, 100] : [10, 25, 50, 100]),
  );
  if (steps.length <= 1 && steps[0] === 100) return undefined;

  return {
    enabled: true,
    steps,
    regions: normalizeTrafficRegions(request.rolloutPolicy?.regions),
    autoPromote: request.rolloutPolicy?.autoPromote ?? false,
    analysisWindowSeconds: request.rolloutPolicy?.analysisWindowSeconds ?? 300,
    minSuccessRate: request.rolloutPolicy?.minSuccessRate ?? 99,
    maxErrorRate: request.rolloutPolicy?.maxErrorRate ?? 1,
    maxP95LatencyMs: request.rolloutPolicy?.maxP95LatencyMs ?? 800,
    baselineTolerance: request.rolloutPolicy?.baselineTolerance,
    metricQueries: request.rolloutPolicy?.metricQueries,
    rollbackOnFailure: request.rolloutPolicy?.rollbackOnFailure ?? true,
  };
}

function canaryPolicyFromRolloutStrategy(
  strategy: RolloutStrategyConfig,
  request: DeployArtifactRequest,
): CanaryRolloutPolicy {
  if (strategy.packageMode === "container_image") {
    return {
      ...strategy.policy,
      regions: normalizeTrafficRegions(request.rolloutPolicy?.regions ?? strategy.policy.regions),
      baselineTolerance: request.rolloutPolicy?.baselineTolerance ?? strategy.policy.baselineTolerance,
      metricQueries: request.rolloutPolicy?.metricQueries ?? strategy.policy.metricQueries,
    };
  }
  const thresholds = request.rolloutPolicy;
  const steps = normalizeCanarySteps(rolloutPercentsFromStrategy(strategy));
  return {
    enabled: true,
    steps,
    regions: normalizeTrafficRegions(thresholds?.regions),
    autoPromote: thresholds?.autoPromote ?? false,
    analysisWindowSeconds:
      thresholds?.analysisWindowSeconds ??
      (strategy.packageMode === "static_site" ? Math.max(60, strategy.policy.cacheTtlSeconds) : 300),
    minSuccessRate: thresholds?.minSuccessRate ?? 99,
    maxErrorRate: thresholds?.maxErrorRate ?? 1,
    maxP95LatencyMs: thresholds?.maxP95LatencyMs ?? 800,
    baselineTolerance: thresholds?.baselineTolerance,
    metricQueries: thresholds?.metricQueries,
    rollbackOnFailure: strategy.policy.rollbackOnFailure,
  };
}

function rolloutPercentsFromStrategy(strategy: RolloutStrategyConfig): number[] {
  if (strategy.packageMode === "container_image") return strategy.policy.steps;
  if (strategy.packageMode === "static_site") {
    const count = strategy.policy.cohorts.length;
    return strategy.policy.cohorts.map((_, index) => Math.round(((index + 1) / count) * 100));
  }
  if (strategy.packageMode === "server_package") return strategy.policy.batches;
  return strategy.policy.steps;
}

function normalizeCanarySteps(values: number[]): number[] {
  const unique = Array.from(
    new Set(
      values
        .map((value) => Math.round(value))
        .filter((value) => Number.isInteger(value) && value > 0 && value <= 100),
    ),
  ).sort((a, b) => a - b);
  return unique.includes(100) ? unique : [...unique, 100];
}

function normalizeTrafficRegions(regions: CanaryTrafficRegion[] | undefined): CanaryTrafficRegion[] {
  const sanitized = (regions ?? DEFAULT_CANARY_REGIONS)
    .map((region) => ({
      id: region.id.trim(),
      name: region.name.trim(),
      percent: Math.max(0, Math.min(100, Math.round(region.percent))),
      enabled: region.enabled,
    }))
    .filter((region) => region.id.length > 0 && region.name.length > 0);
  const unique = new Map<string, CanaryTrafficRegion>();
  for (const region of sanitized) {
    unique.set(region.id, region);
  }
  return Array.from(unique.values());
}

function enabledTrafficRegions(regions: CanaryTrafficRegion[] | undefined): CanaryTrafficRegion[] {
  return normalizeTrafficRegions(regions).filter((region) => region.enabled && region.percent > 0);
}

function stepRegionTraffic(
  regions: CanaryTrafficRegion[] | undefined,
  stepPercent: number,
): CanaryRolloutStepRegion[] | undefined {
  const enabledRegions = enabledTrafficRegions(regions);
  if (enabledRegions.length === 0) return undefined;
  return enabledRegions.map((region) => ({
    ...region,
    targetPercent: region.percent,
    percent: stepPercent >= 100 ? 100 : Math.min(region.percent, stepPercent),
  }));
}

function fullRegionTraffic(regions: CanaryTrafficRegion[] | undefined): CanaryRolloutStepRegion[] | undefined {
  const enabledRegions = enabledTrafficRegions(regions);
  if (enabledRegions.length === 0) return undefined;
  return enabledRegions.map((region) => ({ ...region, targetPercent: region.percent, percent: 100 }));
}

function zeroRegionTraffic(regions: CanaryTrafficRegion[] | undefined): CanaryRolloutStepRegion[] | undefined {
  const enabledRegions = enabledTrafficRegions(regions);
  if (enabledRegions.length === 0) return undefined;
  return enabledRegions.map((region) => ({ ...region, targetPercent: region.percent, percent: 0 }));
}

function regionTrafficLabel(regions: CanaryTrafficRegion[]): string {
  const enabledRegions = enabledTrafficRegions(regions);
  if (enabledRegions.length === 0) return "未选择区域";
  return enabledRegions.map((region) => `${region.name} ${region.percent}%`).join(" / ");
}

function regionStepTrafficLabel(regions: CanaryRolloutStepRegion[]): string {
  return regions.map((region) => `${region.name} ${region.percent}%`).join(" / ");
}

function buildRolloutSteps(strategy: RolloutStrategyConfig, policy: CanaryRolloutPolicy): CanaryRolloutStep[] {
  const labels = rolloutStepLabels(strategy, policy.steps);
  const capability = rolloutCapability(strategy.packageMode);
  return policy.steps.map((percent, index) => {
    const regions = stepRegionTraffic(policy.regions, percent);
    return {
      id: `${strategy.packageMode}-${index + 1}-${percent}`,
      percent,
      status: index === 0 ? "active" : "pending",
      startedAt: index === 0 ? new Date().toISOString() : undefined,
      label: labels[index] ?? `${percent}%`,
      capability,
      regions,
      message: index === 0
        ? initialRolloutMessage(strategy, labels[index] ?? `${percent}%`, policy.analysisWindowSeconds, regions)
        : undefined,
    };
  });
}

function rolloutStepLabels(strategy: RolloutStrategyConfig, percents: number[]): string[] {
  if (strategy.packageMode === "static_site") return strategy.policy.cohorts;
  return percents.map((percent) => `${percent}%`);
}

function rolloutCapability(packageMode: PackageMode): CanaryRolloutStep["capability"] {
  if (packageMode === "static_site") return "cdn";
  if (packageMode === "server_package") return "instance";
  if (packageMode === "kubernetes_manifest") return "kubernetes";
  if (packageMode === "helm_chart") return "helm";
  return "traffic";
}

function initialRolloutMessage(
  strategy: RolloutStrategyConfig,
  label: string,
  analysisWindowSeconds: number,
  regions?: CanaryRolloutStepRegion[],
): string {
  const regionSuffix = regions?.length ? `；区域 ${regionStepTrafficLabel(regions)}` : "";
  if (strategy.packageMode === "static_site") {
    return `静态站点灰度切入 ${label} 分组${regionSuffix}，等待 CDN/OSS 缓存与访问指标观测。`;
  }
  if (strategy.packageMode === "server_package") {
    return `服务包灰度切入 ${label} 实例批次${regionSuffix}，等待 ${analysisWindowSeconds}s 健康检查。`;
  }
  if (strategy.packageMode === "kubernetes_manifest") {
    return `Kubernetes 灰度切入 ${label}${regionSuffix}，等待 ${analysisWindowSeconds}s 工作负载观测。`;
  }
  if (strategy.packageMode === "helm_chart") {
    return `Helm 灰度切入 ${label}${regionSuffix}，等待 release 状态与指标观测。`;
  }
  return `灰度切入 ${label} 流量${regionSuffix}，等待 ${analysisWindowSeconds}s 观测。`;
}

function nextCanaryStepIndex(steps: CanaryRolloutStep[], activeIndex: number, targetPercent?: number): number {
  if (targetPercent !== undefined) {
    return steps.findIndex((step, index) => index > activeIndex && step.percent >= targetPercent);
  }
  return steps.findIndex((step, index) => index > activeIndex && step.status === "pending");
}

function markActiveStep(
  steps: CanaryRolloutStep[] | undefined,
  status: CanaryRolloutStep["status"],
  message: string,
): CanaryRolloutStep[] {
  return (steps ?? []).map((step) =>
    step.status === "active" || step.status === "paused"
      ? {
          ...step,
          status,
          message,
        }
      : step,
  );
}

function mergeAnalysis(
  release: ReleaseDeployment,
  patch: ReleaseCanaryActionRequest["analysis"],
): CanaryAnalysisSnapshot {
  const policy = release.rolloutPolicy;
  const requestCount = patch?.requestCount ?? 0;
  const successRate = patch?.successRate ?? 100;
  const errorRate = patch?.errorRate ?? Math.max(0, 100 - successRate);
  const p95LatencyMs = patch?.p95LatencyMs ?? 0;
  const failed = policy
    ? successRate < policy.minSuccessRate || errorRate > policy.maxErrorRate || p95LatencyMs > policy.maxP95LatencyMs
    : false;
  return {
    status: patch?.status ?? (failed ? "failed" : "healthy"),
    sampledAt: patch?.sampledAt ?? new Date().toISOString(),
    requestCount,
    successRate,
    errorRate,
    p95LatencyMs,
    source: patch?.source ?? "client",
    message: patch?.message ?? (failed ? "指标未通过灰度门禁" : "指标通过灰度门禁"),
  };
}

function fullReleasePolicy(request: DeployArtifactRequest, run: PipelineRun): CanaryRolloutPolicy {
  return {
    enabled: false,
    steps: [100],
    regions: normalizeTrafficRegions(request.rolloutPolicy?.regions),
    autoPromote: true,
    analysisWindowSeconds: request.rolloutPolicy?.analysisWindowSeconds ?? 60,
    minSuccessRate: request.rolloutPolicy?.minSuccessRate ?? 99,
    maxErrorRate: request.rolloutPolicy?.maxErrorRate ?? 1,
    maxP95LatencyMs: request.rolloutPolicy?.maxP95LatencyMs ?? 800,
    baselineTolerance: request.rolloutPolicy?.baselineTolerance,
    metricQueries: request.rolloutPolicy?.metricQueries,
    rollbackOnFailure: request.rolloutPolicy?.rollbackOnFailure ?? (run.definitionSnapshot.targetEnvironment === "prod"),
  };
}

function trafficSnapshot(
  globalPercent: number,
  regions: CanaryRolloutStepRegion[] | undefined,
  appliedBy: string,
): TrafficSnapshot {
  return {
    globalPercent,
    regions: regions ?? [],
    appliedBy,
    appliedAt: new Date().toISOString(),
  };
}

function releaseStepsFromRolloutSteps(
  steps: CanaryRolloutStep[] | undefined,
  currentTraffic: TrafficSnapshot,
  status: ReleaseExecutionStatus = "deploying",
): ReleaseExecution["steps"] {
  if (!steps?.length) {
    const stepStatus: CanaryStepStatus = status === "success" ? "success" : status === "failed" ? "failed" : status === "rolled_back" ? "rolled_back" : "active";
    return [{
      id: "full-release-1",
      stepId: "full-release",
      percent: 100,
      status: stepStatus,
      traffic: currentTraffic,
      startedAt: currentTraffic.appliedAt,
      finishedAt: stepStatus === "success" || stepStatus === "failed" || stepStatus === "rolled_back" ? currentTraffic.appliedAt : undefined,
      message: "全量发布执行记录。",
    }];
  }
  return steps.map((step) => ({
    id: `execution-${step.id}`,
    stepId: step.id,
    percent: step.percent,
    status: step.status,
    traffic: step.status === "active" || step.status === "success"
      ? trafficSnapshot(step.percent, step.regions, currentTraffic.appliedBy)
      : undefined,
    analysis: step.analysis,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    message: step.message,
  }));
}

function releaseTargetFrom(request: DeployArtifactRequest, packageMode: PackageMode): ReleaseTarget {
  if (request.target) return request.target;
  if (packageMode === "static_site" || packageMode === "server_package") return "local-filesystem";
  if (packageMode === "helm_chart") return "helm";
  if (packageMode === "kubernetes_manifest") return "kubernetes";
  return process.env.RELEASE_DEPLOY_TARGET === "kubernetes" ? "kubernetes" : "local-docker";
}

function packageModeLabel(packageMode: PackageMode): string {
  const labels: Record<PackageMode, string> = {
    container_image: "容器镜像",
    static_site: "静态站点包",
    server_package: "服务运行包",
    kubernetes_manifest: "Kubernetes YAML",
    helm_chart: "Helm Chart",
  };
  return labels[packageMode];
}

function deploymentNamespace(run: PipelineRun, environment: EnvironmentType): string {
  const configured = [...(run.definitionSnapshot.variables ?? []), ...(run.definitionSnapshot.runtimeVariables ?? [])]
    .find((param) => param.key === "DEPLOY_NAMESPACE")?.value;
  if (configured && run.environment === environment) return configured;
  return `${sanitizeKubernetesName(run.applicationId)}-${environment}`;
}

function releaseServiceConnection(run: PipelineRun, target: ReleaseTarget): string {
  if (target === "helm") return run.definitionSnapshot.serviceConnections?.find((item) => item.includes("helm") || item.includes("ack") || item.includes("kube")) ?? "helm";
  if (target === "kubernetes") {
    return run.definitionSnapshot.serviceConnections?.find((item) => item.includes("ack") || item.includes("kube")) ?? "kubernetes";
  }
  if (target === "local-filesystem") return "local-filesystem";
  return "local-docker";
}

function defaultContainerName(run: PipelineRun, environment: EnvironmentType): string {
  return `${sanitizeKubernetesName(run.applicationId)}-${environment}`;
}

function defaultContainerNameFromRelease(release: ReleaseDeployment): string {
  return `${sanitizeKubernetesName(release.applicationId)}-${release.environment}`;
}

function artifactImageReference(artifact: Artifact): string {
  if (artifact.name.includes("@sha256:")) return artifact.name;
  const lastPathSegment = artifact.name.slice(artifact.name.lastIndexOf("/") + 1);
  if (lastPathSegment.includes(":")) return artifact.name;
  return `${artifact.name}:${artifact.version}`;
}

function dockerExecutable(): string {
  const candidates = [
    process.env.DOCKER_CLI_PATH,
    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker",
    "docker",
  ];
  return candidates.find((candidate) => candidate && (candidate === "docker" || existsSync(candidate))) ?? "docker";
}

function portFromEnv(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : fallback;
}

function endpointFromDockerPort(output: string, explicitPort?: number): string | undefined {
  if (explicitPort) return `http://localhost:${explicitPort}`;
  const port = output.match(/:(\d+)\s*$/m)?.[1] ?? output.match(/0\.0\.0\.0:(\d+)/)?.[1];
  return port ? `http://localhost:${port}` : undefined;
}

function commandLog(result: CommandResult): string {
  const output = tail(result.output.trim());
  return output ? `${result.display}\n${output}` : result.display;
}

type ExtractedArtifact = {
  artifactPath: string;
  extractDir: string;
  logs: string[];
};

async function extractPackageArtifact(release: ReleaseDeployment, artifact: Artifact, scope: string): Promise<ExtractedArtifact> {
  if (artifact.type !== "package") {
    throw new Error(`${packageModeLabel(release.packageMode ?? "server_package")} 需要 package 制品，当前制品类型是 ${artifact.type}`);
  }
  const artifactPath = path.resolve(artifact.name);
  if (!existsSync(artifactPath)) {
    throw new Error(`构建包文件不存在：${artifactPath}`);
  }
  const extractDir = path.join(
    process.cwd(),
    ".codex-tmp",
    "release-extract",
    sanitizePathSegment(scope),
    sanitizePathSegment(release.id),
  );
  await rm(extractDir, { force: true, recursive: true });
  await mkdir(extractDir, { recursive: true });
  const extract = await runCommand("tar", ["-xzf", artifactPath, "-C", extractDir]);
  return {
    artifactPath,
    extractDir,
    logs: [
      `解包制品 ${artifactPath}`,
      commandLog(extract),
    ],
  };
}

function resolvePackagePath(root: string, value: string): string {
  if (!value.trim() || value === "." || value === "./") return root;
  if (path.isAbsolute(value)) return path.resolve(value);
  return safeJoin(root, value);
}

function safeJoin(root: string, ...parts: string[]): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...parts.filter(Boolean));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`路径越界：${resolved}`);
  }
  return resolved;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "release";
}

function pathToFileUrl(value: string): string {
  const normalized = path.resolve(value).replace(/\\/g, "/");
  return `file:///${normalized.replace(/^\/+/, "")}`;
}

function powershellExecutable(): string {
  return process.env.POWERSHELL_PATH || "powershell";
}

async function assertHttpHealthy(url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`健康检查失败 ${url}: HTTP ${response.status}`);
  }
}

function runCommand(
  executable: string,
  args: string[],
  options: { ignoreFailure?: boolean; cwd?: string; env?: Record<string, string> } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const display = `${quoteDisplay(executable)} ${args.map(quoteDisplay).join(" ")}`.trim();
    const child = spawn(executable, args, {
      cwd: options.cwd ? path.resolve(options.cwd) : path.resolve(process.cwd()),
      env: { ...process.env, ...options.env },
      shell: false,
      windowsHide: true,
    });
    let output = "";
    const collect = (chunk: Buffer): void => {
      output += chunk.toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      if (options.ignoreFailure) {
        resolve({ display, output: `${output}\n${describe(error)}` });
        return;
      }
      reject(new Error(`${display}: ${describe(error)}`));
    });
    child.on("close", (code) => {
      if (code === 0 || options.ignoreFailure) {
        resolve({ display, output });
        return;
      }
      reject(new Error(`${display} exited with ${code}: ${tail(output)}`));
    });
  });
}

function quoteDisplay(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

function sanitizeKubernetesName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52);
}

function tail(value: string): string {
  return value.slice(-4_000);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
