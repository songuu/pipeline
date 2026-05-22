import { describe, expect, it } from "vitest";
import { pipelineTemplates } from "./templates";

describe("pipelineTemplates", () => {
  it("includes a frontend static-site pipeline that waits for user-entered command and domain", () => {
    const template = pipelineTemplates.find((item) => item.key === "node-frontend-custom-static");
    const variableMap = new Map(template?.variables?.map((variable) => [variable.key, variable.value]) ?? []);

    expect(template).toBeTruthy();
    expect(template?.packageMode).toBe("static_site");
    expect(template?.buildConfig.packageBuildCommandMode).toBe("custom");
    expect(template?.buildConfig.packageBuildCommand).toBeUndefined();
    expect(variableMap.get("PUBLIC_BASE_URL")).toBe("");
    expect(variableMap.get("BUILD_ARGS")).toBe("");
    expect(template?.packageUpload?.provider).toBe("static-server");
    expect(template?.packageUpload?.publicBaseUrl).toBeUndefined();
    expect(template?.packageUpload?.accessDomain).toBeUndefined();
    expect(template?.settings.some((setting) => setting.value.includes("使用者填写"))).toBe(true);
    expect(template?.serviceConnections).toContain(template?.packageUpload?.serviceConnection);
  });
});
