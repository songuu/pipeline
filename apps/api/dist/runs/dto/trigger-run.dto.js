"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.approvalDecisionParamSchema = exports.approvalDecisionSchema = exports.startPipelineRunSchema = exports.triggerRunSchema = void 0;
const zod_1 = require("zod");
const lifecycleStageEnum = zod_1.z.enum([
    "source",
    "test",
    "build",
    "env",
    "package",
    "upload",
    "deploy",
    "canary",
    "approval",
    "promote",
]);
// Actor identifier feeds into audit log entries and approval.decidedBy.
// Reject control characters, whitespace runs, and oversized values to prevent
// log forging and stop callers from bloating the in-memory audit history.
const actorSchema = zod_1.z.string().min(1).max(64).regex(/^[\p{L}\p{N}_.\-@]+$/u, "actor 仅支持字母、数字、_-.@");
const refSchema = zod_1.z.string().min(1).max(255);
const commitShaSchema = zod_1.z.string().min(7).max(40).regex(/^[a-f0-9]+$/i, "Commit SHA 必须是 7-40 位十六进制");
const repositoryAccessTokenSchema = zod_1.z.string().trim().min(1).max(4096);
const repositoryUrlSchema = zod_1.z.string().min(1).max(2048);
const envKeySchema = zod_1.z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/, "环境变量名必须大写字母+数字+下划线");
const envValueSchema = zod_1.z.string().max(4096);
const branchMap = zod_1.z.record(repositoryUrlSchema, refSchema).refine((value) => Object.keys(value).length <= 32, { message: "最多支持 32 个 repo branch 映射" });
const tagMap = zod_1.z.record(repositoryUrlSchema, refSchema).refine((value) => Object.keys(value).length <= 32, { message: "最多支持 32 个 repo tag 映射" });
const envMap = zod_1.z.record(envKeySchema, envValueSchema).refine((value) => Object.keys(value).length <= 50, { message: "最多支持 50 个全局变量" });
exports.triggerRunSchema = zod_1.z.object({
    repositoryId: zod_1.z.string().min(1).max(128).optional(),
    refType: zod_1.z.enum(["branch", "tag"]).optional(),
    refName: refSchema.optional(),
    branch: refSchema.optional(),
    tag: refSchema.optional(),
    commitSha: commitShaSchema.optional(),
    repositoryAccessToken: repositoryAccessTokenSchema.optional(),
    actor: actorSchema.optional(),
    environment: zod_1.z.enum(["dev", "test", "staging", "prod"]).optional(),
    canaryPercent: zod_1.z.number().int().min(0).max(100).optional(),
    stages: zod_1.z.array(lifecycleStageEnum).max(32).optional(),
});
exports.startPipelineRunSchema = zod_1.z.object({
    branchModeBranchs: zod_1.z.array(refSchema).max(32).optional(),
    envs: envMap.optional(),
    runningBranchs: branchMap.optional(),
    runningTags: tagMap.optional(),
    comment: zod_1.z.string().max(512).optional(),
});
exports.approvalDecisionSchema = zod_1.z.object({
    actor: actorSchema.optional(),
});
// Validates the URL :decision segment for approval endpoints. Used both at the
// legacy /api/* and /oapi/v1/flow/* surfaces.
exports.approvalDecisionParamSchema = zod_1.z.enum(["approved", "rejected"]);
//# sourceMappingURL=trigger-run.dto.js.map