"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PlatformSnapshot, TektonControlPlaneSnapshot } from "@deploy-management/shared";
import { apiFetch } from "./api";

interface SnapshotState {
  snapshot: PlatformSnapshot | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
}

const SnapshotContext = createContext<SnapshotState | null>(null);

type SnapshotPayload = Omit<PlatformSnapshot, "tekton"> & Partial<Pick<PlatformSnapshot, "tekton">>;
const LIVE_RUN_STATUSES = new Set(["queued", "running", "waiting_approval"]);

export function SnapshotProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<PlatformSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      setError("");
      const data = await apiFetch<SnapshotPayload>("/api/snapshot");
      setSnapshot(normalizeSnapshot(data));
    } catch (err) {
      setError(`无法连接 Nest API: ${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!snapshot?.runs.some((run) => LIVE_RUN_STATUSES.has(run.status))) return;
    const timer = window.setInterval(() => {
      void reload();
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [snapshot?.runs, reload]);

  const value = useMemo(() => ({ snapshot, loading, error, reload }), [snapshot, loading, error, reload]);

  return <SnapshotContext.Provider value={value}>{children}</SnapshotContext.Provider>;
}

function normalizeSnapshot(data: SnapshotPayload): PlatformSnapshot {
  if (data.tekton) return data as PlatformSnapshot;
  return {
    ...data,
    tekton: createFallbackTekton(data),
  };
}

function createFallbackTekton(data: SnapshotPayload): TektonControlPlaneSnapshot {
  const bindings = data.pipelines.map((pipeline) => {
    const pipelineName = toKubernetesName(pipeline.name);
    const namespace = pipeline.targetEnvironment === "prod" ? "apps-prod" : `apps-${pipeline.targetEnvironment}`;
    return {
      pipelineId: pipeline.id,
      namespace,
      pipelineName,
      serviceAccountName: pipeline.targetEnvironment === "prod" ? "tekton-deployer-prod" : "tekton-builder",
      resolver: "cluster" as const,
      resolverRef: {
        resolver: "cluster" as const,
        resourceKind: "Pipeline" as const,
        name: pipelineName,
        source: "cluster://tekton-pipelines",
        revision: "installed",
        params: [
          { key: "name", value: pipelineName },
          { key: "kind", value: "Pipeline" },
        ],
      },
      workspaces: ["source-ws", "cache-ws", "docker-config", "kubeconfig"],
      workspaceBindings: [
        {
          name: "source-ws",
          type: "persistentVolumeClaim" as const,
          mountPath: "/workspace/source",
          claimName: `${pipelineName}-source-pvc`,
          description: "代码与构建上下文。",
        },
        {
          name: "cache-ws",
          type: "persistentVolumeClaim" as const,
          mountPath: "/workspace/cache",
          claimName: `${pipelineName}-cache-pvc`,
          optional: true,
          description: "依赖与构建缓存。",
        },
        {
          name: "docker-config",
          type: "secret" as const,
          mountPath: "/tekton/home/.docker",
          secretName: "acr-push-secret",
          readOnly: true,
          description: "镜像仓库凭据。",
        },
        {
          name: "kubeconfig",
          type: "secret" as const,
          mountPath: "/tekton/home/.kube",
          secretName: "ack-kubeconfig",
          readOnly: true,
          description: "Kubernetes 部署凭据。",
        },
      ],
      params: [
        { key: "git-url", value: pipeline.repository },
        { key: "revision", value: pipeline.defaultRef },
        { key: "ref-type", value: pipeline.defaultRefType },
        { key: "branch-allowlist", value: pipeline.sourcePolicy?.allowedBranchPatterns.join(",") ?? pipeline.defaultBranch },
        { key: "tag-allowlist", value: pipeline.sourcePolicy?.allowedTagPatterns.join(",") ?? "v*" },
        { key: "target-env", value: pipeline.targetEnvironment },
        { key: "canary-percent", value: String(pipeline.canaryPercent) },
      ],
      taskGraph: pipeline.stages.map((stage, index) => ({
        name: stage,
        taskRef: `${stage}-task`,
        runAfter: index === 0 ? [] : [pipeline.stages[index - 1]],
        workspaces: ["source-ws"],
        params: [{ key: "target-env", value: pipeline.targetEnvironment }],
        retries: 0,
        timeoutSeconds: 900,
      })),
      trigger: {
        eventListener: `${pipelineName}-el`,
        trigger: `${pipelineName}-trigger`,
        triggerBinding: `${pipelineName}-binding`,
        triggerTemplate: `${pipelineName}-template`,
        route: `https://devops.example.com/hooks/${pipeline.id}`,
        interceptors: ["signature", "cel", "dedupe"],
      },
      results: {
        resultName: `${pipelineName}-result`,
        records: data.runs.filter((run) => run.pipelineId === pipeline.id).length,
        retentionDays: pipeline.targetEnvironment === "prod" ? 180 : 45,
      },
      chains: {
        format: "slsa/v1" as const,
        storage: ["tekton", "oci"],
        signedArtifacts: data.artifacts.filter((artifact) => artifact.signed).length,
      },
    };
  });

  return {
    operator: {
      tektonConfigName: "tekton-config-yunxiao",
      status: "ready",
      profile: "all",
      targetNamespace: "tekton-pipelines",
    },
    cluster: {
      context: "local-dev / fallback",
      executorMode: "simulated",
      namespaces: ["tekton-pipelines", "tekton-triggers", "tekton-results", "tekton-chains"],
    },
    components: [
      component("Operator", "tekton-operator", "v0.77.0"),
      component("Pipelines", "tekton-pipelines", "v1.3.0"),
      component("Triggers", "tekton-triggers", "v0.33.0"),
      component("Results", "tekton-results", "v0.15.0"),
      component("Chains", "tekton-chains", "v0.24.0"),
      component("Dashboard", "tekton-pipelines", "v0.57.0"),
      component("Hub", "tekton-hub", "v1.20.0"),
    ],
    bindings,
    runRecords: data.runs.map((run) => {
      const pipelineName = toKubernetesName(run.pipelineName);
      const pipelineRunName = `${pipelineName}-${run.id.replace("run-", "")}`;
      const namespace = bindings.find((binding) => binding.pipelineId === run.pipelineId)?.namespace ?? "apps-dev";
      return {
        runId: run.id,
        namespace,
        pipelineRunName,
        status: run.status === "success" ? "SUCCESS" : run.status === "failed" ? "FAIL" : "RUNNING",
        conditionReason: run.status === "success" ? "Succeeded" : run.status === "failed" ? "Failed" : "Started",
        conditionMessage: "前端兼容层根据 legacy snapshot 生成的 Tekton 视图",
        childReferences: run.stages.map((stage) => ({
          name: `${pipelineRunName}-${stage.key}`,
          kind: "TaskRun" as const,
          pipelineTaskName: stage.key,
        })),
        taskRuns: run.stages.map((stage) => ({
          taskRunName: `${pipelineRunName}-${stage.key}`,
          pipelineTaskName: stage.key,
          taskRef: String(stage.metadata.adapter ?? stage.key),
          status: stage.status === "success" ? "SUCCESS" : stage.status === "failed" ? "FAIL" : "RUNNING",
          podName: `${pipelineRunName}-${stage.key}-pod`,
          retries: stage.status === "failed" ? 1 : 0,
          workspaces: ["source-ws"],
          steps: [],
          results: {},
          startedAt: stage.startedAt,
          finishedAt: stage.finishedAt,
        })),
        params: [
          { key: "git-url", value: run.repository },
          { key: "revision", value: run.refName },
          { key: "resolved-commit", value: run.commit },
        ],
        workspaceBindings: bindings.find((binding) => binding.pipelineId === run.pipelineId)?.workspaceBindings ?? [],
        results: [
          {
            name: `${pipelineRunName}-pipelinerun`,
            recordType: "PipelineRun" as const,
            value: run.status,
            storedAt: run.updatedAt,
            summary: "fallback run record",
          },
        ],
        events: [
          {
            type: "Normal" as const,
            reason: "FallbackRecord",
            message: "前端兼容层根据 legacy snapshot 生成 Tekton 事件。",
            timestamp: run.updatedAt,
            involvedObject: pipelineRunName,
          },
        ],
        pipelineSpecRef: bindings.find((binding) => binding.pipelineId === run.pipelineId)?.resolverRef,
        resultRecordName: `${pipelineRunName}-record`,
        logsUrl: `tekton-results://${namespace}/${pipelineRunName}`,
      };
    }),
  };
}

function component(
  name: TektonControlPlaneSnapshot["components"][number]["name"],
  namespace: string,
  version: string,
): TektonControlPlaneSnapshot["components"][number] {
  return {
    name,
    namespace,
    version,
    status: "ready",
    readyReplicas: 1,
    desiredReplicas: 1,
    description: `${name} fallback view`,
  };
}

function toKubernetesName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52);
}

export function useSnapshot(): SnapshotState {
  const ctx = useContext(SnapshotContext);
  if (!ctx) {
    throw new Error("useSnapshot must be used inside <SnapshotProvider>");
  }
  return ctx;
}
