import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineRun, PipelineStageRun, RunHandle, RunStatus } from "@deploy-management/shared";
import { RunsService } from "./runs.service";

function makeStage(status: PipelineStageRun["status"] = "pending"): PipelineStageRun {
  return {
    id: "stage-source",
    key: "source",
    title: "拉取代码",
    status,
    logs: [],
    metadata: {},
  };
}

function makeRun(overrides: Partial<PipelineRun> = {}): PipelineRun {
  const now = "2026-06-09T00:00:00.000Z";
  const stages = overrides.stages ?? [makeStage()];
  const definitionSnapshot: PipelineRun["definitionSnapshot"] = {
    id: "pipeline-1",
    name: "demo-release",
    applicationId: "app-1",
    repositoryId: "repo-1",
    repository: "https://example.com/demo.git",
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
    targetEnvironment: "test",
    strategy: "rolling",
    canaryPercent: 0,
    requiresApproval: false,
    stages: ["source"],
    triggers: ["manual"],
    owner: "team",
  };

  return {
    id: overrides.id ?? "run-stale",
    pipelineId: definitionSnapshot.id,
    pipelineName: definitionSnapshot.name,
    applicationId: definitionSnapshot.applicationId,
    applicationName: "demo",
    actor: "RO",
    repositoryId: definitionSnapshot.repositoryId,
    repository: definitionSnapshot.repository,
    refType: "branch",
    refName: "main",
    branch: "main",
    commit: "abcdef1",
    environment: "test",
    status: "queued",
    progress: 0,
    canaryPercent: 0,
    createdAt: now,
    updatedAt: now,
    definitionSnapshot,
    stages,
    ...overrides,
  };
}

function makeService(input: PipelineRun | PipelineRun[]) {
  const runs = Array.isArray(input) ? input : [input];
  const repo = {
    list: vi.fn(async () => runs),
    snapshot: vi.fn(() => runs),
    update: vi.fn(async (id: string, patch: Partial<PipelineRun>) => {
      const target = runs.find((run) => run.id === id);
      if (target) Object.assign(target, patch);
    }),
  };
  const lifecycle = {
    cancelExecutor: vi.fn(),
    executorEvents: vi.fn(),
    startExecutor: vi.fn(async (run: PipelineRun) => {
      run.executor = { runId: run.id, backend: "local-docker" };
      return run.executor;
    }),
    executorStatus: vi.fn(async () => ({
      runId: runs[0]!.id,
      status: "RUNNING",
      stages: [{ index: 0, name: "source", status: "RUNNING", jobs: [] }],
      startedAt: "2026-06-09T00:00:02.000Z",
    } satisfies RunStatus)),
    failStage: vi.fn((stage: PipelineStageRun, target: PipelineRun, logs: string[]) => {
      stage.status = "failed";
      stage.logs = logs;
      target.status = "failed";
      target.updatedAt = "2026-06-09T00:00:01.000Z";
    }),
    syncExecutorStatus: vi.fn((target: PipelineRun, status: RunStatus) => {
      target.status = status.status === "RUNNING" ? "running" : target.status;
      target.stages[0]!.status = "running";
      target.stages[0]!.startedAt = status.startedAt;
      target.updatedAt = status.startedAt ?? target.updatedAt;
      return target;
    }),
  };
  const runEvents = {
    append: vi.fn(),
    recordStatusSnapshot: vi.fn(),
  };
  const service = new RunsService(
    repo as never,
    {} as never,
    {} as never,
    {} as never,
    lifecycle as never,
    { pendingForRun: vi.fn(), createForRun: vi.fn() } as never,
    { upsertFromRun: vi.fn(), upsertFromStage: vi.fn() } as never,
    { record: vi.fn() } as never,
    runEvents as never,
  );
  return { lifecycle, repo, runEvents, service };
}

