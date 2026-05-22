import type {
  GlobalParam,
  LifecycleStageKey,
  PackageUploadConfig,
  PipelineBuildConfig,
} from "@deploy-management/shared";

export const FRONTEND_STATIC_TEMPLATE_KEY = "node-frontend-custom-static";

export interface FrontendTemplateInput {
  buildCommand: string;
  buildArgs: string;
  publicBaseUrl: string;
}

export const emptyFrontendTemplateInput: FrontendTemplateInput = {
  buildCommand: "",
  buildArgs: "",
  publicBaseUrl: "",
};

export function composeFrontendPackageBuildCommand(input: FrontendTemplateInput): string {
  return [input.buildCommand.trim(), input.buildArgs.trim()].filter(Boolean).join(" ");
}

export function applyFrontendTemplateInput(
  templateKey: string,
  values: {
    buildConfig: PipelineBuildConfig;
    variables: GlobalParam[];
    packageUpload?: PackageUploadConfig;
  },
  input: FrontendTemplateInput,
): {
  buildConfig: PipelineBuildConfig;
  variables: GlobalParam[];
  packageUpload?: PackageUploadConfig;
} {
  if (templateKey !== FRONTEND_STATIC_TEMPLATE_KEY) return values;

  const packageBuildCommand = composeFrontendPackageBuildCommand(input);
  const publicBaseUrl = input.publicBaseUrl.trim();
  const { packageBuildCommand: _previousCommand, ...buildConfigWithoutCommand } = values.buildConfig;
  const buildConfig: PipelineBuildConfig = {
    ...buildConfigWithoutCommand,
    packageBuildCommandMode: "custom",
    ...(packageBuildCommand ? { packageBuildCommand } : {}),
  };
  const variables = upsertTemplateVariable(
    upsertTemplateVariable(
      values.variables,
      "PUBLIC_BASE_URL",
      publicBaseUrl,
      "使用者填写：前端构建时使用的公开访问域名。",
      ["build", "upload", "deploy"],
    ),
    "BUILD_ARGS",
    input.buildArgs.trim(),
    "使用者填写：前端打包命令需要的额外参数。",
    ["build"],
  );
  const packageUpload = values.packageUpload
    ? {
        ...values.packageUpload,
        ...(publicBaseUrl ? { publicBaseUrl, accessDomain: publicBaseUrl } : {}),
      }
    : undefined;

  return { buildConfig, variables, packageUpload };
}

function upsertTemplateVariable(
  variables: GlobalParam[],
  key: string,
  value: string,
  description: string,
  targetStages: LifecycleStageKey[],
): GlobalParam[] {
  const nextVariable: GlobalParam = {
    key,
    value,
    description,
    injectionTiming: "build",
    targetStages,
  };
  const index = variables.findIndex((variable) => variable.key === key);
  if (index < 0) return [...variables, nextVariable];
  return variables.map((variable, variableIndex) =>
    variableIndex === index
      ? {
          ...variable,
          ...nextVariable,
        }
      : variable,
  );
}
