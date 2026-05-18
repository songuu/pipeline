"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArtifactsService = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@deploy-management/shared");
const ids_1 = require("../common/ids");
const artifacts_repository_1 = require("./artifacts.repository");
let ArtifactsService = class ArtifactsService {
    repo;
    constructor(repo) {
        this.repo = repo;
    }
    list() {
        return this.repo.snapshot();
    }
    get(id) {
        const artifact = this.repo.snapshot().find((item) => item.id === id);
        if (!artifact) {
            throw new common_1.NotFoundException(`Artifact ${id} not found`);
        }
        return artifact;
    }
    async upsertFromStage(run, stage) {
        if (run.status === "failed" || run.status === "canceled")
            return;
        if (run.executor?.backend !== "tekton" && run.executor?.backend !== "local-docker")
            return;
        const artifact = buildStageArtifact(run, stage);
        if (!artifact)
            return;
        const existing = this.repo.snapshot().find((item) => item.runId === run.id &&
            item.type === artifact.type &&
            item.name === artifact.name &&
            item.digest === artifact.digest);
        if (existing)
            return;
        await this.repo.prepend(artifact);
    }
    async upsertFromRun(run, type = "image") {
        if (run.status === "failed" || run.status === "canceled")
            return;
        if (type === "image" && !realImageDigest(run))
            return;
        if (type === "provenance" && run.executor?.backend !== "tekton")
            return;
        const existing = this.repo.snapshot().find((item) => item.runId === run.id && item.type === type);
        if (existing)
            return;
        const image = (0, shared_1.resolveImageArtifact)(run.definitionSnapshot, run);
        const artifact = {
            id: (0, ids_1.createStableId)("artifact"),
            runId: run.id,
            name: type === "provenance"
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
};
exports.ArtifactsService = ArtifactsService;
exports.ArtifactsService = ArtifactsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(artifacts_repository_1.ArtifactsRepository)),
    __metadata("design:paramtypes", [artifacts_repository_1.ArtifactsRepository])
], ArtifactsService);
function buildStageArtifact(run, stage) {
    const image = (0, shared_1.resolveImageArtifact)(run.definitionSnapshot, run);
    const commit = run.commit.slice(0, 8);
    const uploadedAt = new Date().toISOString();
    const base = {
        id: (0, ids_1.createStableId)("artifact"),
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
        if (!packagePath || !packageDigest)
            return undefined;
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
        const imageDigest = realImageDigest(run);
        if (!imageDigest)
            return undefined;
        return {
            ...base,
            name: image.imageRef,
            version: image.tag,
            type: "image",
            digest: imageDigest,
            size: "218 MB",
            signed: run.executor?.backend === "tekton",
        };
    }
    if (stage === "promote") {
        return undefined;
    }
    return undefined;
}
function realImageDigest(run) {
    const uploadStage = run.stages.find((stage) => stage.key === "upload");
    const value = uploadStage?.metadata.imageDigest;
    return typeof value === "string" && value.startsWith("sha256:") ? value : undefined;
}
function stageDigest(run, stage) {
    const seed = `${run.commit}:${run.id}:${stage}:${run.refName}`;
    const hex = Array.from(seed)
        .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 64)
        .padEnd(64, "0");
    return `sha256:${hex}`;
}
//# sourceMappingURL=artifacts.service.js.map