import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  localDockerRunDirsToPrune,
  withLocalDockerBuildMemoryLimit,
} from "./local-docker.executor";

describe("local-docker executor hardening helpers", () => {
  it("adds a default Node old-space cap for build commands", () => {
    const env = withLocalDockerBuildMemoryLimit({}, {});

    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=1024");
  });

  it("appends the Node old-space cap to existing Node options", () => {
    const env = withLocalDockerBuildMemoryLimit({ NODE_OPTIONS: "--trace-warnings" }, {});

    expect(env.NODE_OPTIONS).toBe("--trace-warnings --max-old-space-size=1024");
  });

  it("preserves an explicit Node old-space cap", () => {
    const env = withLocalDockerBuildMemoryLimit({ NODE_OPTIONS: "--max-old-space-size=512" }, {});

    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=512");
  });

  it("prunes old run dirs while keeping the current run and newest completed dir", () => {
    const root = path.join("C:", "work", "local-docker-runs");
    const current = path.join(root, "run-current");
    const newest = path.join(root, "run-newest");
    const old = path.join(root, "run-old");
    const oldest = path.join(root, "run-oldest");

    const prunePaths = localDockerRunDirsToPrune(
      [
        { path: old, mtimeMs: 20 },
        { path: current, mtimeMs: 40 },
        { path: oldest, mtimeMs: 10 },
        { path: newest, mtimeMs: 30 },
      ],
      2,
      current,
    );

    expect(prunePaths).toEqual([path.resolve(old), path.resolve(oldest)]);
  });
});
