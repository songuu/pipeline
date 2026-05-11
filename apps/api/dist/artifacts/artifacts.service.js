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
const artifacts_repository_1 = require("./artifacts.repository");
let ArtifactsService = class ArtifactsService {
    repo;
    constructor(repo) {
        this.repo = repo;
    }
    list() {
        return this.repo.snapshot();
    }
    async upsertFromRun(run, type = "image") {
        if (run.status === "failed" || run.status === "canceled")
            return;
        const existing = this.repo.snapshot().find((item) => item.runId === run.id && item.type === type);
        if (existing)
            return;
        const artifact = {
            id: `artifact-${this.repo.snapshot().length + 1}`,
            runId: run.id,
            name: type === "provenance"
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
};
exports.ArtifactsService = ArtifactsService;
exports.ArtifactsService = ArtifactsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(artifacts_repository_1.ArtifactsRepository)),
    __metadata("design:paramtypes", [artifacts_repository_1.ArtifactsRepository])
], ArtifactsService);
//# sourceMappingURL=artifacts.service.js.map