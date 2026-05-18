import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  RunHandle,
  TektonBridgeCapabilities,
  TektonPreflightReport,
  TektonPreflightRequest,
  TektonTaskRunDetail,
  TektonTaskRunLogs,
} from "@deploy-management/shared";

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:5050";

@Injectable()
export class KubernetesService {
  private readonly bridgeUrl = process.env.TEKTON_BRIDGE_URL ?? DEFAULT_BRIDGE_URL;

  async capabilities(): Promise<TektonBridgeCapabilities> {
    if (!isKubernetesEnabled()) {
      return localKubernetesDisabledCapabilities();
    }
    try {
      return await this.get<TektonBridgeCapabilities>("/v1/capabilities");
    } catch (error) {
      return disconnectedCapabilities(describe(error), bridgeBackendHint());
    }
  }

  async preflight(request: TektonPreflightRequest): Promise<TektonPreflightReport> {
    if (!isKubernetesEnabled()) {
      const capabilities = localKubernetesDisabledCapabilities();
      return {
        ok: false,
        backend: capabilities.backend,
        namespace: request.namespace ?? capabilities.kubernetes.namespace,
        capabilities,
        checks: [
          {
            code: "kubernetes.local-disabled",
            status: "failed",
            message: "当前本地运行模式未启用 Kubernetes/Tekton，不能创建真实 PipelineRun。",
            remediation: "本机使用 EXECUTOR=local-docker；只有配置可用集群后再设置 EXECUTOR=tekton 或 KUBERNETES_ENABLED=true。",
          },
        ],
      };
    }
    try {
      return await this.post<TektonPreflightReport>("/v1/preflight", request);
    } catch (error) {
      const capabilities = disconnectedCapabilities(describe(error), bridgeBackendHint());
      return {
        ok: false,
        backend: capabilities.backend,
        namespace: request.namespace ?? capabilities.kubernetes.namespace,
        capabilities,
        checks: [
          {
            code: "bridge.reachable",
            status: "failed",
            message: `无法连接 Tekton bridge: ${describe(error)}`,
            remediation: "启动 services/tekton-bridge，并确认 TEKTON_BRIDGE_URL 指向正确地址。",
          },
        ],
      };
    }
  }

  taskRunDetail(runId: string, taskRunName: string): Promise<TektonTaskRunDetail> {
    this.assertKubernetesEnabled();
    return this.get<TektonTaskRunDetail>(`/v1/runs/${encodeURIComponent(runId)}/taskruns/${encodeURIComponent(taskRunName)}`);
  }

  taskRunLogs(runId: string, taskRunName: string, stepName?: string): Promise<TektonTaskRunLogs> {
    this.assertKubernetesEnabled();
    const query = stepName ? `?step=${encodeURIComponent(stepName)}` : "";
    return this.get<TektonTaskRunLogs>(
      `/v1/runs/${encodeURIComponent(runId)}/taskruns/${encodeURIComponent(taskRunName)}/logs${query}`,
    );
  }

  private assertKubernetesEnabled(): void {
    if (isKubernetesEnabled()) return;
    throw new BadRequestException(
      "当前本地运行模式未启用 Kubernetes/Tekton。请继续使用 local-docker 的本地日志与制品；只有配置可用集群后再设置 EXECUTOR=tekton 或 KUBERNETES_ENABLED=true。",
    );
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.bridgeUrl}${path}`);
    if (!response.ok) {
      throw new Error(`bridge ${path} -> ${response.status}: ${await readBridgeError(response)}`);
    }
    return (await response.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.bridgeUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`bridge ${path} -> ${response.status}: ${await readBridgeError(response)}`);
    }
    return (await response.json()) as T;
  }
}

function disconnectedCapabilities(reason: string, backend: RunHandle["backend"]): TektonBridgeCapabilities {
  const namespace = process.env.TEKTON_BRIDGE_NAMESPACE || "default";
  return {
    backend,
    status: "disconnected",
    kubernetes: {
      reachable: false,
      namespace,
      error: reason,
    },
    tekton: {
      pipelinesInstalled: false,
      triggersInstalled: false,
      resultsInstalled: false,
      chainsInstalled: false,
      resources: [],
    },
    runtime: {
      sourcePvcConfigured: Boolean(process.env.TEKTON_SOURCE_PVC),
      dockerSecretConfigured: Boolean(process.env.TEKTON_DOCKER_SECRET),
      serviceAccountName: process.env.TEKTON_SERVICE_ACCOUNT ?? "",
      buildStrategy: process.env.TEKTON_BUILD_STRATEGY ?? "dind",
      privilegedSidecarRequired: (process.env.TEKTON_BUILD_STRATEGY ?? "dind") === "dind",
      clusterPipelineRef: process.env.TEKTON_PIPELINE_REF || undefined,
      inlinePipelineSpecFallback: !process.env.TEKTON_PIPELINE_REF,
    },
    issues: [
      {
        severity: "failed",
        code: "bridge.disconnected",
        message: `Tekton bridge 不可达: ${reason}`,
        remediation: "启动 bridge 后重新执行 preflight。真实 Tekton 流程不能在 bridge 不可达时继续。",
      },
    ],
  };
}

function bridgeBackendHint(): RunHandle["backend"] {
  if (process.env.EXECUTOR === "local-docker") return "local-docker";
  if (process.env.EXECUTOR === "tekton") return "tekton";
  return "simulated";
}

function isKubernetesEnabled(): boolean {
  return process.env.EXECUTOR === "tekton" || process.env.KUBERNETES_ENABLED === "true";
}

function localKubernetesDisabledCapabilities(): TektonBridgeCapabilities {
  const backend = bridgeBackendHint();
  const namespace = process.env.TEKTON_BRIDGE_NAMESPACE || "local";
  return {
    ...disconnectedCapabilities(`local executor backend=${backend}; Kubernetes/Tekton disabled`, backend),
    status: "disconnected",
    kubernetes: {
      reachable: false,
      namespace,
      error: `当前本地运行模式为 ${backend}，未启用 Kubernetes/Tekton bridge。`,
    },
    issues: [
      {
        severity: "warning",
        code: "kubernetes.local-disabled",
        message: `当前运行模式为 ${backend}，系统不会请求 127.0.0.1:5050 的 Tekton bridge。`,
        remediation: "本地真实打包/上传继续使用 EXECUTOR=local-docker；需要 k8s 时先配置集群，再设置 EXECUTOR=tekton 或 KUBERNETES_ENABLED=true。",
      },
    ],
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readBridgeError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return response.statusText;
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    return text;
  }
  return text;
}
