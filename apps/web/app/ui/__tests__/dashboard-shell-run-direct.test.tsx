// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PipelineDefinition, PipelineRun, PlatformSnapshot } from "@deploy-management/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardShell } from "../dashboard-shell";
import { triggerPipeline } from "../../lib/actions";

const push = vi.fn();
const reload = vi.fn(async () => undefined);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSelectedLayoutSegments: () => [],
}));

vi.mock("../../lib/snapshot-context", () => ({
  useSnapshot: () => ({
    snapshot,
    loading: false,
    error: "",
    reload,
  }),
}));

vi.mock("../../lib/actions", async () => {
  const actual = await vi.importActual<typeof import("../../lib/actions")>("../../lib/actions");
  return {
    ...actual,
    triggerPipeline: vi.fn(async () => directRun),
  };
});

vi.mock("../sections/pipeline-list", () => ({
  PipelineList: ({ snapshot, onRunPipeline }: { snapshot: PlatformSnapshot; onRunPipeline: (pipeline: PipelineDefinition) => void }) => (
    <button onClick={() => onRunPipeline(snapshot.pipelines[0]!)}>list run</button>
  ),
}));

vi.mock("../sections/pipeline-run-detail", () => ({
  PipelineRunDetail: ({ onRun }: { onRun: () => void }) => (
    <button onClick={onRun}>detail run</button>
  ),
}));

vi.mock("../sections/run-launch-dialog", () => ({
  RunLaunchDialog: () => <div>Run Pipeline</div>,
}));

const pipeline: PipelineDefinition = {
  id: "pipeline-1",
  name: "tiangqi-app-test-release",
  applicationId: "app-1",
  repositoryId: "repo-1",
  repository: "https://gitcode.com/tianli_brain/tbcr-admin.git",
  defaultBranch: "dev",
  defaultRefType: "branch",
  defaultRef: "dev",
  sourcePolicy: {
    allowedBranchPatterns: ["*"],
    allowedTagPatterns: ["*"],
    allowRuntimeBranch: true,
    allowRuntimeTag: true,
    allowRuntimeCommit: false,
  },
  targetEnvironment: "test",
  strategy: "rolling",
  canaryPercent: 100,
  requiresApproval: false,
  stages: ["source", "test", "build", "env", "upload", "deploy"],
  triggers: ["manual"],
  owner: "前端团队",
};

const directRun: PipelineRun = {
  id: "run-direct",
  pipelineId: pipeline.id,
  pipelineName: pipeline.name,
  applicationId: pipeline.applicationId,
  applicationName: "tiangqi-app",
  actor: "RO",
  repositoryId: pipeline.repositoryId,
  repository: pipeline.repository,
  refType: "branch",
  refName: "dev",
  branch: "dev",
  commit: "abcdef1",
  environment: "test",
  status: "queued",
  progress: 0,
  canaryPercent: 100,
  createdAt: "2026-06-09T09:00:00.000Z",
  updatedAt: "2026-06-09T09:00:00.000Z",
  definitionSnapshot: pipeline,
  stages: [],
};

const snapshot: PlatformSnapshot = {
  overview: {
    applications: 1,
    pipelines: 1,
    runningRuns: 0,
    waitingApprovals: 0,
    successRate: 100,
    activeEnvironments: 0,
  },
  applications: [],
  repositories: [],
  pipelines: [pipeline],
  runs: [directRun],
  approvals: [],
  environments: [],
  runnerPools: [],
  artifacts: [],
  releases: [],
  deploymentTargets: [],
  releasePlans: [],
  releaseExecutions: [],
  releaseEvents: [],
  environmentLocks: [],
  auditEvents: [],
  tekton: {
    operator: {
      tektonConfigName: "tekton-config-yunxiao",
      status: "ready",
      profile: "all",
      targetNamespace: "tekton-system",
    },
    cluster: {
      context: "ack-prod-shanghai",
      executorMode: "local-docker",
      namespaces: ["tekton-system"],
    },
    components: [],
    bindings: [],
    runRecords: [],
  },
};

describe("DashboardShell direct run actions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("runs directly from the pipeline list without opening the launch dialog", () => {
    render(<DashboardShell surface="list" pipelineId={pipeline.id} />);

    fireEvent.click(screen.getByRole("button", { name: "list run" }));

    expect(triggerPipeline).toHaveBeenCalledWith(pipeline.id, {
      repositoryId: pipeline.repositoryId,
      refType: pipeline.defaultRefType,
      refName: pipeline.defaultRef,
      environment: pipeline.targetEnvironment,
      canaryPercent: pipeline.canaryPercent,
      stages: pipeline.stages,
      actor: "RO",
    });
    expect(screen.queryByText("Run Pipeline")).toBeNull();
  });

  it("runs directly from the run detail page without opening the launch dialog", () => {
    render(<DashboardShell surface="detail" pipelineId={pipeline.id} runId={directRun.id} />);

    fireEvent.click(screen.getByRole("button", { name: "detail run" }));

    expect(triggerPipeline).toHaveBeenCalledWith(pipeline.id, expect.objectContaining({ actor: "RO" }));
    expect(screen.queryByText("Run Pipeline")).toBeNull();
  });
});
