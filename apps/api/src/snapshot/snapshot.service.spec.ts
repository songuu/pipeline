import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  GlobalParam,
  LifecycleStageKey,
  PipelineDefinition,
  TektonWorkspaceBinding,
} from "@deploy-management/shared";
import {
  DEFAULT_STAGE_DAG,
  buildTaskGraph,
  conditionForRunStatus,
  resolveStageRunAfter,
} from "./snapshot.service";

const TEKTON_GO_PATH = resolve(__dirname, "../../../../services/tekton-bridge/internal/backend/tekton.go");

function parseGoDefaultStageDAG(source: string): Record<string, string[]> {
  const blockStart = source.indexOf("var defaultStageDAG = map[string][]string{");
  if (blockStart < 0) throw new Error("defaultStageDAG block not found in tekton.go");
  const blockEnd = source.indexOf("\n}", blockStart);
  if (blockEnd < 0) throw new Error("defaultStageDAG block terminator not found");
  const body = source.slice(blockStart, blockEnd);
  const dag: Record<string, string[]> = {};
  const entryRe = /"([a-z]+)":\s*(?:nil|\{([^}]*)\})/g;
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(body)) !== null) {
    const stage = match[1];
    const deps = match[2]
      ? match[2]
          .split(",")
          .map((part) => part.trim().replace(/"/g, ""))
          .filter((part) => part.length > 0)
      : [];
    dag[stage] = deps;
  }
  return dag;
}

function makePipeline(stages: LifecycleStageKey[]): PipelineDefinition {
  return {
    id: "pl-test",
    name: "test-pipeline",
    applicationId: "app-1",
    repositoryId: "repo-1",
    repository: "git@example.com:test.git",
    defaultBranch: "main",
    defaultRefType: "branch",
    defaultRef: "main",
    sourcePolicy: {
      allowedBranchPatterns: ["main"],
      allowedTagPatterns: [],
      allowRuntimeBranch: true,
      allowRuntimeTag: false,
      allowRuntimeCommit: false,
    },
    targetEnvironment: "prod",
    strategy: "rolling",
    canaryPercent: 0,
    requiresApproval: false,
    stages,
    triggers: [],
    owner: "team",
  };
}

describe("buildTaskGraph DAG semantics", () => {
  it("env fans in from test and build (parallel branch + fan-in)", () => {
    const pipeline = makePipeline(["source", "test", "build", "env"]);
    const params: GlobalParam[] = [];
    const workspaces: TektonWorkspaceBinding[] = [];
    const graph = buildTaskGraph(pipeline, params, workspaces);

    const env = graph.find((node) => node.name === "env");
    expect(env).toBeDefined();
    expect(env!.runAfter.slice().sort()).toEqual(["build", "test"]);

    const test = graph.find((node) => node.name === "test");
    const build = graph.find((node) => node.name === "build");
    expect(test!.runAfter).toEqual(["source"]);
    expect(build!.runAfter).toEqual(["source"]);
  });

  it("source has no runAfter", () => {
    const pipeline = makePipeline(["source", "build"]);
    const graph = buildTaskGraph(pipeline, [], []);
    expect(graph.find((n) => n.name === "source")!.runAfter).toEqual([]);
  });

  it("missing upstream stages are filtered out (e.g. env without test)", () => {
    const pipeline = makePipeline(["source", "build", "env"]);
    const graph = buildTaskGraph(pipeline, [], []);
    const env = graph.find((n) => n.name === "env");
    expect(env!.runAfter).toEqual(["build"]);
  });

  it("full release chain has upload->deploy->canary->approval->promote serial dependency", () => {
    const pipeline = makePipeline([
      "source",
      "build",
      "package",
      "upload",
      "deploy",
      "canary",
      "approval",
      "promote",
    ]);
    const graph = buildTaskGraph(pipeline, [], []);
    expect(graph.find((n) => n.name === "deploy")!.runAfter).toEqual(["upload"]);
    expect(graph.find((n) => n.name === "canary")!.runAfter).toEqual(["deploy"]);
    expect(graph.find((n) => n.name === "approval")!.runAfter).toEqual(["canary"]);
    expect(graph.find((n) => n.name === "promote")!.runAfter).toEqual(["approval"]);
  });

  it("DEFAULT_STAGE_DAG covers all 10 lifecycle stages", () => {
    const keys: LifecycleStageKey[] = [
      "source",
      "test",
      "build",
      "env",
      "package",
      "upload",
      "deploy",
      "canary",
      "approval",
      "promote",
    ];
    for (const key of keys) {
      expect(DEFAULT_STAGE_DAG[key]).toBeDefined();
    }
  });

  it("resolveStageRunAfter filters disabled deps", () => {
    expect(resolveStageRunAfter("env", new Set(["build"]))).toEqual(["build"]);
    expect(resolveStageRunAfter("env", new Set(["test", "build"]))).toEqual(["test", "build"]);
    expect(resolveStageRunAfter("source", new Set(["source"]))).toEqual([]);
  });

  it("TS DEFAULT_STAGE_DAG 与 Go tekton.go defaultStageDAG 完全同步", () => {
    const goSource = readFileSync(TEKTON_GO_PATH, "utf-8");
    const goDag = parseGoDefaultStageDAG(goSource);
    const tsKeys = Object.keys(DEFAULT_STAGE_DAG).sort();
    const goKeys = Object.keys(goDag).sort();
    expect(goKeys).toEqual(tsKeys);
    for (const stage of tsKeys) {
      const tsDeps = [...DEFAULT_STAGE_DAG[stage as LifecycleStageKey]].sort();
      const goDeps = [...goDag[stage]].sort();
      expect(goDeps, `stage ${stage} dependency mismatch`).toEqual(tsDeps);
    }
  });
});

describe("conditionForRunStatus", () => {
  it("uses local-docker queued wording instead of approval or runner capacity", () => {
    const condition = conditionForRunStatus("QUEUED", "local-docker");

    expect(condition).toEqual({
      reason: "Pending",
      message: "PipelineRun is waiting for local-docker executor startup",
    });
    expect(condition.message).not.toContain("approval");
    expect(condition.message).not.toContain("runner capacity");
  });

  it("keeps generic queued wording for tekton", () => {
    expect(conditionForRunStatus("QUEUED", "tekton")).toEqual({
      reason: "Pending",
      message: "PipelineRun is waiting for approval or runner capacity",
    });
  });
});
