"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePipelineSchema = exports.createPipelineSchema = void 0;
const zod_1 = require("zod");
const sourcePolicySchema = zod_1.z.object({
    allowedBranchPatterns: zod_1.z.array(zod_1.z.string().min(1).max(120)).min(1).max(20),
    allowedTagPatterns: zod_1.z.array(zod_1.z.string().min(1).max(120)).max(20),
    allowRuntimeBranch: zod_1.z.boolean(),
    allowRuntimeTag: zod_1.z.boolean(),
    allowRuntimeCommit: zod_1.z.boolean(),
});
exports.createPipelineSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(120),
    applicationId: zod_1.z.string().min(1),
    repositoryId: zod_1.z.string().min(1),
    refType: zod_1.z.enum(["branch", "tag"]),
    refName: zod_1.z.string().min(1),
    sourcePolicy: sourcePolicySchema.optional(),
    targetEnvironment: zod_1.z.enum(["dev", "test", "staging", "prod"]),
    strategy: zod_1.z.enum(["rolling", "canary", "blue_green"]),
    canaryPercent: zod_1.z.number().int().min(0).max(100),
    requiresApproval: zod_1.z.boolean(),
    stages: zod_1.z
        .array(zod_1.z.enum([
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
    ]))
        .min(1),
    triggers: zod_1.z.array(zod_1.z.string()),
    owner: zod_1.z.string().min(1),
    variables: zod_1.z
        .array(zod_1.z.object({ key: zod_1.z.string().min(1), value: zod_1.z.string(), encrypted: zod_1.z.boolean().optional(), description: zod_1.z.string().optional() }))
        .optional(),
    runtimeVariables: zod_1.z
        .array(zod_1.z.object({ key: zod_1.z.string().min(1), value: zod_1.z.string(), encrypted: zod_1.z.boolean().optional(), description: zod_1.z.string().optional() }))
        .optional(),
    caches: zod_1.z
        .array(zod_1.z.object({
        key: zod_1.z.string().min(1),
        path: zod_1.z.string().min(1),
        restoreKeys: zod_1.z.array(zod_1.z.string()),
        enabled: zod_1.z.boolean(),
    }))
        .optional(),
    serviceConnections: zod_1.z.array(zod_1.z.string()).optional(),
});
exports.updatePipelineSchema = exports.createPipelineSchema.partial().extend({
    name: zod_1.z.string().min(1).max(120).optional(),
});
//# sourceMappingURL=create-pipeline.dto.js.map