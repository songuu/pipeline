import { Injectable } from "@nestjs/common";
import type {
  Artifact,
  DoraMetrics,
  DoraQuery,
  DoraTrendPoint,
  ReleaseEvent,
} from "@deploy-management/shared";
import { ArtifactsRepository } from "../artifacts/artifacts.repository";
import { ReleaseEventsRepository } from "../releases/release-events.repository";

const DAY_MS = 86_400_000;

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
};

/** UTC 日键 YYYY-MM-DD */
const utcDayKey = (iso: string): string => iso.slice(0, 10);

/** 列出 [from, to] 覆盖的所有 UTC 日键（升序，含端点） */
const enumerateDayKeys = (fromMs: number, toMs: number): string[] => {
  const keys: string[] = [];
  const start = Date.UTC(
    new Date(fromMs).getUTCFullYear(),
    new Date(fromMs).getUTCMonth(),
    new Date(fromMs).getUTCDate(),
  );
  for (let cursor = start; cursor <= toMs; cursor += DAY_MS) {
    keys.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return keys;
};

/**
 * DORA 四指标纯函数聚合。所有时间用 ISO8601(UTC) 字符串，median 取中位数抗离群。
 * 入参 now 显式注入以保证可测试与确定性（控制器传当前时刻）。
 */
export function computeDora(
  events: readonly ReleaseEvent[],
  artifacts: readonly Artifact[],
  query: DoraQuery,
  now: Date,
): DoraMetrics {
  const toMs = now.getTime();
  const days = Math.max(1, Math.trunc(query.windowDays));
  const fromMs = toMs - days * DAY_MS;
  const fromIso = new Date(fromMs).toISOString();
  const toIso = now.toISOString();

  const inWindow = events.filter((event) => {
    const ts = Date.parse(event.createdAt);
    if (Number.isNaN(ts) || ts < fromMs || ts > toMs) return false;
    if (query.environment && event.environment !== query.environment) return false;
    if (query.applicationId && event.applicationId !== query.applicationId) return false;
    return true;
  });

  const succeeded = inWindow.filter((event) => event.type === "deploy_succeeded");
  const failed = inWindow.filter((event) => event.type === "deploy_failed");
  const rolledBack = inWindow.filter((event) => event.type === "release_rolled_back");

  // 部署频率
  const deploymentFrequencyPerDay = succeeded.length / days;

  // 变更前置时间：deploy_succeeded.createdAt − 关联 artifact.uploadedAt
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const leadTimes: number[] = [];
  let leadTimeUnmatched = 0;
  for (const event of succeeded) {
    const artifact = event.artifactId ? artifactById.get(event.artifactId) : undefined;
    const uploadedMs = artifact ? Date.parse(artifact.uploadedAt) : Number.NaN;
    const deployedMs = Date.parse(event.createdAt);
    if (artifact && !Number.isNaN(uploadedMs) && deployedMs >= uploadedMs) {
      leadTimes.push(deployedMs - uploadedMs);
    } else {
      leadTimeUnmatched += 1;
    }
  }

  // 变更失败率
  const failureCount = failed.length + rolledBack.length;
  const attemptCount = succeeded.length + failed.length;
  const changeFailureRate = attemptCount === 0 ? 0 : failureCount / attemptCount;

  // 恢复时间：每个 rolled_back → 同 (env, app) 其后第一个 deploy_succeeded
  const ascendingSucceeded = [...succeeded].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
  const restoreTimes: number[] = [];
  let mttrUnresolved = 0;
  for (const incident of rolledBack) {
    const incidentMs = Date.parse(incident.createdAt);
    const recovery = ascendingSucceeded.find(
      (event) =>
        event.environment === incident.environment &&
        event.applicationId === incident.applicationId &&
        Date.parse(event.createdAt) > incidentMs,
    );
    if (recovery) {
      restoreTimes.push(Date.parse(recovery.createdAt) - incidentMs);
    } else {
      mttrUnresolved += 1;
    }
  }

  // 趋势：按 UTC 日分桶
  const trendByDay = new Map<string, DoraTrendPoint>();
  for (const key of enumerateDayKeys(fromMs, toMs)) {
    trendByDay.set(key, { date: key, deployments: 0, failures: 0 });
  }
  for (const event of succeeded) {
    const point = trendByDay.get(utcDayKey(event.createdAt));
    if (point) point.deployments += 1;
  }
  for (const event of [...failed, ...rolledBack]) {
    const point = trendByDay.get(utcDayKey(event.createdAt));
    if (point) point.failures += 1;
  }
  const trend = [...trendByDay.values()].sort((left, right) => left.date.localeCompare(right.date));

  return {
    window: { days, from: fromIso, to: toIso },
    ...(query.environment ? { environment: query.environment } : {}),
    ...(query.applicationId ? { applicationId: query.applicationId } : {}),
    deploymentFrequencyPerDay,
    totalDeployments: succeeded.length,
    leadTimeForChangesMs: median(leadTimes),
    changeFailureRate,
    timeToRestoreMs: median(restoreTimes),
    sampleSizes: {
      succeeded: succeeded.length,
      failed: failed.length,
      rolledBack: rolledBack.length,
      leadTimeMatched: leadTimes.length,
      leadTimeUnmatched,
      mttrResolved: restoreTimes.length,
      mttrUnresolved,
    },
    trend,
  };
}

@Injectable()
export class DoraService {
  constructor(
    private readonly events: ReleaseEventsRepository,
    private readonly artifacts: ArtifactsRepository,
  ) {}

  compute(query: DoraQuery, now: Date = new Date()): DoraMetrics {
    return computeDora(this.events.listAll(), this.artifacts.snapshot(), query, now);
  }
}
