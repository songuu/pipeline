import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { CanaryAnalysisSnapshot, ReleaseDeployment, ReleaseEventType } from "@deploy-management/shared";
import { ReleasesService } from "../releases/releases.service";
import { METRICS_PROVIDER, type MetricsProvider, unknownMetricsSnapshot } from "./metrics-provider.interface";

const WATCHER_ACTOR = "system:canary-watcher";

type PlannedAction = "advance" | "rollback" | "none";
type CanaryAutoActionMode = "observe-only" | "enabled";

@Injectable()
export class CanaryWatcherService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(ReleasesService) private readonly releases: ReleasesService,
    @Inject(METRICS_PROVIDER) private readonly provider: MetricsProvider,
  ) {}

  onModuleInit(): void {
    if (process.env.CANARY_WATCHER_ENABLED === "false") return;
    const intervalMs = watcherIntervalMs();
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => {
        console.error(`CanaryWatcher run failed: ${describe(error)}`);
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async runOnce(): Promise<void> {
    const canaryReleases = this.releases
      .list()
      .filter((release) => release.status === "canarying" && release.rolloutPolicy?.enabled && isAnalysisWindowReady(release));

    for (const release of canaryReleases) {
      try {
        await this.evaluateRelease(release);
      } catch (error) {
        await this.releases.recordCanaryAutomationEvent(
          release.id,
          "canary_analysis_sampled",
          `灰度 watcher 执行失败，不继续自动动作: ${describe(error)}`,
          {
            plannedAction: "none",
            mode: autoActionMode(),
            error: describe(error),
          },
          WATCHER_ACTOR,
        ).catch(() => undefined);
      }
    }
  }

  private async evaluateRelease(release: ReleaseDeployment): Promise<void> {
    const analysis = await this.sampleRelease(release);
    const plannedAction = actionFor(release, analysis);
    const mode = autoActionMode();
    const updated = await this.releases.recordCanaryAnalysis(release.id, analysis, WATCHER_ACTOR);
    await this.releases.recordCanaryAutomationEvent(
      release.id,
      "canary_analysis_sampled",
      sampledMessage(analysis, plannedAction, mode),
      {
        analysis,
        plannedAction,
        mode,
        source: analysis.source,
      },
      WATCHER_ACTOR,
    );

    if (mode !== "enabled" || plannedAction === "none") return;

    if (plannedAction === "rollback") {
      await this.releases.rollbackRelease(updated.id, {
        actor: WATCHER_ACTOR,
        reason: "指标未通过灰度门禁，自动回滚。",
        analysis,
      });
      await this.recordActionEvent(updated.id, "canary_auto_rolled_back", "灰度指标失败，已自动回滚。", analysis);
      return;
    }

    await this.releases.advanceCanary(updated.id, {
      actor: WATCHER_ACTOR,
      reason: "指标通过灰度门禁，自动推进下一批。",
      analysis,
    });
    await this.recordActionEvent(updated.id, "canary_auto_promoted", "灰度指标健康，已自动推进。", analysis);
  }

  private async sampleRelease(release: ReleaseDeployment): Promise<CanaryAnalysisSnapshot> {
    try {
      const candidate = await this.provider.sample({
        release,
        windowSeconds: release.rolloutPolicy?.analysisWindowSeconds ?? 300,
      });
      return await this.applyBaselineComparison(release, candidate);
    } catch (error) {
      return unknownMetricsSnapshot(this.provider.name, `指标采样异常: ${describe(error)}`);
    }
  }

  private async applyBaselineComparison(
    release: ReleaseDeployment,
    candidate: CanaryAnalysisSnapshot,
  ): Promise<CanaryAnalysisSnapshot> {
    const tolerance = release.rolloutPolicy?.baselineTolerance;
    if (candidate.status !== "healthy" || tolerance === undefined || !release.rollbackReleaseId) {
      return candidate;
    }
    try {
      const stableRelease = this.releases.get(release.rollbackReleaseId);
      const baseline = await this.provider.sample({
        release: {
          ...stableRelease,
          rolloutPolicy: release.rolloutPolicy,
        },
        stableRelease,
        windowSeconds: release.rolloutPolicy?.analysisWindowSeconds ?? 300,
      });
      if (baseline.status === "unknown") return candidate;
      const minimumSuccessRate = baseline.successRate - tolerance;
      if (candidate.successRate >= minimumSuccessRate) return candidate;
      return {
        ...candidate,
        status: "failed",
        message:
          `baseline comparison failed: canary successRate ${candidate.successRate} < baseline ${baseline.successRate} - tolerance ${tolerance}`,
      };
    } catch {
      return candidate;
    }
  }

  private async recordActionEvent(
    releaseId: string,
    type: Extract<ReleaseEventType, "canary_auto_promoted" | "canary_auto_rolled_back">,
    message: string,
    analysis: CanaryAnalysisSnapshot,
  ): Promise<void> {
    await this.releases.recordCanaryAutomationEvent(
      releaseId,
      type,
      message,
      { analysis, source: analysis.source },
      WATCHER_ACTOR,
    );
  }
}

function actionFor(release: ReleaseDeployment, analysis: CanaryAnalysisSnapshot): PlannedAction {
  if (analysis.status === "failed" && release.rolloutPolicy?.rollbackOnFailure) return "rollback";
  if (analysis.status === "healthy" && release.rolloutPolicy?.autoPromote) return "advance";
  return "none";
}

function sampledMessage(
  analysis: CanaryAnalysisSnapshot,
  plannedAction: PlannedAction,
  mode: CanaryAutoActionMode,
): string {
  if (analysis.status === "unknown") {
    return "灰度采样 unknown，不执行自动动作。";
  }
  if (mode === "observe-only" && plannedAction !== "none") {
    return `灰度采样 ${analysis.status}，observe-only 只记录 plannedAction=${plannedAction}。`;
  }
  if (plannedAction === "rollback") return "灰度采样 failed，准备自动回滚。";
  if (plannedAction === "advance") return "灰度采样 healthy，准备自动推进。";
  return `灰度采样 ${analysis.status}，不需要自动动作。`;
}

function isAnalysisWindowReady(release: ReleaseDeployment): boolean {
  const step = release.rolloutSteps?.find((item) => item.status === "active");
  if (!step) return false;
  const anchor = step.analysis?.sampledAt ?? step.startedAt ?? release.updatedAt;
  const anchorMs = Date.parse(anchor);
  if (!Number.isFinite(anchorMs)) return true;
  const windowMs = (release.rolloutPolicy?.analysisWindowSeconds ?? 300) * 1000;
  return Date.now() - anchorMs >= windowMs;
}

function autoActionMode(): CanaryAutoActionMode {
  return process.env.CANARY_AUTO_ACTION === "enabled" ? "enabled" : "observe-only";
}

function watcherIntervalMs(): number {
  const value = Number(process.env.CANARY_WATCHER_INTERVAL_MS ?? 30_000);
  return Number.isInteger(value) && value >= 1000 ? value : 30_000;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
