import { describe, expect, it } from "vitest";
import type { PipelineRun } from "@deploy-management/shared";
import { runStateNoteFor } from "./pipeline-run-detail";

function makeQueuedRun(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: "run-1",
    pipelineId: "pipeline-1",
    pipelineName: "demo-release",
    applicationId: "app-1",
    applicationName: "demo",
    actor: "RO",
    repositoryId: "repo-1",
    repository: "https://example.com/demo.git",
    refType: "branch",
    refName: "main",
    branch: "main",
    commit: "abcdef1",
    environment: "test",
    status: "queued",
    progress: 0,
    canaryPercent: 0,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    definitionSnapshot: {
      id: "pipeline-1",
      name: "demo-release",
      applicationId: "app-1",
      repositoryId: "repo-1",
      repository: "https://example.com/demo.git",
      defaultBranch: "main",
      defaultRefType: "branch",
      defaultRef: "main",
      sourcePolicy: {
        allowedBranchPatterns: ["*"],
        allowedTagPatterns: ["*"],
        allowRuntimeBranch: true,
        allowRuntimeTag: true,
        allowRuntimeCommit: false,
      },
      targetEnvironment: "test",
      strategy: "rolling",
      canaryPercent: 0,
      requiresApproval: false,
      stages: ["source"],
      triggers: ["manual"],
      owner: "team",
    },
    stages: [
      {
        id: "stage-source",
        key: "source",
        title: "拉取代码",
        status: "pending",
        logs: [],
        metadata: {},
      },
    ],
    ...overrides,
  };
}

describe("runStateNoteFor", () => {
  it("uses local-docker startup wording for queued runs", () => {
    const run = makeQueuedRun({ executor: { backend: "local-docker", runId: "run-1" } });

    expect(runStateNoteFor(run, "local-docker")).toBe("等待 local-docker 执行器启动");
  });

  it("uses single-flight wording for local-docker gated runs", () => {
    const run = makeQueuedRun({
      executor: { backend: "local-docker", runId: "run-1" },
      stages: [
        {
          id: "stage-source",
          key: "source",
          title: "拉取代码",
          status: "pending",
          logs: ["等待本机单飞闸：当前已有 local-docker run 在执行，释放后将自动启动。"],
          metadata: { localDockerGate: "waiting" },
        },
      ],
    });

    expect(runStateNoteFor(run, "local-docker")).toBe("等待本机单飞闸释放");
  });

  it("keeps approval or runner capacity wording for tekton queued runs", () => {
    const run = makeQueuedRun({ executor: { backend: "tekton", runId: "run-1" } });

    expect(runStateNoteFor(run, "tekton")).toBe("等待审批或 Runner 容量");
  });
});
