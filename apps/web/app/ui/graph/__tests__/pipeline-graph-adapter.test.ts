import { describe, expect, it } from "vitest";
import type {
  LifecycleStageKey,
  PipelineDefinition,
  PipelineRun,
  PipelineStageRun,
  TektonTaskGraphNode,
} from "@deploy-management/shared";
import {
  defaultStageRunAfter,
  detectCycle,
  edgeId,
  pipelineDefinitionToGraph,
  pipelineRunToGraph,
  stageNodeId,
  tektonTaskGraphToGraph,
} from "../pipeline-graph-adapter";

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

function makeStageRun(key: LifecycleStageKey, status: PipelineStageRun["status"] = "pending"): PipelineStageRun {
  return {
    id: `stage-run-${key}`,
    key,
    title: key,
    status,
    logs: [],
    metadata: {},
  };
}

describe("pipeline-graph-adapter", () => {
  describe("linear DAG", () => {
    it("source -> build -> deploy 节点和边数量正确", () => {
      const pipeline = makePipeline(["source", "build", "deploy"]);
      const graph = pipelineDefinitionToGraph(pipeline);
      expect(graph.nodes.map((n) => n.id)).toEqual([
        stageNodeId("source"),
        stageNodeId("build"),
        stageNodeId("deploy"),
      ]);
      const edgePairs = graph.edges.map((e) => `${e.source}->${e.target}`);
      // build 默认依赖 source（即使 test 不存在）；deploy 没有 upload 所以无入边
      expect(edgePairs).toContain(`${stageNodeId("source")}->${stageNodeId("build")}`);
      // deploy 上游 upload 不存在，应当无入边到 deploy
      expect(edgePairs).not.toContain(`->${stageNodeId("deploy")}`);
    });
  });

  describe("parallel branches", () => {
    it("test + build 同时依赖 source，处于同一 x 列", () => {
      const pipeline = makePipeline(["source", "test", "build"]);
      const graph = pipelineDefinitionToGraph(pipeline);
      const test = graph.nodes.find((n) => n.id === stageNodeId("test"));
      const build = graph.nodes.find((n) => n.id === stageNodeId("build"));
      const source = graph.nodes.find((n) => n.id === stageNodeId("source"));
      expect(source!.position.x).toBeLessThan(test!.position.x);
      expect(test!.position.x).toBe(build!.position.x);
      expect(test!.position.y).not.toBe(build!.position.y);
      const ids = graph.edges.map((e) => `${e.source}->${e.target}`);
      expect(ids).toContain(`${stageNodeId("source")}->${stageNodeId("test")}`);
      expect(ids).toContain(`${stageNodeId("source")}->${stageNodeId("build")}`);
    });
  });

  describe("fan-in", () => {
    it("env 依赖 test 和 build 两个父节点", () => {
      const pipeline = makePipeline(["source", "test", "build", "env"]);
      const graph = pipelineDefinitionToGraph(pipeline);
      const incomingToEnv = graph.edges.filter((e) => e.target === stageNodeId("env"));
      const sources = incomingToEnv.map((e) => e.source).sort();
      expect(sources).toEqual([stageNodeId("build"), stageNodeId("test")].sort());
    });
  });

  describe("cycle detection", () => {
    it("循环依赖抛出含 stage 序列的错误", () => {
      const taskGraph: TektonTaskGraphNode[] = [
        { name: "source", taskRef: "s", runAfter: ["deploy"], workspaces: [], params: [], retries: 0, timeoutSeconds: 0 },
        { name: "build", taskRef: "b", runAfter: ["source"], workspaces: [], params: [], retries: 0, timeoutSeconds: 0 },
        { name: "deploy", taskRef: "d", runAfter: ["build"], workspaces: [], params: [], retries: 0, timeoutSeconds: 0 },
      ];
      expect(() => tektonTaskGraphToGraph(taskGraph)).toThrow(/cycle/i);

      const cycle = detectCycle(
        ["source", "build", "deploy"],
        new Map([
          ["source", ["deploy"]],
          ["build", ["source"]],
          ["deploy", ["build"]],
        ]),
      );
      expect(cycle).not.toBeNull();
      expect(cycle!.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("missing runAfter fallback", () => {
    it("PipelineDefinition.stages 中缺失的上游会被裁剪", () => {
      const enabled = new Set<LifecycleStageKey>(["source", "build"]);
      // env 默认依赖 test + build，但 test 不在 enabled 中
      expect(defaultStageRunAfter("env", enabled).sort()).toEqual(["build"]);
      const pipeline = makePipeline(["source", "build", "env"]);
      const graph = pipelineDefinitionToGraph(pipeline);
      const incomingToEnv = graph.edges.filter((e) => e.target === stageNodeId("env"));
      expect(incomingToEnv.map((e) => e.source)).toEqual([stageNodeId("build")]);
    });
  });

  describe("node id stability", () => {
    it("同一 PipelineDefinition 两次转换产出完全一致的节点 id 和边 id", () => {
      const pipeline = makePipeline(["source", "test", "build", "env", "deploy"]);
      const g1 = pipelineDefinitionToGraph(pipeline);
      const g2 = pipelineDefinitionToGraph(pipeline);
      expect(g1.nodes.map((n) => n.id)).toEqual(g2.nodes.map((n) => n.id));
      expect(g1.edges.map((e) => e.id)).toEqual(g2.edges.map((e) => e.id));
      const expectedIds = new Set([
        edgeId("source", "test"),
        edgeId("source", "build"),
        edgeId("test", "env"),
        edgeId("build", "env"),
      ]);
      for (const id of expectedIds) {
        expect(g1.edges.some((e) => e.id === id)).toBe(true);
      }
    });
  });

  describe("pipelineRunToGraph", () => {
    it("挂载 stage 状态和 durationMs", () => {
      const pipeline = makePipeline(["source", "build"]);
      const run: PipelineRun = {
        id: "run-1",
        pipelineId: pipeline.id,
        pipelineName: pipeline.name,
        applicationId: pipeline.applicationId,
        applicationName: "app",
        actor: "alice",
        repositoryId: pipeline.repositoryId,
        repository: pipeline.repository,
        refType: "branch",
        refName: "main",
        branch: "main",
        commit: "abc1234",
        environment: "prod",
        status: "running",
        progress: 0.5,
        canaryPercent: 0,
        createdAt: "2026-05-18T00:00:00Z",
        updatedAt: "2026-05-18T00:01:00Z",
        definitionSnapshot: pipeline,
        stages: [
          { ...makeStageRun("source", "success"), durationMs: 4200 },
          { ...makeStageRun("build", "running") },
        ],
      };
      const graph = pipelineRunToGraph(run, { commandCounts: { build: 3 } });
      const source = graph.nodes.find((n) => n.id === stageNodeId("source"));
      const build = graph.nodes.find((n) => n.id === stageNodeId("build"));
      expect(source?.data.status).toBe("success");
      expect(source?.data.durationMs).toBe(4200);
      expect(build?.data.status).toBe("running");
      expect(build?.data.commandCount).toBe(3);
    });
  });
});
