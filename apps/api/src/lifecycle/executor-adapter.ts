import type { RunEvent, RunHandle, RunStatus, StartRunInput } from "@deploy-management/shared";

/**
 * ExecutorAdapter 是控制面与执行内核的边界。
 * SimulatedExecutor (内存推进) 与 TektonBridgeExecutor (Go 服务 + Tekton CRD)
 * 都实现该端口，由环境变量 EXECUTOR 选择。
 */
export interface ExecutorAdapter {
  readonly backend: RunHandle["backend"];
  start(input: StartRunInput): Promise<RunHandle>;
  status(handle: RunHandle): Promise<RunStatus>;
  cancel(handle: RunHandle): Promise<void>;
  events(handle: RunHandle): AsyncIterable<RunEvent>;
}

export const EXECUTOR_ADAPTER = Symbol("EXECUTOR_ADAPTER");
