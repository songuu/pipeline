import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { resolveImageArtifact, type Artifact, type LifecycleStageKey, type PipelineRun } from "@deploy-management/shared";
import { createStableId } from "../common/ids";
import { ArtifactsRepository } from "./artifacts.repository";

@Injectable()
export class ArtifactsService {
  constructor(@Inject(ArtifactsRepository) private readonly repo: ArtifactsRepository) {}

  list(): Artifact[] {
    return this.repo.snapshot();
  }

  get(id: string): Artifact {
    const artifact = this.repo.snapshot().find((item) => item.id === id);
    if (!artifact) {
      throw new NotFoundException(`Artifact ${id} not found`);
    }
    return artifact;
  }

  async upsertFromStage(run: PipelineRun, stage: LifecycleStageKey): Promise<void> {
    if (run.status === "failed" || run.status === "canceled") return;
    if (run.executor?.backend !== "tekton" && run.executor?.backend !== "local-docker") return;
    const artifact = buildStageArtifact(run, stage);
    if (!artifact) return;
    const existing = this.repo.snapshot().find(
      (item) =>
        item.runId === run.id &&
        item.type === artifact.type &&
        item.name === artifact.name &&
        item.digest === artifact.digest,
    );
    if (existing) return;
    await this.repo.prepend(artifact);
  }

  async upsertFromRun(run: PipelineRun, type: Artifact["type"] = "image"): Promise<void> {
    if (run.status === "failed" || run.status === "canceled") return;
    if (type === "image" && !realImageDigest(run)) return;
    if (type === "provenance" && run.executor?.backend !== "tekton") return;
    const existing = this.repo.snapshot().find((item) => item.runId === run.id && item.type === type);
    if (existing) return;
    const image = resolveImageArtifact(run.definitionSnapshot, run);

    const artifact: Artifact = {
      id: createStableId("artifact"),
      runId: run.id,
      name:
        type === "provenance"
          ? `attestation/${run.applicationId}/${run.id}.intoto.jsonl`
          : image.imageRef,
      version: type === "image" ? image.tag : `${run.environment}-${run.id}`,
      type,
      digest: type === "image" ? realImageDigest(run) ?? stageDigest(run, type) : stageDigest(run, type),
      size: type === "provenance" ? "18 KB" : "218 MB",
      signed: run.executor?.backend === "tekton" && (run.status === "success" || type === "provenance"),
      uploadedAt: new Date().toISOString(),
    };
    await this.repo.prepend(artifact);
  }
}

function buildStageArtifact(run: PipelineRun, stage: LifecycleStageKey): Artifact | undefined {
  const image = resolveImageArtifact(run.definitionSnapshot, run);
  const commit = run.commit.slice(0, 8);
  const uploadedAt = new Date().toISOString();
  const base = {
    id: createStableId("artifact"),
    runId: run.id,
    version: `${run.environment}-${run.id}-${commit}`,
    digest: stageDigest(run, stage),
    uploadedAt,
  };

  if (stage === "source") {
    return undefined;
  }
  if (stage === "test") {
    return undefined;
  }
  if (stage === "build") {
    const packagePath = typeof run.stages.find((item) => item.key === "build")?.metadata.packagePath === "string"
      ? String(run.stages.find((item) => item.key === "build")?.metadata.packagePath)
      : "";
    const packageDigest = typeof run.stages.find((item) => item.key === "build")?.metadata.packageDigest === "string"
      ? String(run.stages.find((item) => item.key === "build")?.metadata.packageDigest)
      : "";
    if (!packagePath || !packageDigest) return undefined;
    return {
      ...base,
      name: packagePath,
      type: "package",
      digest: packageDigest,
      size: "generated",
      signed: false,
    };
  }
  if (stage === "package") {
    return undefined;
  }
  if (stage === "upload") {
    if (run.definitionSnapshot.buildConfig?.packageMode && run.definitionSnapshot.buildConfig.packageMode !== "container_image") {
      const uploadStage = run.stages.find((item) => item.key === "upload");
      const packagePath = typeof uploadStage?.metadata.packagePath === "string" ? uploadStage.metadata.packagePath : "";
      const packageDigest = typeof uploadStage?.metadata.packageDigest === "string" ? uploadStage.metadata.packageDigest : "";
      const packageUri = typeof uploadStage?.metadata.packageUri === "string" ? uploadStage.metadata.packageUri : "";
      const publicUrl = typeof uploadStage?.metadata.packagePublicUrl === "string" ? uploadStage.metadata.packagePublicUrl : "";
      const storageProvider = typeof uploadStage?.metadata.packageStorageProvider === "string"
        ? uploadStage.metadata.packageStorageProvider as Artifact["storageProvider"]
        : run.definitionSnapshot.packageUpload?.provider;
      if (!packageDigest || !packageUri) return undefined;
      return {
        ...base,
        name: packagePath || packageUri,
        type: "package",
        digest: packageDigest,
        size: "generated",
        signed: false,
        uri: packageUri,
        publicUrl,
        storageProvider,
      };
    }
    const imageDigest = realImageDigest(run);
    if (!imageDigest) return undefined;
    return {
      ...base,
      name: image.imageRef,
      version: image.tag,
      type: "image",
      digest: imageDigest,
      size: "218 MB",
      signed: run.executor?.backend === "tekton",
      uri: image.imageRef,
      storageProvider: image.registryProvider,
    };
  }
  if (stage === "promote") {
    return undefined;
  }
  return undefined;
}

function realImageDigest(run: PipelineRun): string | undefined {
  const uploadStage = run.stages.find((stage) => stage.key === "upload");
  const value = uploadStage?.metadata.imageDigest;
  return typeof value === "string" && value.startsWith("sha256:") ? value : undefined;
}

function stageDigest(run: PipelineRun, stage: string): string {
  const seed = `${run.commit}:${run.id}:${stage}:${run.refName}`;
  const hex = Array.from(seed)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 64)
    .padEnd(64, "0");
  return `sha256:${hex}`;
}
