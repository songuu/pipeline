const DEFAULT_TIMEOUT_MS = 5000;

export function notifyTimeoutMs(): number {
  const raw = Number(process.env.NOTIFY_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 带超时的 JSON POST。超时用 AbortController，避免慢渠道拖垮主流程。
 * 不吞错——交由调用方/NotificationService 决定如何记录。
 */
export async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number = notifyTimeoutMs(),
  headers: Record<string, string> = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
