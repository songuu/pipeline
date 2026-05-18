import type {
  ApprovalStatus,
  CreatePipelineRequest,
  DeployArtifactRequest,
  PipelineDefinition,
  PipelineRun,
  ReleaseCanaryActionRequest,
  ReleaseDeployment,
  RemoteRepositoryRefRequest,
  RemoteRepositoryRefs,
  ResolveRepositoryRequest,
  ResolvedRemoteRepository,
  TriggerRunRequest,
  UpdatePipelineRequest,
} from "@deploy-management/shared";
import { apiFetch, type RequestOptions } from "./api";

export const createPipeline = (request: CreatePipelineRequest): Promise<PipelineDefinition> =>
  apiFetch<PipelineDefinition>("/api/pipelines", { method: "POST", body: request });

export const updatePipeline = (
  pipelineId: string,
  request: UpdatePipelineRequest,
): Promise<PipelineDefinition> =>
  apiFetch<PipelineDefinition>(`/api/pipelines/${pipelineId}`, { method: "PUT", body: request });

export const deletePipeline = (pipelineId: string): Promise<{ id: string }> =>
  apiFetch<{ id: string }>(`/api/pipelines/${pipelineId}`, { method: "DELETE" });

export const resolveRepository = (request: ResolveRepositoryRequest): Promise<ResolvedRemoteRepository> =>
  apiFetch<ResolvedRemoteRepository>("/api/repositories/resolve", { method: "POST", body: request });

export const fetchRepositoryRefs = (
  request: RemoteRepositoryRefRequest,
  options: RequestOptions = {},
): Promise<RemoteRepositoryRefs> =>
  apiFetch<RemoteRepositoryRefs>("/api/repositories/refs", { ...options, method: "POST", body: request });

export const triggerPipeline = (
  pipelineId: string,
  request: TriggerRunRequest,
): Promise<PipelineRun> =>
  apiFetch<PipelineRun>(`/api/pipelines/${pipelineId}/trigger`, { method: "POST", body: request });

export const cancelRun = (runId: string): Promise<PipelineRun> =>
  apiFetch<PipelineRun>(`/api/runs/${runId}/cancel`, { method: "POST" });

export const promoteRun = (runId: string): Promise<PipelineRun> =>
  apiFetch<PipelineRun>(`/api/runs/${runId}/promote`, { method: "POST" });

export const deployArtifact = (
  artifactId: string,
  request: DeployArtifactRequest,
): Promise<ReleaseDeployment> =>
  apiFetch<ReleaseDeployment>(`/api/artifacts/${artifactId}/deploy`, { method: "POST", body: request });

export const advanceCanaryRelease = (
  releaseId: string,
  request: ReleaseCanaryActionRequest = {},
): Promise<ReleaseDeployment> =>
  apiFetch<ReleaseDeployment>(`/api/releases/${releaseId}/canary/advance`, { method: "POST", body: request });

export const pauseCanaryRelease = (
  releaseId: string,
  request: ReleaseCanaryActionRequest = {},
): Promise<ReleaseDeployment> =>
  apiFetch<ReleaseDeployment>(`/api/releases/${releaseId}/canary/pause`, { method: "POST", body: request });

export const resumeCanaryRelease = (
  releaseId: string,
  request: ReleaseCanaryActionRequest = {},
): Promise<ReleaseDeployment> =>
  apiFetch<ReleaseDeployment>(`/api/releases/${releaseId}/canary/resume`, { method: "POST", body: request });

export const promoteCanaryRelease = (
  releaseId: string,
  request: ReleaseCanaryActionRequest = {},
): Promise<ReleaseDeployment> =>
  apiFetch<ReleaseDeployment>(`/api/releases/${releaseId}/canary/promote`, { method: "POST", body: request });

export const rollbackRelease = (
  releaseId: string,
  request: ReleaseCanaryActionRequest = {},
): Promise<ReleaseDeployment> =>
  apiFetch<ReleaseDeployment>(`/api/releases/${releaseId}/rollback`, { method: "POST", body: request });

export const decideApproval = (
  approvalId: string,
  decision: ApprovalStatus,
  actor = "RO",
): Promise<unknown> =>
  apiFetch(`/api/approvals/${approvalId}/${decision}`, { method: "POST", body: { actor } });
