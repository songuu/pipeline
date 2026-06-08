import { describe, expect, it, vi } from "vitest";
import type { DoraMetrics, DoraQuery } from "@deploy-management/shared";
import { DoraController } from "./dora.controller";
import type { DoraService } from "./dora.service";
import { doraQuerySchema } from "./dto/dora-query.dto";

const fakeMetrics = { totalDeployments: 0 } as unknown as DoraMetrics;

const makeController = () => {
  const compute = vi.fn<(query: DoraQuery) => DoraMetrics>(() => fakeMetrics);
  const service = { compute } as unknown as DoraService;
  return { controller: new DoraController(service), compute };
};

describe("doraQuerySchema", () => {
  it("window 缺省为 7，coerce 字符串为数字", () => {
    expect(doraQuerySchema.parse({})).toMatchObject({ window: 7 });
    expect(doraQuerySchema.parse({ window: "30" })).toMatchObject({ window: 30 });
  });

  it("拒绝越界 window 与非法 environment", () => {
    expect(doraQuerySchema.safeParse({ window: 0 }).success).toBe(false);
    expect(doraQuerySchema.safeParse({ window: 999 }).success).toBe(false);
    expect(doraQuerySchema.safeParse({ environment: "preprod" }).success).toBe(false);
  });
});

describe("DoraController", () => {
  it("legacy 路由直接返回 DoraMetrics，window → windowDays", () => {
    const { controller, compute } = makeController();
    const result = controller.legacyDora({ window: 14, environment: "prod" });
    expect(result).toBe(fakeMetrics);
    expect(compute).toHaveBeenCalledWith({ windowDays: 14, environment: "prod" });
  });

  it("oapi 路由包 ApiResponse 信封", () => {
    const { controller, compute } = makeController();
    const result = controller.yunxiaoDora({ window: 7 });
    expect(result).toEqual({ success: true, data: fakeMetrics });
    expect(compute).toHaveBeenCalledWith({ windowDays: 7 });
  });
});
