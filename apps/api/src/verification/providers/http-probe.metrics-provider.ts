import { Injectable } from "@nestjs/common";
import type { CanaryAnalysisSnapshot } from "@deploy-management/shared";
import type { MetricsProvider, MetricsSampleInput } from "../metrics-provider.interface";
import { unknownMetricsSnapshot } from "../metrics-provider.interface";

@Injectable()
export class HttpProbeMetricsProvider implements MetricsProvider {
  readonly name = "http-probe" as const;

  async sample(input: MetricsSampleInput): Promise<CanaryAnalysisSnapshot> {
    const baseUrl = input.release.endpoint;
    if (!baseUrl) {
      return unknownMetricsSnapshot(this.name, "http-probe 缺少 release endpoint，跳过自动动作");
    }
    const probeUrl = new URL(process.env.HTTP_PROBE_PATH ?? "/healthz", baseUrl).toString();
    const startedAt = Date.now();
    try {
      const response = await fetch(probeUrl, { signal: AbortSignal.timeout(httpProbeTimeoutMs()) });
      const p95LatencyMs = Date.now() - startedAt;
      const healthy = response.ok;
      return {
        status: healthy ? "healthy" : "failed",
        sampledAt: new Date().toISOString(),
        requestCount: 1,
        successRate: healthy ? 100 : 0,
        errorRate: healthy ? 0 : 100,
        p95LatencyMs,
        source: this.name,
        message: healthy ? `http-probe ${probeUrl} 通过` : `http-probe ${probeUrl} 返回 HTTP ${response.status}`,
      };
    } catch (error) {
      return unknownMetricsSnapshot(this.name, `http-probe ${probeUrl} 失败: ${describe(error)}`);
    }
  }
}

function httpProbeTimeoutMs(): number {
  const value = Number(process.env.HTTP_PROBE_TIMEOUT_MS ?? 3000);
  return Number.isInteger(value) && value > 0 ? value : 3000;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