describe("RunsService live-run persistence", () => {
  it("marks restored local-docker queued runs as failed because executor memory cannot be recovered", async () => {
    const run = makeRun({ executor: { runId: "run-stale", backend: "local-docker" } });
    const { repo, service } = makeService(run);

    await service.onModuleInit();

    expect(run.status).toBe("failed");
    expect(run.stages[0]!.status).toBe("failed");
    expect(run.stages[0]!.logs.join("\n")).toContain("local-docker 执行器状态丢失");
    expect(repo.update).toHaveBeenCalledWith("run-stale", expect.objectContaining({ status: "failed" }));
  });

  it("persists executor status sync so restored snapshots are not stuck at initial queued", async () => {
    const run = makeRun();
    const { repo, service } = makeService(run);
    const handle: RunHandle = { runId: "run-stale", backend: "tekton" };

    await (service as unknown as { syncExecutorRun(run: PipelineRun, handle: RunHandle): Promise<void> }).syncExecutorRun(run, handle);

    expect(run.status).toBe("running");
    expect(run.stages[0]!.status).toBe("running");
    expect(repo.update).toHaveBeenCalledWith("run-stale", expect.objectContaining({ status: "running" }));
  });
});

describe("RunsService local-docker single-flight gate", () => {
  const originalExecutor = process.env.EXECUTOR;

  afterEach(() => {
    process.env.EXECUTOR = originalExecutor;
    vi.clearAllMocks();
  });

  it("keeps the second local-docker run queued while one run is active", async () => {
    process.env.EXECUTOR = "local-docker";
    const first = makeRun({ id: "run-first" });
    const second = makeRun({ id: "run-second" });
    const { lifecycle, repo, service } = makeService([first, second]);

    (service as unknown as { scheduleRealtimeRun(run: PipelineRun): void }).scheduleRealtimeRun(first);
    (service as unknown as { scheduleRealtimeRun(run: PipelineRun): void }).scheduleRealtimeRun(second);
    await Promise.resolve();

    expect(lifecycle.startExecutor).toHaveBeenCalledTimes(1);
    expect(lifecycle.startExecutor).toHaveBeenCalledWith(first);
    expect(second.status).toBe("queued");
    expect(second.stages[0]!.logs.join("\n")).toContain("等待本机单飞闸");
    expect(repo.update).toHaveBeenCalledWith("run-second", expect.objectContaining({ status: "queued" }));
  });

  it("starts the next queued local-docker run after the active run releases the slot", async () => {
    process.env.EXECUTOR = "local-docker";
    const first = makeRun({ id: "run-first" });
    const second = makeRun({ id: "run-second" });
    const { lifecycle, service } = makeService([first, second]);

    (service as unknown as { scheduleRealtimeRun(run: PipelineRun): void }).scheduleRealtimeRun(first);
    (service as unknown as { scheduleRealtimeRun(run: PipelineRun): void }).scheduleRealtimeRun(second);
    await Promise.resolve();

    await (service as unknown as { releaseLocalDockerSlot(runId: string): Promise<void> }).releaseLocalDockerSlot(first.id);
    await Promise.resolve();

    expect(lifecycle.startExecutor).toHaveBeenCalledTimes(2);
    expect(lifecycle.startExecutor).toHaveBeenNthCalledWith(2, second);
  });

  it("skips terminal queued local-docker runs when releasing the slot", async () => {
    process.env.EXECUTOR = "local-docker";
    const first = makeRun({ id: "run-first" });
    const canceled = makeRun({ id: "run-canceled", status: "canceled" });
    const third = makeRun({ id: "run-third" });
    const { lifecycle, service } = makeService([first, canceled, third]);

    (service as unknown as { scheduleRealtimeRun(run: PipelineRun): void }).scheduleRealtimeRun(first);
    (service as unknown as { scheduleRealtimeRun(run: PipelineRun): void }).scheduleRealtimeRun(canceled);
    (service as unknown as { scheduleRealtimeRun(run: PipelineRun): void }).scheduleRealtimeRun(third);
    await Promise.resolve();
    canceled.status = "canceled";

    await (service as unknown as { releaseLocalDockerSlot(runId: string): Promise<void> }).releaseLocalDockerSlot(first.id);
    await Promise.resolve();

    expect(lifecycle.startExecutor).toHaveBeenCalledTimes(2);
    expect(lifecycle.startExecutor).toHaveBeenNthCalledWith(2, third);
  });
});
