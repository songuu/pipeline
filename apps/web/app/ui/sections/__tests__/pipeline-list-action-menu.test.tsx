// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PlatformSnapshot } from "@deploy-management/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineList } from "../pipeline-list";

const snapshot: PlatformSnapshot = {
  overview: {
    applications: 1,
    pipelines: 1,
    runningRuns: 0,
    waitingApprovals: 0,
    successRate: 100,
    activeEnvironments: 1,
  },
  applications: [],
  repositories: [],
  pipelines: [
    {
      id: "pipeline-1",
      name: "repository-staging-release",
      applicationId: "app-1",
      repositoryId: "repo-1",
      repository: "https://gitcode.com/tianli_brain/tbcr-admin.git",
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
      targetEnvironment: "staging",
      strategy: "rolling",
      canaryPercent: 100,
      requiresApproval: false,
      stages: ["source", "build", "deploy"],
      triggers: [],
      owner: "未配置",
    },
  ],
  runs: [],
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
      executorMode: "simulated",
      namespaces: ["tekton-system"],
    },
    components: [],
    bindings: [],
    runRecords: [],
  },
};

describe("PipelineList row action menu", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the three-dot menu outside the table scroll container", () => {
    render(
      <div className="codeup-shell">
        <PipelineList
          snapshot={snapshot}
          query=""
          onQueryChange={vi.fn()}
          onOpenTemplates={vi.fn()}
          onRefresh={vi.fn()}
          onSelectPipeline={vi.fn()}
          onSelectRun={vi.fn()}
          onRunPipeline={vi.fn()}
          onEditPipeline={vi.fn()}
          onCopy={vi.fn()}
          onNotify={vi.fn()}
        />
      </div>,
    );

    const moreButton = screen.getByRole("button", { name: "更多" }) as HTMLButtonElement;
    moreButton.getBoundingClientRect = () =>
      ({
        x: 1854,
        y: 356,
        top: 356,
        right: 1882,
        bottom: 392,
        left: 1854,
        width: 28,
        height: 36,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.click(moreButton);

    const menu = screen.getByText("编辑配置").closest(".action-menu");
    expect(menu).toBeTruthy();
    expect(menu?.parentElement).toBe(document.body);
    expect(menu?.closest(".flow-table")).toBeNull();
  });
});
