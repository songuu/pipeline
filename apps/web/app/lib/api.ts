import type {
  ApiResponse,
  TektonBridgeCapabilities,
  TektonPreflightReport,
  TektonPreflightRequest,
  StoredRunEvent,
  TektonTaskRunDetail,
  TektonTaskRunLogs,
} from "@deploy-management/shared";
import { env } from "./env";

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  cache?: RequestCache;
  /** When true, response body is parsed as ApiResponse<T> envelope. */
  envelope?: boolean;
}

const buildInit = (options: RequestOptions): RequestInit => ({
  method: options.method ?? "GET",
  headers: options.body ? { "Content-Type": "application/json" } : undefined,
  body: options.body ? JSON.stringify(options.body) : undefined,
  signal: options.signal,
  cache: options.cache ?? "no-store",
});

/**
 * 直接拉取 legacy /api/* 路径，返回原始响应体。
 */
export const apiFetch = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const response = await fetch(`${env.apiBase}${path}`, buildInit(options));
  if (!response.ok) {
    const detail = await readApiError(response);
    throw new ApiError(detail || response.statusText, response.status);
  }
  return (await response.json()) as T;
};

/**
 * 拉取云效风格 /oapi/v1/flow/* 路径，自动解 ApiResponse<T> 信封。
 */
export const yunxiaoFetch = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const envelope = await apiFetch<ApiResponse<T>>(path, options);
  if (!envelope.success || envelope.data === undefined) {
    throw new ApiError(envelope.error ?? "云效响应缺少 data");
  }
  return envelope.data;
};

export const fetchTektonCapabilities = (options: RequestOptions = {}): Promise<TektonBridgeCapabilities> =>
  apiFetch<TektonBridgeCapabilities>("/api/tekton/capabilities", options);

export const runTektonPreflight = (
  request: TektonPreflightRequest,
  options: RequestOptions = {},
): Promise<TektonPreflightReport> =>
  apiFetch<TektonPreflightReport>("/api/tekton/preflight", {
    ...options,
    method: "POST",
    body: request,
  });

export const fetchRunEvents = (runId: string, options: RequestOptions = {}): Promise<StoredRunEvent[]> =>
  apiFetch<StoredRunEvent[]>(`/api/runs/${runId}/events`, options);

export const fetchTektonTaskRunDetail = (
  runId: string,
  taskRunName: string,
  options: RequestOptions = {},
): Promise<TektonTaskRunDetail> =>
  apiFetch<TektonTaskRunDetail>(`/api/tekton/runs/${runId}/taskruns/${encodeURIComponent(taskRunName)}`, options);

export const fetchTektonTaskRunLogs = (
  runId: string,
  taskRunName: string,
  stepName?: string,
  options: RequestOptions = {},
): Promise<TektonTaskRunLogs> => {
  const query = stepName ? `?step=${encodeURIComponent(stepName)}` : "";
  return apiFetch<TektonTaskRunLogs>(
    `/api/tekton/runs/${runId}/taskruns/${encodeURIComponent(taskRunName)}/logs${query}`,
    options,
  );
};

export interface PipelineGraphLayoutPayload {
  nodes: Array<{ id: string; position: { x: number; y: number }; data?: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string }>;
  viewport?: { x: number; y: number; zoom: number };
}

export interface PipelineGraphLayoutRecord {
  id: string;
  pipeline_id: string;
  actor: string;
  payload: PipelineGraphLayoutPayload;
  version: number;
  created_at: string;
  updated_at: string;
}

/**
 * 不传 actor —— 后端从已认证 principal 取，避免跨用户访问 (Sprint B Phase 4 P1 安全修复)。
 */
export const fetchPipelineGraphLayout = (
  pipelineId: string,
  options: RequestOptions = {},
): Promise<PipelineGraphLayoutRecord> =>
  apiFetch<PipelineGraphLayoutRecord>(
    `/api/pipelines/${encodeURIComponent(pipelineId)}/graph-layout`,
    options,
  );

export const savePipelineGraphLayout = (
  pipelineId: string,
  payload: PipelineGraphLayoutPayload,
  options: RequestOptions = {},
): Promise<PipelineGraphLayoutRecord> =>
  apiFetch<PipelineGraphLayoutRecord>(
    `/api/pipelines/${encodeURIComponent(pipelineId)}/graph-layout`,
    { ...options, method: "PUT", body: payload },
  );

async function readApiError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return response.statusText;
  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown; statusCode?: unknown };
    if (Array.isArray(parsed.message)) return parsed.message.join("；");
    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    return text;
  }
  return text;
}
