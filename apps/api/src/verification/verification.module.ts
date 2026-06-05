import { Module } from "@nestjs/common";
import { ReleasesModule } from "../releases/releases.module";
import { CanaryWatcherService } from "./canary-watcher.service";
import { METRICS_PROVIDER, type MetricsProvider } from "./metrics-provider.interface";
import { AliyunCmsMetricsProvider } from "./providers/aliyun-cms.metrics-provider";
import { HttpProbeMetricsProvider } from "./providers/http-probe.metrics-provider";
import { PrometheusMetricsProvider } from "./providers/prometheus.metrics-provider";
import { SimulatedMetricsProvider } from "./providers/simulated.metrics-provider";

@Module({
  imports: [ReleasesModule],
  providers: [
    CanaryWatcherService,
    {
      provide: METRICS_PROVIDER,
      useFactory: (): MetricsProvider => metricsProviderFromEnv(),
    },
  ],
  exports: [CanaryWatcherService, METRICS_PROVIDER],
})
export class VerificationModule {}

function metricsProviderFromEnv(): MetricsProvider {
  const provider = process.env.METRICS_PROVIDER ?? "simulated";
  if (provider === "prometheus") return new PrometheusMetricsProvider();
  if (provider === "http-probe") return new HttpProbeMetricsProvider();
  if (provider === "aliyun-cms") return new AliyunCmsMetricsProvider();
  return new SimulatedMetricsProvider();
}
