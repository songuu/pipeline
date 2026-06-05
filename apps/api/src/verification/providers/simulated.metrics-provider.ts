import { Injectable } from "@nestjs/common";
import type { CanaryAnalysisSnapshot } from "@deploy-management/shared";
import type { MetricsProvider, MetricsSampleInput } from "../metrics-provider.interface";

@Injectable()
export class SimulatedMetricsProvider implements MetricsProvider {
  readonly name = "simulated" as const;

  async sample(input: MetricsSampleInput): Promise<CanaryAnalysisSnapshot> {
    const policy = input.release.rolloutPolicy;
    const successRate = Number(process.env.SIMULATED_SUCCESS_RATE ?? 99.9);
    const errorRate = Number(process.env.SIMULATED_ERROR_RATE ?? Math.max(0, 100 - successRate));
    const p95LatencyMs = Number(process.env.SIMULATED_P95_LATENCY_MS ?? 200);
    const requestCount = Number(process.env.SIMULATED_REQUEST_COUNT ?? 100);
    const failed = policy
      ? successRate < policy.minSuccessRate || errorRate > policy.maxErrorRate || p95LatencyMs > policy.maxP95LatencyMs
      : false;
    return {
      status: failed ? "failed" : "healthy",
      sampledAt: new Date().toISOString(),
      requestCount,
      successRate,
      errorRate,
      p95LatencyMs,
      source: this.name,
      message: failed ? "simulated 指标未通过灰度门禁" : "simulated 指标通过灰度门禁",
    };
  }
}
