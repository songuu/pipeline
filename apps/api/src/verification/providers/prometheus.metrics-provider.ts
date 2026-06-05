import { Injectable } from "@nestjs/common";
import type { CanaryAnalysisSnapshot } from "@deploy-management/shared";
import type { MetricsProvider, MetricsSampleInput } from "../metrics-provider.interface";
import { unknownMetricsSnapshot } from "../metrics-provider.interface";

@Injectable()
export class PrometheusMetricsProvider implements MetricsProvider {
  readonly name = "prometheus" as const;

  async sample(input: MetricsSampleInput): Promise<CanaryAnalysisSnapshot> {
    const baseUrl = process.env.PROMETHEUS_BASE_URL?.replace(/\/+$/, "");
    const queries = input.release.rolloutPolicy?.metricQueries;
    if (!baseUrl) {
      return unknownMetricsSnapshot(this.name, "PROMETHEUS_BASE_URL 未配置，跳过自动动作");
    }
    if (!queries?.successRate || !queries.errorRate || !queries.p95LatencyMs) {
      return unknownMetricsSnapshot(this.name, "Prometheus metricQueries 不完整，跳过自动动作");
    }

    try {
      const [successRate, errorRate, p95LatencyMs] = await Promise.all([
        queryPrometheus(baseUrl, queries.successRate),
        queryPrometheus(baseUrl, queries.errorRate),
        queryPrometheus(baseUrl, queries.p95LatencyMs),
      ]);
      const policy = input.release.rolloutPolicy;
      const failed = policy
        ? successRate < policy.minSuccessRate || errorRate > policy.maxErrorRate || p95LatencyMs > policy.maxP95LatencyMs
        : false;
      return {
        status: failed ? "failed" : "healthy",
        sampledAt: new Date().toISOString(),
        requestCount: 0,
        successRate,
        errorRate,
        p95LatencyMs,
        source: this.name,
        message: failed ? "Prometheus 指标未通过灰度门禁" : "Prometheus 指标通过灰度门禁",
      };
    } catch (error) {
      return unknownMetricsSnapshot(this.name, `Prometheus 查询失败: ${describe(error)}`);
    }
  }
}

async function queryPrometheus(baseUrl: string, query: string): Promise<number> {
  const url = new URL(`${baseUrl}/api/v1/query`);
  url.searchParams.set("query", query);
  const response = await fetch(url, { signal: AbortSignal.timeout(prometheusTimeoutMs()) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = await response.json() as PrometheusQueryResponse;
  const value = Number(payload.data?.result?.[0]?.value?.[1]);
  if (!Number.isFinite(value)) {
    throw new Error("Prometheus 响应缺少数值结果");
  }
  return value;
}

type PrometheusQueryResponse = {
  data?: {
    result?: Array<{
      value?: [number, string];
    }>;
  };
};

function prometheusTimeoutMs(): number {
  const value = Number(process.env.PROMETHEUS_TIMEOUT_MS ?? 3000);
  return Number.isInteger(value) && value > 0 ? value : 3000;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
