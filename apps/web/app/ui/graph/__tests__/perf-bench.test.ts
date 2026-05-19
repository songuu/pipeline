import { describe, expect, it } from "vitest";
import type { LifecycleStageKey, PipelineDefinition } from "@deploy-management/shared";
import { pipelineDefinitionToGraph } from "../pipeline-graph-adapter";

function makePipeline(stages: LifecycleStageKey[]): PipelineDefinition {
  return {
    id: "pl-perf",
    name: "perf-pipeline",
    applicationId: "app-1",
    repositoryId: "repo-1",
    repository: "git@example.com:perf.git",
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

describe("perf benchmark", () => {
  it("10 stages 转换稳定 (< 5ms on commodity CI)", () => {
    const pipeline = makePipeline([
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
    ]);
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      pipelineDefinitionToGraph(pipeline);
    }
    const elapsed = performance.now() - start;
    // 50 次 * 10 节点 应远小于 50ms 上限
    expect(elapsed).toBeLessThan(50);
  });

  it("满 10 stages graph 节点和边数量预期", () => {
    const pipeline = makePipeline([
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
    ]);
    const graph = pipelineDefinitionToGraph(pipeline);
    expect(graph.nodes).toHaveLength(10);
    // 边数: source->test, source->build, test->env, build->env, env->package,
    //       package->upload, upload->deploy, deploy->canary, canary->approval, approval->promote
    expect(graph.edges).toHaveLength(10);
  });
});
