import type { ApiResponse } from "@deploy-management/shared";

export const ok = <T>(data: T, meta?: ApiResponse<T>["meta"]): ApiResponse<T> => ({
  success: true,
  data,
  ...(meta ? { meta } : {}),
});

export const fail = (message: string, meta?: ApiResponse<never>["meta"]): ApiResponse<never> => ({
  success: false,
  error: message,
  ...(meta ? { meta } : {}),
});
