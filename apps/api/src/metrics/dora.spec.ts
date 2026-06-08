import { describe, expect, it } from "vitest";
import type { Artifact, ReleaseEvent, ReleaseEventType } from "@deploy-management/shared";
import { computeDora } from "./dora.service";

const HOUR = 3_600_000;

const NOW = new Date("2026-06-08T12:00:00.000Z");

let sequence = 0;
const makeEvent = (overrides: Partial<ReleaseEvent> & { type: ReleaseEventType; createdAt: string }): ReleaseEvent => ({
  id: `event-${(sequence += 1)}`,
  releaseId: overrides.releaseId ?? `release-${sequence}`,
  applicationId: overrides.applicationId ?? "app-a",
  environment: overrides.environment ?? "prod",
  message: overrides.message ?? "",
  actor: overrides.actor ?? "RO",
  sequence,
  payload: overrides.payload ?? {},
  ...overrides,
});

const makeArtifact = (id: string, uploadedAt: string): Artifact => ({
  id,
  runId: `run-${id}`,
  name: id,
  version: "1.0.0",
  type: "image",
  digest: `sha256:${id}`,
  size: "10MB",
  signed: false,
  uploadedAt,
});

// 共用数据集（窗口 2026-06-01T12:00 ~ 2026-06-08T12:00）
const artifacts: Artifact[] = [
  makeArtifact("art-1", "2026-06-05T00:00:00.000Z"),
  makeArtifact("art-2", "2026-06-06T00:00:00.000Z"),
];

const events: ReleaseEvent[] = [
  // 窗口外，应被排除
  makeEvent({ type: "deploy_succeeded", createdAt: "2026-05-01T00:00:00.000Z", applicationId: "app-a", environment: "prod", artifactId: "art-1" }),
  // s1: app-a/prod，artifact art-1 → leadtime 2h
  makeEvent({ type: "deploy_succeeded", createdAt: "2026-06-05T02:00:00.000Z", applicationId: "app-a", environment: "prod", artifactId: "art-1" }),
  // f1: app-a/prod 失败
  makeEvent({ type: "deploy_failed", createdAt: "2026-06-05T01:00:00.000Z", applicationId: "app-a", environment: "prod" }),
  // r1: app-a/prod 回滚 → 后继恢复是 s2
  makeEvent({ type: "release_rolled_back", createdAt: "2026-06-05T03:00:00.000Z", applicationId: "app-a", environment: "prod" }),
  // s2: app-a/prod，artifact art-2 → leadtime 4h
  makeEvent({ type: "deploy_succeeded", createdAt: "2026-06-06T04:00:00.000Z", applicationId: "app-a", environment: "prod", artifactId: "art-2" }),
  // s3: app-b/test，无 artifactId → 前置时间 unmatched
  makeEvent({ type: "deploy_succeeded", createdAt: "2026-06-07T00:00:00.000Z", applicationId: "app-b", environment: "test" }),
  // r2: app-b/test 回滚 → 无后继恢复 → mttr unresolved
  makeEvent({ type: "release_rolled_back", createdAt: "2026-06-07T06:00:00.000Z", applicationId: "app-b", environment: "test" }),
];

describe("computeDora", () => {
  it("部署频率 = 窗口内成功部署数 / 天数（排除窗口外事件）", () => {
    const result = computeDora(events, artifacts, { windowDays: 7 }, NOW);
    expect(result.totalDeployments).toBe(3); // s1/s2/s3，窗口外那条被排除
    expect(result.deploymentFrequencyPerDay).toBeCloseTo(3 / 7, 10);
  });

  it("变更前置时间 = median(deploy_succeeded − artifact.uploadedAt)，缺 artifact 计 unmatched", () => {
    const result = computeDora(events, artifacts, { windowDays: 7 }, NOW);
    // leadTimes = [2h, 4h] → median 3h
    expect(result.leadTimeForChangesMs).toBe(3 * HOUR);
    expect(result.sampleSizes.leadTimeMatched).toBe(2);
    expect(result.sampleSizes.leadTimeUnmatched).toBe(1); // s3 无 artifactId
  });

  it("变更失败率 = (failed + rolled_back) / (succeeded + failed)", () => {
    const result = computeDora(events, artifacts, { windowDays: 7 }, NOW);
    // (1 failed + 2 rolledBack) / (3 succeeded + 1 failed) = 3/4
    expect(result.changeFailureRate).toBeCloseTo(3 / 4, 10);
    expect(result.sampleSizes).toMatchObject({ succeeded: 3, failed: 1, rolledBack: 2 });
  });

  it("恢复时间 = median(rolled_back → 同 (env,app) 下一个 succeeded)，无后继计 unresolved", () => {
    const result = computeDora(events, artifacts, { windowDays: 7 }, NOW);
    // r1(06-05 03:00, app-a/prod) → s2(06-06 04:00) = 25h；r2(app-b/test) 无后继
    expect(result.timeToRestoreMs).toBe(25 * HOUR);
    expect(result.sampleSizes.mttrResolved).toBe(1);
    expect(result.sampleSizes.mttrUnresolved).toBe(1);
  });

  it("趋势按 UTC 日分桶，覆盖整窗口（含 0 值日）", () => {
    const result = computeDora(events, artifacts, { windowDays: 7 }, NOW);
    expect(result.trend).toHaveLength(8); // 06-01..06-08
    const june5 = result.trend.find((point) => point.date === "2026-06-05");
    expect(june5).toEqual({ date: "2026-06-05", deployments: 1, failures: 2 }); // s1 + (f1,r1)
    const june7 = result.trend.find((point) => point.date === "2026-06-07");
    expect(june7).toEqual({ date: "2026-06-07", deployments: 1, failures: 1 }); // s3 + r2
  });

  it("environment 过滤只统计指定环境", () => {
    const result = computeDora(events, artifacts, { windowDays: 7, environment: "prod" }, NOW);
    expect(result.environment).toBe("prod");
    expect(result.totalDeployments).toBe(2); // s1/s2，s3 是 test
    expect(result.changeFailureRate).toBeCloseTo((1 + 1) / (2 + 1), 10); // f1 + r1 over s1+s2+f1
  });

  it("applicationId 过滤只统计指定应用", () => {
    const result = computeDora(events, artifacts, { windowDays: 7, applicationId: "app-b" }, NOW);
    expect(result.applicationId).toBe("app-b");
    expect(result.totalDeployments).toBe(1); // 仅 s3
    expect(result.sampleSizes.rolledBack).toBe(1); // r2
  });

  it("空数据不崩：四指标安全降级，趋势全 0", () => {
    const result = computeDora([], [], { windowDays: 7 }, NOW);
    expect(result.totalDeployments).toBe(0);
    expect(result.deploymentFrequencyPerDay).toBe(0);
    expect(result.leadTimeForChangesMs).toBeNull();
    expect(result.changeFailureRate).toBe(0);
    expect(result.timeToRestoreMs).toBeNull();
    expect(result.trend.every((point) => point.deployments === 0 && point.failures === 0)).toBe(true);
  });
});
