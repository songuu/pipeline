import { Inject, Injectable, Logger } from "@nestjs/common";
import type { RunEvent, RunHandle, RunStatus, StartRunInput } from "@deploy-management/shared";
import { ExecutorAdapter } from "../lifecycle/executor-adapter";
import { SimulatedExecutor } from "./simulated.executor";

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:5050";

/**
 * Tekton 执行器：通过 HTTP 调用 services/tekton-bridge (Go) 推进运行。
 * 当 bridge 不可达时退化到 SimulatedExecutor，保证本地 dev 不被中断。
 */
@Injectable()
export class TektonBridgeExecutor implements ExecutorAdapter {
  readonly backend: RunHandle["backend"] = "tekton";

  private readonly logger = new Logger(TektonBridgeExecutor.name);
  private readonly bridgeUrl = process.env.TEKTON_BRIDGE_URL ?? DEFAULT_BRIDGE_URL;

  constructor(@Inject(SimulatedExecutor) private readonly fallback: SimulatedExecutor) {}

  async start(input: StartRunInput): Promise<RunHandle> {
    try {
      const response = await this.post<{ runId: string }>("/v1/runs", input);
      return { runId: response.runId, backend: this.backend };
    } catch (error) {
      this.logger.warn(`Tekton bridge unreachable, falling back to simulated: ${describe(error)}`);
      return this.fallback.start(input);
    }
  }

  async status(handle: RunHandle): Promise<RunStatus> {
    if (handle.backend !== this.backend) return this.fallback.status(handle);
    try {
      return await this.get<RunStatus>(`/v1/runs/${handle.runId}`);
    } catch (error) {
      this.logger.warn(`status fallback for ${handle.runId}: ${describe(error)}`);
      return this.fallback.status(handle);
    }
  }

  async cancel(handle: RunHandle): Promise<void> {
    if (handle.backend !== this.backend) {
      await this.fallback.cancel(handle);
      return;
    }
    try {
      await this.post(`/v1/runs/${handle.runId}/cancel`, {});
    } catch (error) {
      this.logger.warn(`cancel fallback for ${handle.runId}: ${describe(error)}`);
      await this.fallback.cancel(handle);
    }
  }

  async *events(handle: RunHandle): AsyncIterable<RunEvent> {
    if (handle.backend !== this.backend) {
      for await (const event of this.fallback.events(handle)) yield event;
      return;
    }
    try {
      const url = `${this.bridgeUrl}/v1/runs/${handle.runId}/events`;
      const response = await fetch(url, { headers: { Accept: "text/event-stream" } });
      if (!response.ok || !response.body) {
        throw new Error(`bridge events ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";
        for (const raw of messages) {
          const line = raw.replace(/^data:\s*/, "");
          if (!line) continue;
          try {
            yield JSON.parse(line) as RunEvent;
          } catch (error) {
            this.logger.debug(`bad SSE payload skipped: ${describe(error)}`);
          }
        }
      }
    } catch (error) {
      this.logger.warn(`events fallback for ${handle.runId}: ${describe(error)}`);
      for await (const event of this.fallback.events(handle)) yield event;
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.bridgeUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`bridge ${path} -> ${response.status}`);
    }
    return (await response.json()) as T;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.bridgeUrl}${path}`);
    if (!response.ok) {
      throw new Error(`bridge ${path} -> ${response.status}`);
    }
    return (await response.json()) as T;
  }
}

const describe = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);
