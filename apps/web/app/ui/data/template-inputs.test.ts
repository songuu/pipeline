import { describe, expect, it } from "vitest";
import {
  FRONTEND_STATIC_TEMPLATE_KEY,
  applyFrontendTemplateInput,
  composeFrontendPackageBuildCommand,
} from "./template-inputs";

describe("frontend template inputs", () => {
  it("composes command and args into the executable package build command", () => {
    expect(
      composeFrontendPackageBuildCommand({
        buildCommand: " pnpm build ",
        buildArgs: " --mode staging --base / ",
        publicBaseUrl: "",
      }),
    ).toBe("pnpm build --mode staging --base /");
  });

  it("writes user-entered command, args, and domain into the create payload fields", () => {
    const result = applyFrontendTemplateInput(
      FRONTEND_STATIC_TEMPLATE_KEY,
      {
        buildConfig: {
          packageMode: "static_site",
          runtime: "node",
          contextPath: ".",
          packageBuildCommandMode: "custom",
          packageBuildScript: "build",
          packageOutputPaths: ["dist"],
        },
        variables: [
          {
            key: "PUBLIC_BASE_URL",
            value: "",
            injectionTiming: "build",
            targetStages: ["build"],
          },
        ],
        packageUpload: {
          provider: "static-server",
          customUploadCommandMode: "provider",
          endpoint: "https://static.example.com/frontend",
          targetPathTemplate: "${application.id}/${environment}/${run.id}/${artifact.name}",
          serviceConnection: "static-server-deploy",
        },
      },
      {
        buildCommand: "pnpm build",
        buildArgs: "--mode staging",
        publicBaseUrl: "https://app.company.com",
      },
    );

    expect(result.buildConfig.packageBuildCommand).toBe("pnpm build --mode staging");
    expect(result.variables.find((variable) => variable.key === "BUILD_ARGS")?.value).toBe("--mode staging");
    expect(result.variables.find((variable) => variable.key === "PUBLIC_BASE_URL")?.value).toBe("https://app.company.com");
    expect(result.packageUpload?.publicBaseUrl).toBe("https://app.company.com");
    expect(result.packageUpload?.accessDomain).toBe("https://app.company.com");
  });
});
