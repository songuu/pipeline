import { describe, expect, it } from "vitest";
import {
  resolvePackageBuildCommandMode,
  resolvePackageUploadCommandMode,
  shouldRunCustomPackageBuildCommand,
  shouldRunCustomPackageUploadCommand,
  type PackageUploadConfig,
  type PipelineBuildConfig,
} from "./index";

const baseBuildConfig: PipelineBuildConfig = {
  packageBuildScript: "build",
  packageOutputPaths: ["dist"],
};

const baseUploadConfig: PackageUploadConfig = {
  provider: "local-filesystem",
  endpoint: ".codex-tmp/package-uploads",
  targetPathTemplate: "apps/web/${run.id}.tar.gz",
  serviceConnection: "local-package-store",
};

describe("pipeline command mode", () => {
  it("keeps existing custom build commands active for compatibility", () => {
    const config = { ...baseBuildConfig, packageBuildCommand: "pnpm --filter web build" };

    expect(resolvePackageBuildCommandMode(config)).toBe("custom");
    expect(shouldRunCustomPackageBuildCommand(config)).toBe(true);
  });

  it("can keep a typed custom build command without executing it when script mode is selected", () => {
    const config = {
      ...baseBuildConfig,
      packageBuildCommandMode: "script" as const,
      packageBuildCommand: "pnpm --filter web build",
    };

    expect(resolvePackageBuildCommandMode(config)).toBe("script");
    expect(shouldRunCustomPackageBuildCommand(config)).toBe(false);
  });

  it("can keep a typed upload command without executing it when provider mode is selected", () => {
    const config = {
      ...baseUploadConfig,
      customUploadCommandMode: "provider" as const,
      customUploadCommand: "ossutil cp $PACKAGE_ARCHIVE_PATH $PACKAGE_URI",
    };

    expect(resolvePackageUploadCommandMode(config)).toBe("provider");
    expect(shouldRunCustomPackageUploadCommand(config)).toBe(false);
  });

  it("keeps the custom upload provider on custom mode even without a command", () => {
    const config = { ...baseUploadConfig, provider: "custom" as const };

    expect(resolvePackageUploadCommandMode(config)).toBe("custom");
    expect(shouldRunCustomPackageUploadCommand(config)).toBe(false);
  });
});
