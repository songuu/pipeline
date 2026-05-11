import { z } from "zod";

const lifecycleStageEnum = z.enum([
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
const actorSchema = z.string().min(1).max(64).regex(/^[\p{L}\p{N}_.\-@]+$/u, "actor 仅支持字母、数字、_-.@");

const refSchema = z.string().min(1).max(255);
const commitShaSchema = z.string().min(7).max(40).regex(/^[a-f0-9]+$/i, "Commit SHA 必须是 7-40 位十六进制");
const repositoryUrlSchema = z.string().min(1).max(2048);
const envKeySchema = z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/, "环境变量名必须大写字母+数字+下划线");
const envValueSchema = z.string().max(4096);

const branchMap = z.record(repositoryUrlSchema, refSchema).refine(
  (value) => Object.keys(value).length <= 32,
  { message: "最多支持 32 个 repo branch 映射" },
);
const tagMap = z.record(repositoryUrlSchema, refSchema).refine(
  (value) => Object.keys(value).length <= 32,
  { message: "最多支持 32 个 repo tag 映射" },
);
const envMap = z.record(envKeySchema, envValueSchema).refine(
  (value) => Object.keys(value).length <= 50,
  { message: "最多支持 50 个全局变量" },
);

export const triggerRunSchema = z.object({
  repositoryId: z.string().min(1).max(128).optional(),
  refType: z.enum(["branch", "tag"]).optional(),
  refName: refSchema.optional(),
  branch: refSchema.optional(),
  tag: refSchema.optional(),
  commitSha: commitShaSchema.optional(),
  actor: actorSchema.optional(),
  environment: z.enum(["dev", "test", "staging", "prod"]).optional(),
  canaryPercent: z.number().int().min(0).max(100).optional(),
  stages: z.array(lifecycleStageEnum).max(32).optional(),
});

export type TriggerRunDto = z.infer<typeof triggerRunSchema>;

export const startPipelineRunSchema = z.object({
  branchModeBranchs: z.array(refSchema).max(32).optional(),
  envs: envMap.optional(),
  runningBranchs: branchMap.optional(),
  runningTags: tagMap.optional(),
  comment: z.string().max(512).optional(),
});

export type StartPipelineRunDto = z.infer<typeof startPipelineRunSchema>;

export const approvalDecisionSchema = z.object({
  actor: actorSchema.optional(),
});

export type ApprovalDecisionDto = z.infer<typeof approvalDecisionSchema>;

// Validates the URL :decision segment for approval endpoints. Used both at the
// legacy /api/* and /oapi/v1/flow/* surfaces.
export const approvalDecisionParamSchema = z.enum(["approved", "rejected"]);
export type ApprovalDecisionParam = z.infer<typeof approvalDecisionParamSchema>;
