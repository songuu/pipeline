"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePipelineSchema = exports.createPipelineSchema = void 0;
const zod_1 = require("zod");
const shared_1 = require("@deploy-management/shared");
const sourcePolicySchema = zod_1.z.object({
    allowedBranchPatterns: zod_1.z.array(zod_1.z.string().min(1).max(120)).min(1).max(20),
    allowedTagPatterns: zod_1.z.array(zod_1.z.string().min(1).max(120)).max(20),
    allowRuntimeBranch: zod_1.z.boolean(),
    allowRuntimeTag: zod_1.z.boolean(),
    allowRuntimeCommit: zod_1.z.boolean(),
});
const lifecycleStageSchema = zod_1.z.enum([
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
const globalParamSchema = zod_1.z.object({
    key: zod_1.z.string().min(1),
    value: zod_1.z.string(),
    encrypted: zod_1.z.boolean().optional(),
    description: zod_1.z.string().optional(),
    injectionTiming: zod_1.z.enum(["build", "runtime", "deploy"]).optional(),
    targetStages: zod_1.z.array(lifecycleStageSchema).optional(),
});
const imageArtifactSchema = zod_1.z.object({
    registryProvider: zod_1.z.enum(shared_1.IMAGE_REGISTRY_PROVIDERS).optional(),
    region: zod_1.z.string().max(64).optional(),
    registryUrl: zod_1.z.string().min(1).max(2048),
    internalRegistryUrl: zod_1.z.string().max(2048).optional(),
    useInternalRegistry: zod_1.z.boolean().optional(),
    namespace: zod_1.z.string().min(1).max(256),
    imageName: zod_1.z.string().min(1).max(256),
    tagTemplate: zod_1.z.string().min(1).max(256),
    serviceConnection: zod_1.z.string().min(1).max(128),
    privateRegistry: zod_1.z.boolean(),
    registryUsername: zod_1.z.string().max(256).optional(),
    dockerConfigSecret: zod_1.z.string().max(256).optional(),
    dockerfilePath: zod_1.z.string().min(1).max(512),
    contextPath: zod_1.z.string().min(1).max(512),
});
const buildConfigSchema = zod_1.z.object({
    packageMode: zod_1.z.enum(shared_1.PACKAGE_MODES).optional(),
    runtime: zod_1.z.enum(["node", "go", "generic"]).optional(),
    packageBuildScript: zod_1.z.string().min(1).max(120),
    packageOutputPaths: zod_1.z.array(zod_1.z.string().min(1).max(256)).min(1).max(12),
});
exports.createPipelineSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(120),
    applicationId: zod_1.z.string().min(1),
    repositoryId: zod_1.z.string().min(1),
    repositoryUrl: zod_1.z.string().max(2048).optional(),
    refType: zod_1.z.enum(["branch", "tag"]),
    refName: zod_1.z.string().min(1),
    sourcePolicy: sourcePolicySchema.optional(),
    targetEnvironment: zod_1.z.enum(["dev", "test", "staging", "prod"]),
    strategy: zod_1.z.enum(["rolling", "canary", "blue_green"]),
    canaryPercent: zod_1.z.number().int().min(0).max(100),
    requiresApproval: zod_1.z.boolean(),
    stages: zod_1.z.array(lifecycleStageSchema).min(1),
    triggers: zod_1.z.array(zod_1.z.string()),
    owner: zod_1.z.string().min(1),
    variables: zod_1.z.array(globalParamSchema).optional(),
    runtimeVariables: zod_1.z.array(globalParamSchema).optional(),
    caches: zod_1.z
        .array(zod_1.z.object({
        key: zod_1.z.string().min(1),
        path: zod_1.z.string().min(1),
        restoreKeys: zod_1.z.array(zod_1.z.string()),
        enabled: zod_1.z.boolean(),
    }))
        .optional(),
    serviceConnections: zod_1.z.array(zod_1.z.string()).optional(),
    imageArtifact: imageArtifactSchema.optional(),
    buildConfig: buildConfigSchema.optional(),
});
exports.updatePipelineSchema = exports.createPipelineSchema.partial().extend({
    name: zod_1.z.string().min(1).max(120).optional(),
});
//# sourceMappingURL=create-pipeline.dto.js.map