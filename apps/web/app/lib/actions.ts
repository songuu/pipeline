import type {
  ApprovalStatus,
  CreatePipelineRequest,
  PipelineDefinition,
  PipelineRun,
  TriggerRunRequest,
  UpdatePipelineRequest,
} from "@deploy-management/shared";
import { apiFetch } from "./api";

export const createPipeline = (request: CreatePipelineRequest): Promise<PipelineDefinition> =>
  apiFetch<PipelineDefinition>("/api/pipelines", { method: "POST", body: request });

export const updatePipeline = (
  pipelineId: string,
  request: UpdatePipelineRequest,
): Promise<PipelineDefinition> =>
  apiFetch<PipelineDefinition>(`/api/pipelines/${pipelineId}`, { method: "PUT", body: request });

export const deletePipeline = (pipelineId: string): Promise<{ id: string }> =>
  apiFetch<{ id: string }>(`/api/pipelines/${pipelineId}`, { method: "DELETE" });

export const triggerPipeline = (
  pipelineId: string,
  request: TriggerRunRequest,
): Promise<PipelineRun> =>
  apiFetch<PipelineRun>(`/api/pipelines/${pipelineId}/trigger`, { method: "POST", body: request });

export const cancelRun = (runId: string): Promise<PipelineRun> =>
  apiFetch<PipelineRun>(`/api/runs/${runId}/cancel`, { method: "POST" });

export const promoteRun = (runId: string): Promise<PipelineRun> =>
  apiFetch<PipelineRun>(`/api/runs/${runId}/promote`, { method: "POST" });

export const decideApproval = (
  approvalId: string,
  decision: ApprovalStatus,
  actor = "RO",
): Promise<unknown> =>
  apiFetch(`/api/approvals/${approvalId}/${decision}`, { method: "POST", body: { actor } });
