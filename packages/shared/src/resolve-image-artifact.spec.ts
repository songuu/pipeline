import { describe, expect, it } from "vitest";
import {
  IMAGE_REGISTRY_PRESETS,
  resolveImageArtifact,
  type ImageArtifactConfig,
  type PipelineDefinition,
  type PipelineRun,
} from "./index";

const aliyunAcrDefaultImageArtifact = IMAGE_REGISTRY_PRESETS["aliyun-acr"].defaults;

function makePipeline(overrides: Partial<PipelineDefinition> = {}): PipelineDefinition {
  return {
    id: "pipe-test",
    name: "test pipeline",
    applicationId: "app-test",
    repositoryId: "repo-test",
    repository: "https://github.com/owner/repo.git",
    defaultBranch: "main",
    defaultRefType: "branch",
    defaultRef: "main",
    sourcePolicy: {
      allowRuntimeBranch: true,
      allowRuntimeTag: true,
      allowRuntimeCommit: true,
      allowedBranchPatterns: ["*"],
      allowedTagPatterns: ["*"],
    },
    targetEnvironment: "prod",
    strategy: "canary",
    canaryPercent: 100,
    requiresApproval: false,
    stages: ["source", "build", "upload", "deploy"],
    triggers: [],
    owner: "test",
    imageArtifact: aliyunAcrDefaultImageArtifact,
    ...overrides,
  };
}

function makeRun(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: "run-42",
    pipelineId: "pipe-test",
    pipelineName: "test pipeline",
    applicationId: "app-test",
    applicationName: "test app",
    actor: "RO",
    repositoryId: "repo-test",
    repository: "https://github.com/owner/repo.git",
    refType: "branch",
    refName: "main",
    branch: "main",
    commit: "abcdef1234567890",
    environment: "prod",
    status: "queued",
    progress: 0,
    canaryPercent: 100,
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
    definitionSnapshot: makePipeline(),
    stages: [],
    ...overrides,
  };
}

describe("resolveImageArtifact", () => {
  it("renders ${run.id} and ${commit.short} into the tag", () => {
    const definition = makePipeline();
    const run = makeRun({ id: "run-42", commit: "abcdef1234567890" });
    const resolved = resolveImageArtifact(definition, run);
    expect(resolved.tag).toBe("run-42-abcdef12");
    expect(resolved.imageRef.endsWith(":run-42-abcdef12")).toBe(true);
  });

  it("falls back to literal placeholders when run is omitted", () => {
    const definition = makePipeline();
    const resolved = resolveImageArtifact(definition);
    expect(resolved.tag).toBe("run-commit");
  });

  it("substitutes ${ref.name} and ${environment} from run context", () => {
    const definition = makePipeline({
      imageArtifact: { ...aliyunAcrDefaultImageArtifact, tagTemplate: "${environment}-${ref.name}" },
    });
    const run = makeRun({ environment: "staging", refName: "release/2.0" });
    const resolved = resolveImageArtifact(definition, run);
    // sanitizeImageTag replaces "/" (not in [a-zA-Z0-9_.-]) with "-"
    expect(resolved.tag).toBe("staging-release-2.0");
  });

  it("sanitizes illegal characters in the rendered tag", () => {
    const definition = makePipeline({
      imageArtifact: { ...aliyunAcrDefaultImageArtifact, tagTemplate: "tag with spaces & symbols!" },
    });
    const resolved = resolveImageArtifact(definition);
    expect(resolved.tag).toMatch(/^[a-zA-Z0-9_.-]+$/);
    expect(resolved.tag).not.toContain(" ");
  });

  it("trims leading/trailing dashes from the sanitized tag", () => {
    const definition = makePipeline({
      imageArtifact: { ...aliyunAcrDefaultImageArtifact, tagTemplate: "  --abc--  " },
    });
    const resolved = resolveImageArtifact(definition);
    expect(resolved.tag.startsWith("-")).toBe(false);
    expect(resolved.tag.endsWith("-")).toBe(false);
  });

  it("caps the tag at 128 chars", () => {
    const definition = makePipeline({
      imageArtifact: { ...aliyunAcrDefaultImageArtifact, tagTemplate: "x".repeat(300) },
    });
    const resolved = resolveImageArtifact(definition);
    expect(resolved.tag.length).toBeLessThanOrEqual(128);
  });

  it("falls back to 'latest' when the rendered tag is empty after sanitization", () => {
    const definition = makePipeline({
      imageArtifact: { ...aliyunAcrDefaultImageArtifact, tagTemplate: "!!!" },
    });
    const resolved = resolveImageArtifact(definition);
    expect(resolved.tag).toBe("latest");
  });

  it("normalizes the registry URL by stripping protocol and trailing slashes", () => {
    const definition = makePipeline({
      imageArtifact: {
        ...aliyunAcrDefaultImageArtifact,
        registryUrl: "https://registry.example.com/",
      },
    });
    const resolved = resolveImageArtifact(definition);
    expect(resolved.registryUrl).toBe("registry.example.com");
    expect(resolved.repository.startsWith("registry.example.com/")).toBe(true);
  });

  it("uses internal registry URL when useInternalRegistry is true", () => {
    const definition = makePipeline({
      imageArtifact: {
        ...aliyunAcrDefaultImageArtifact,
        useInternalRegistry: true,
        internalRegistryUrl: "internal.registry.local",
      },
    });
    const resolved = resolveImageArtifact(definition);
    expect(resolved.registryUrl).toBe("internal.registry.local");
  });

  it("sanitizes namespace and imageName to lowercase docker-safe segments", () => {
    const definition = makePipeline({
      imageArtifact: {
        ...aliyunAcrDefaultImageArtifact,
        namespace: "My Org",
        imageName: "Cool App",
      },
    });
    const resolved = resolveImageArtifact(definition);
    expect(resolved.namespace).toBe("my-org");
    expect(resolved.imageName).toBe("cool-app");
  });

  it("collapses runs of illegal characters into a single dash but preserves trailing markers from the original input", () => {
    const definition = makePipeline({
      imageArtifact: {
        ...aliyunAcrDefaultImageArtifact,
        imageName: "service!!",
      },
    });
    const resolved = resolveImageArtifact(definition);
    // sanitizeImagePathSegment only strips leading/trailing slashes, not dashes.
    expect(resolved.imageName).toBe("service-");
  });

  it("composes imageRef as registry/namespace/imageName:tag", () => {
    const config: ImageArtifactConfig = {
      ...aliyunAcrDefaultImageArtifact,
      registryUrl: "registry.example.com",
      namespace: "team",
      imageName: "service",
      tagTemplate: "v1.0.0",
    };
    const resolved = resolveImageArtifact(makePipeline({ imageArtifact: config }));
    expect(resolved.imageRef).toBe("registry.example.com/team/service:v1.0.0");
  });
});
