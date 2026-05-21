import { z } from "zod";
import {
  IMAGE_REGISTRY_PROVIDERS,
  PACKAGE_BUILD_COMMAND_MODES,
  PACKAGE_MODES,
  PACKAGE_UPLOAD_COMMAND_MODES,
  PACKAGE_UPLOAD_PROVIDERS,
} from "@deploy-management/shared";

const sourcePolicySchema = z.object({
  allowedBranchPatterns: z.array(z.string().min(1).max(120)).min(1).max(20),
  allowedTagPatterns: z.array(z.string().min(1).max(120)).max(20),
  allowRuntimeBranch: z.boolean(),
  allowRuntimeTag: z.boolean(),
  allowRuntimeCommit: z.boolean(),
});

const lifecycleStageSchema = z.enum([
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

const globalParamSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  encrypted: z.boolean().optional(),
  description: z.string().optional(),
  injectionTiming: z.enum(["build", "runtime", "deploy"]).optional(),
  targetStages: z.array(lifecycleStageSchema).optional(),
});

const imageArtifactSchema = z.object({
  registryProvider: z.enum(IMAGE_REGISTRY_PROVIDERS).optional(),
  region: z.string().max(64).optional(),
  registryUrl: z.string().min(1).max(2048),
  internalRegistryUrl: z.string().max(2048).optional(),
  useInternalRegistry: z.boolean().optional(),
  namespace: z.string().min(1).max(256),
  imageName: z.string().min(1).max(256),
  tagTemplate: z.string().min(1).max(256),
  serviceConnection: z.string().min(1).max(128),
  privateRegistry: z.boolean(),
  registryUsername: z.string().max(256).optional(),
  dockerConfigSecret: z.string().max(256).optional(),
  dockerfilePath: z.string().min(1).max(512),
  contextPath: z.string().min(1).max(512),
});

const buildConfigSchema = z.object({
  packageMode: z.enum(PACKAGE_MODES).optional(),
  runtime: z.enum(["node", "go", "generic"]).optional(),
  contextPath: z.string().min(1).max(512).optional(),
  packageBuildCommandMode: z.enum(PACKAGE_BUILD_COMMAND_MODES).optional(),
  packageBuildScript: z.string().min(1).max(120),
  packageBuildCommand: z.string().max(1024).optional(),
  packageOutputPaths: z.array(z.string().min(1).max(256)).min(1).max(12),
});

const packageUploadSchema = z.object({
  provider: z.enum(PACKAGE_UPLOAD_PROVIDERS),
  customUploadCommandMode: z.enum(PACKAGE_UPLOAD_COMMAND_MODES).optional(),
  endpoint: z.string().min(1).max(2048),
  publicBaseUrl: z.string().max(2048).optional(),
  accessDomain: z.string().max(2048).optional(),
  targetPathTemplate: z.string().min(1).max(512),
  serviceConnection: z.string().min(1).max(128),
  customUploadCommand: z.string().max(2048).optional(),
});

export const createPipelineSchema = z.object({
  name: z.string().min(1).max(120),
  applicationId: z.string().min(1),
  repositoryId: z.string().min(1),
  repositoryUrl: z.string().max(2048).optional(),
  refType: z.enum(["branch", "tag"]),
  refName: z.string().min(1),
  sourcePolicy: sourcePolicySchema.optional(),
  targetEnvironment: z.enum(["dev", "test", "staging", "prod"]),
  strategy: z.enum(["rolling", "canary", "blue_green"]),
  canaryPercent: z.number().int().min(0).max(100),
  requiresApproval: z.boolean(),
  stages: z.array(lifecycleStageSchema).min(1),
  triggers: z.array(z.string()),
  owner: z.string().min(1),
  variables: z.array(globalParamSchema).optional(),
  runtimeVariables: z.array(globalParamSchema).optional(),
  caches: z
    .array(
      z.object({
        key: z.string().min(1),
        path: z.string().min(1),
        restoreKeys: z.array(z.string()),
        enabled: z.boolean(),
      }),
    )
    .optional(),
  serviceConnections: z.array(z.string()).optional(),
  imageArtifact: imageArtifactSchema.optional(),
  buildConfig: buildConfigSchema.optional(),
  packageUpload: packageUploadSchema.optional(),
});

export type CreatePipelineDto = z.infer<typeof createPipelineSchema>;

export const updatePipelineSchema = createPipelineSchema.partial().extend({
  name: z.string().min(1).max(120).optional(),
});

export type UpdatePipelineDto = z.infer<typeof updatePipelineSchema>;
