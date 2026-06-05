import type { CanaryAnalysisSnapshot, ReleaseDeployment } from "@deploy-management/shared";

export const METRICS_PROVIDER = Symbol("METRICS_PROVIDER");

export type MetricsProviderName = CanaryAnalysisSnapshot["source"];

export type MetricsSampleInput = {
  release: ReleaseDeployment;
  stableRelease?: ReleaseDeployment;
  windowSeconds: number;
};

export interface MetricsProvider {
  readonly name: MetricsProviderName;
  sample(input: MetricsSampleInput): Promise<CanaryAnalysisSnapshot>;
}

export function unknownMetricsSnapshot(source: MetricsProviderName, message: string): CanaryAnalysisSnapshot {
  return {
    status: "unknown",
    sampledAt: new Date().toISOString(),
    requestCount: 0,
    successRate: 0,
    errorRate: 0,
    p95LatencyMs: 0,
    source,
    message,
  };
}
