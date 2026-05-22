import { describe, expect, it } from "vitest";
import { SEED_APPLICATIONS, SEED_PIPELINES, SEED_REPOSITORIES } from "./seed-data";

describe("seed data", () => {
  it("includes a frontend static-site pipeline that waits for user-entered command and domain", () => {
    const pipeline = SEED_PIPELINES.find((item) => item.id === "pipe-frontend-static-custom");
    const variableMap = new Map(pipeline?.variables?.map((variable) => [variable.key, variable.value]) ?? []);

    expect(pipeline).toBeTruthy();
    expect(SEED_APPLICATIONS.some((item) => item.id === pipeline?.applicationId)).toBe(true);
    expect(SEED_REPOSITORIES.some((item) => item.id === pipeline?.repositoryId)).toBe(true);
    expect(pipeline?.buildConfig?.packageMode).toBe("static_site");
    expect(pipeline?.buildConfig?.packageBuildCommandMode).toBe("custom");
    expect(pipeline?.buildConfig?.packageBuildCommand).toBeUndefined();
    expect(variableMap.get("PUBLIC_BASE_URL")).toBe("");
    expect(variableMap.get("BUILD_ARGS")).toBe("");
    expect(pipeline?.packageUpload?.provider).toBe("static-server");
    expect(pipeline?.packageUpload?.publicBaseUrl).toBeUndefined();
    expect(pipeline?.packageUpload?.accessDomain).toBeUndefined();
  });
});
