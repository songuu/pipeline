import { describe, expect, it } from "vitest";
import type { PackageMode, PipelineDefinition, PipelineRun } from "@deploy-management/shared";
import { buildStageLogs, stageTitleForRun } from "./stage-templates";

function makeRun(packageMode: PackageMode): PipelineRun {
  const definition: PipelineDefinition = {
    id: `pipeline-${packageMode}`,
    name: `${packageMode}-pipeline`,
    applicationId: "demo-app",
    repositoryId: "repo-1",
    repository: "https://example.com/demo.git",
    defaultBranch: "main",
    defaultRefType: "branch",
    defaultRef: "main",
    sourcePolicy: {
      allowedBranchPatterns: ["main"],
      allowedTagPatterns: [],
      allowRuntimeBranch: true,
      allowRuntimeTag: false,
      allowRuntimeCommit: false,
    },
    targetEnvironment: "staging",
    strategy: "canary",
    canaryPercent: 20,
    requiresApproval: false,
    stages: ["source", "build", "package", "upload", "deploy", "canary", "promote"],
    triggers: ["manual"],
    owner: "team",
    buildConfig: {
      packageMode,
      runtime: "node",
      contextPath: ".",
      packageBuildCommandMode: "script",
      packageBuildScript: "build",
      packageOutputPaths: packageMode === "helm_chart" ? ["chart"] : ["dist"],
    },
    imageArtifact: {
      registryProvider: "custom",
      registryUrl: "registry.example.com",
      namespace: "demo",
      imageName: "app",
      tagTemplate: "${run.id}",
      privateRegistry: true,
      dockerfilePath: "Dockerfile",
      contextPath: ".",
      serviceConnection: "registry",
    },
    packageUpload: {
      provider: "oss",
      customUploadCommandMode: "provider",
      endpoint: "oss://bucket",
      targetPathTemplate: "${application.id}/${run.id}/${artifact.name}",
      serviceConnection: "oss-deploy",
    },
  };
  return {
    id: "run-1",
    pipelineId: definition.id,
    pipelineName: definition.name,
    applicationId: definition.applicationId,
    applicationName: "demo",
    actor: "RO",
    repositoryId: definition.repositoryId,
    repository: definition.repository,
    refType: "branch",
    refName: "main",
    branch: "main",
    commit: "abcdef1",
    environment: "staging",
    status: "running",
    progress: 0,
    canaryPercent: 20,
    createdAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:00:00.000Z",
    definitionSnapshot: definition,
    stages: [],
  };
}

describe("stage templates by package mode", () => {
  it("uses Docker image logs for container image upload and deploy", () => {
    const run = makeRun("container_image");

    expect(buildStageLogs("upload", run, "success").join("\n")).toContain("docker build");
    expect(buildStageLogs("deploy", run, "success").join("\n")).toContain("Kubernetes");
    expect(stageTitleForRun("deploy", run)).toBe("Kubernetes 镜像部署");
  });

  it("uses OSS/CDN logs for static site pipelines", () => {
    const run = makeRun("static_site");
    const logs = buildStageLogs("deploy", run, "success").join("\n");

    expect(buildStageLogs("upload", run, "success").join("\n")).toContain("OSS/CDN");
    expect(logs).toContain("静态站点");
    expect(logs).toContain("CDN");
    expect(stageTitleForRun("canary", run)).toBe("CDN 分组灰度");
  });

  it("uses host, manifest, and helm terminology for non-image release modes", () => {
    expect(buildStageLogs("deploy", makeRun("server_package"), "success").join("\n")).toContain("主机");
    expect(buildStageLogs("deploy", makeRun("kubernetes_manifest"), "success").join("\n")).toContain("kubectl apply");
    expect(buildStageLogs("deploy", makeRun("helm_chart"), "success").join("\n")).toContain("helm upgrade");
  });
});
