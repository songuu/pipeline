import { Injectable } from "@nestjs/common";
import type { MetricsProvider, MetricsSampleInput } from "../metrics-provider.interface";
import { unknownMetricsSnapshot } from "../metrics-provider.interface";

@Injectable()
export class AliyunCmsMetricsProvider implements MetricsProvider {
  readonly name = "aliyun-cms" as const;

  async sample(_input: MetricsSampleInput) {
    return unknownMetricsSnapshot(
      this.name,
      "aliyun-cms provider 尚未接入 OpenAPI 签名客户端，当前只记录 unknown，不执行自动动作",
    );
  }
}
