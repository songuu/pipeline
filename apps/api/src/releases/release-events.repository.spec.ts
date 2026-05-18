import { rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReleaseEventsRepository } from "./release-events.repository";

const previousDataDir = process.env.DEPLOYMENT_DATA_DIR;

describe("ReleaseEventsRepository", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = path.resolve(process.cwd(), ".codex-tmp", `release-events-${Date.now()}`);
    process.env.DEPLOYMENT_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (previousDataDir === undefined) {
      delete process.env.DEPLOYMENT_DATA_DIR;
    } else {
      process.env.DEPLOYMENT_DATA_DIR = previousDataDir;
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("persists ordered events per release", async () => {
    const repo = new ReleaseEventsRepository();

    await repo.append({
      releaseId: "release-a",
      applicationId: "app-a",
      environment: "test",
      type: "deploy_started",
      message: "started",
      actor: "RO",
    });
    await repo.append({
      releaseId: "release-a",
      applicationId: "app-a",
      environment: "test",
      type: "canary_advanced",
      message: "advanced",
      actor: "RO",
      payload: { targetPercent: 20 },
    });
    await repo.append({
      releaseId: "release-b",
      applicationId: "app-b",
      environment: "prod",
      type: "deploy_started",
      message: "other release",
      actor: "SRE",
    });

    const events = repo.listForRelease("release-a");

    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events.map((event) => event.type)).toEqual(["deploy_started", "canary_advanced"]);
    expect(events[1]?.payload).toEqual({ targetPercent: 20 });
    expect(repo.snapshot()).toHaveLength(3);
  });
});
