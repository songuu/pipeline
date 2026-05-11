import type { ApiResponse } from "@deploy-management/shared";
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
    const detail = await response.text().catch(() => "");
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
