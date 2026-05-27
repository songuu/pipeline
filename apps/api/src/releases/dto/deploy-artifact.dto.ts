import { z } from "zod";
import { PACKAGE_MODES } from "@deploy-management/shared";

const canaryTrafficRegionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  percent: z.number().int().min(0).max(100),
  enabled: z.boolean(),
});

const rolloutPolicySchema = z.object({
  enabled: z.boolean().optional(),
  steps: z.array(z.number().int().min(0).max(100)).min(1).max(10).optional(),
  regions: z.array(canaryTrafficRegionSchema).max(16).optional(),
  autoPromote: z.boolean().optional(),
  analysisWindowSeconds: z.number().int().min(10).max(86_400).optional(),
  minSuccessRate: z.number().min(0).max(100).optional(),
  maxErrorRate: z.number().min(0).max(100).optional(),
  maxP95LatencyMs: z.number().int().min(1).max(120_000).optional(),
  rollbackOnFailure: z.boolean().optional(),
});

const rolloutStrategySchema = z.discriminatedUnion("packageMode", [
  z.object({
    packageMode: z.literal("container_image"),
    policy: z.object({
      enabled: z.boolean(),
      steps: z.array(z.number().int().min(1).max(100)).min(1).max(10),
      regions: z.array(canaryTrafficRegionSchema).max(16).optional(),
      autoPromote: z.boolean(),
      analysisWindowSeconds: z.number().int().min(10).max(86_400),
      minSuccessRate: z.number().min(0).max(100),
      maxErrorRate: z.number().min(0).max(100),
      maxP95LatencyMs: z.number().int().min(1).max(120_000),
      rollbackOnFailure: z.boolean(),
    }),
  }),
  z.object({
    packageMode: z.literal("static_site"),
    policy: z.object({
      enabled: z.boolean(),
      cohorts: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
      entryPath: z.string().trim().min(1).max(512),
      cdnProvider: z.enum(["aliyun-oss", "cdn", "custom"]),
      cacheTtlSeconds: z.number().int().min(0).max(86_400),
      rollbackOnFailure: z.boolean(),
    }),
  }),
  z.object({
    packageMode: z.literal("server_package"),
    policy: z.object({
      enabled: z.boolean(),
      batches: z.array(z.number().int().min(1).max(100)).min(1).max(10),
      healthCheckPath: z.string().trim().min(1).max(512),
      instanceSelector: z.string().trim().min(1).max(512),
      maxUnavailable: z.number().int().min(0).max(100),
      rollbackOnFailure: z.boolean(),
    }),
  }),
  z.object({
    packageMode: z.literal("kubernetes_manifest"),
    policy: z.object({
      enabled: z.boolean(),
      controller: z.enum(["deployment", "ingress", "service-mesh", "argo-rollouts"]),
      workloadName: z.string().trim().min(1).max(256),
      serviceName: z.string().trim().min(1).max(256).optional(),
      ingressName: z.string().trim().min(1).max(256).optional(),
      steps: z.array(z.number().int().min(1).max(100)).min(1).max(10),
      analysisWindowSeconds: z.number().int().min(10).max(86_400),
      rollbackOnFailure: z.boolean(),
    }),
  }),
  z.object({
    packageMode: z.literal("helm_chart"),
    policy: z.object({
      enabled: z.boolean(),
      releaseName: z.string().trim().min(1).max(256),
      chart: z.string().trim().min(1).max(512),
      namespace: z.string().trim().min(1).max(256).optional(),
      valuesPath: z.string().trim().min(1).max(512).optional(),
      steps: z.array(z.number().int().min(1).max(100)).min(1).max(10),
      rollbackOnFailure: z.boolean(),
    }),
  }),
]);

export const deployArtifactSchema = z.object({
  environment: z.enum(["dev", "test", "staging", "prod"]).optional(),
  actor: z.string().trim().min(1).optional(),
  strategy: z.enum(["rolling", "canary", "blue_green"]).optional(),
  canaryPercent: z.number().int().min(0).max(100).optional(),
  packageMode: z.enum(PACKAGE_MODES).optional(),
  deploymentTargetId: z.string().trim().min(1).optional(),
  releasePlanId: z.string().trim().min(1).optional(),
  baselineArtifactId: z.string().trim().min(1).max(128).optional(),
  rolloutPolicy: rolloutPolicySchema.optional(),
  rolloutStrategy: rolloutStrategySchema.optional(),
  namespace: z.string().trim().min(1).optional(),
  serviceConnection: z.string().trim().min(1).optional(),
  target: z.enum(["local-docker", "local-filesystem", "kubernetes", "helm"]).optional(),
  hostPort: z.number().int().min(1).max(65535).optional(),
  containerPort: z.number().int().min(1).max(65535).optional(),
  containerName: z.string().trim().min(1).optional(),
});

export type DeployArtifactDto = z.infer<typeof deployArtifactSchema>;

export const canaryActionSchema = z.object({
  actor: z.string().trim().min(1).optional(),
  reason: z.string().trim().max(500).optional(),
  targetPercent: z.number().int().min(0).max(100).optional(),
  analysis: z.object({
    status: z.enum(["healthy", "warning", "failed", "unknown"]).optional(),
    sampledAt: z.string().trim().optional(),
    requestCount: z.number().int().min(0).optional(),
    successRate: z.number().min(0).max(100).optional(),
    errorRate: z.number().min(0).max(100).optional(),
    p95LatencyMs: z.number().int().min(0).optional(),
    message: z.string().trim().max(500).optional(),
  }).optional(),
});

export type CanaryActionDto = z.infer<typeof canaryActionSchema>;
