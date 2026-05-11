import { z } from "zod";

const sourcePolicySchema = z.object({
  allowedBranchPatterns: z.array(z.string().min(1).max(120)).min(1).max(20),
  allowedTagPatterns: z.array(z.string().min(1).max(120)).max(20),
  allowRuntimeBranch: z.boolean(),
  allowRuntimeTag: z.boolean(),
  allowRuntimeCommit: z.boolean(),
});

export const createPipelineSchema = z.object({
  name: z.string().min(1).max(120),
  applicationId: z.string().min(1),
  repositoryId: z.string().min(1),
  refType: z.enum(["branch", "tag"]),
  refName: z.string().min(1),
  sourcePolicy: sourcePolicySchema.optional(),
  targetEnvironment: z.enum(["dev", "test", "staging", "prod"]),
  strategy: z.enum(["rolling", "canary", "blue_green"]),
  canaryPercent: z.number().int().min(0).max(100),
  requiresApproval: z.boolean(),
  stages: z
    .array(
      z.enum([
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
      ]),
    )
    .min(1),
  triggers: z.array(z.string()),
  owner: z.string().min(1),
  variables: z
    .array(z.object({ key: z.string().min(1), value: z.string(), encrypted: z.boolean().optional(), description: z.string().optional() }))
    .optional(),
  runtimeVariables: z
    .array(z.object({ key: z.string().min(1), value: z.string(), encrypted: z.boolean().optional(), description: z.string().optional() }))
    .optional(),
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
});

export type CreatePipelineDto = z.infer<typeof createPipelineSchema>;

export const updatePipelineSchema = createPipelineSchema.partial().extend({
  name: z.string().min(1).max(120).optional(),
});

export type UpdatePipelineDto = z.infer<typeof updatePipelineSchema>;
