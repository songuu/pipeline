import { Inject, Injectable } from "@nestjs/common";
import type { Artifact, PipelineRun } from "@deploy-management/shared";
import { ArtifactsRepository } from "./artifacts.repository";

@Injectable()
export class ArtifactsService {
  constructor(@Inject(ArtifactsRepository) private readonly repo: ArtifactsRepository) {}

  list(): Artifact[] {
    return this.repo.snapshot();
  }

  async upsertFromRun(run: PipelineRun, type: Artifact["type"] = "image"): Promise<void> {
    if (run.status === "failed" || run.status === "canceled") return;
    const existing = this.repo.snapshot().find((item) => item.runId === run.id && item.type === type);
    if (existing) return;

    const artifact: Artifact = {
      id: `artifact-${this.repo.snapshot().length + 1}`,
      runId: run.id,
      name:
        type === "provenance"
          ? `attestation/${run.applicationId}/${run.id}.intoto.jsonl`
          : `registry.internal/${run.applicationId}`,
      version: `${run.environment}-${run.id}`,
      type,
      digest: `sha256:${run.commit}${run.id.replace("run-", "")}`,
      size: type === "provenance" ? "18 KB" : "218 MB",
      signed: run.status === "success" || type === "provenance",
      uploadedAt: new Date().toISOString(),
    };
    await this.repo.prepend(artifact);
  }
}
