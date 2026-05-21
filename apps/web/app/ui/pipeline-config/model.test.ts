import { describe, expect, it } from "vitest";
import type { LifecycleStageKey, PackageMode } from "@deploy-management/shared";
import {
  stageLabelForPackageMode,
  taskDefinitionForPackageMode,
  taskDefinitionsForPackageMode,
} from "./model";

function task(packageMode: PackageMode, stage: LifecycleStageKey) {
  const definition = taskDefinitionForPackageMode(packageMode, stage);
  expect(definition).toBeDefined();
  return definition!;
}

describe("package-mode task definitions", () => {
  it("renders image pipelines as Docker image build and Kubernetes rollout tasks", () => {
    const upload = task("container_image", "upload");
    const deploy = task("container_image", "deploy");

    expect(upload.name).toBe("镜像构建并推送");
    expect(upload.taskRef).toBe("image-build-push-task");
    expect(upload.paramKeys).toContain("IMAGE_REF");
    expect(upload.workspaces).toContain("docker-config");
    expect(deploy.name).toBe("Kubernetes 镜像部署");
    expect(deploy.operations.join(" / ")).toContain("kubectl");
  });

  it("renders static site pipelines as OSS/CDN package release tasks", () => {
    const upload = task("static_site", "upload");
    const deploy = task("static_site", "deploy");
    const canary = task("static_site", "canary");

    expect(upload.name).toBe("OSS/CDN 静态包上传");
    expect(upload.taskRef).toBe("static-site-upload-task");
    expect(upload.paramKeys).toContain("PACKAGE_UPLOAD_ENDPOINT");
    expect(upload.workspaces).not.toContain("kubeconfig");
    expect(deploy.name).toBe("静态站点版本切换");
    expect(canary.name).toBe("CDN 分组灰度");
  });

  it("renders host, manifest, and helm pipelines with different release surfaces", () => {
    expect(task("server_package", "deploy").name).toBe("主机批次部署");
    expect(task("server_package", "canary").taskRef).toBe("host-batch-canary-task");
    expect(task("kubernetes_manifest", "deploy").name).toBe("kubectl 应用 Manifest");
    expect(task("kubernetes_manifest", "package").taskRef).toBe("manifest-package-task");
    expect(task("helm_chart", "deploy").name).toBe("Helm Release 升级");
    expect(task("helm_chart", "upload").taskRef).toBe("helm-chart-push-task");
  });

  it("uses package-mode stage labels for graph and stage badges", () => {
    expect(stageLabelForPackageMode("static_site", "deploy")).toBe("站点入口");
    expect(stageLabelForPackageMode("server_package", "canary")).toBe("实例灰度");
    expect(stageLabelForPackageMode("helm_chart", "upload")).toBe("Chart 仓库");
  });

  it("keeps release-surface stages available for each package mode", () => {
    for (const packageMode of ["container_image", "static_site", "server_package", "kubernetes_manifest", "helm_chart"] as const) {
      const stages = new Set(taskDefinitionsForPackageMode(packageMode).map((definition) => definition.stage));
      for (const stage of ["package", "upload", "deploy", "canary", "promote"] as const) {
        expect(stages.has(stage)).toBe(true);
      }
    }
  });
});
