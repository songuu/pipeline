# CI/CD Optimization Sprint 2

> 来源：`docs/plans/2026-05-15-cicd-optimization-analysis.md` 的 T4 + T3。

## 范围

- T4：拆分 `packages/shared/src/index.ts`，按平台、源码、镜像仓库、发布、Tekton、云效、API、执行器领域组织类型与工具。
- T3：拆分流水线配置编辑器，先建立 `apps/web/app/ui/pipeline-config` 领域目录，再继续向 hook + panel 结构迁移。
- 顺手修复 Sprint 1 遗留 P1：`RunEvent.type` 支持 `"command"`，`StoredRunEvent.source` 支持执行器来源和控制面来源。

## 已完成

### T4 shared 领域拆分

- `packages/shared/src/index.ts` 已改为 barrel：
  - `platform`
  - `source`
  - `registry`
  - `release`
  - `tekton`
  - `yunxiao`
  - `api`
  - `executor`
- `TektonControlPlaneSnapshot` / `TektonRunRecord` / `TektonTaskRunRef` 已归到 `packages/shared/src/tekton`。
- Kubernetes / Tekton 深度运行时契约已拆到 `packages/shared/src/tekton/runtime.ts`。
- 镜像仓库默认配置改为 provider preset 内部来源，不再导出 `ALIYUN_ACR_DEFAULT_IMAGE_ARTIFACT`。
- `packages/shared/src/resolve-image-artifact.spec.ts` 改为使用 `IMAGE_REGISTRY_PRESETS["aliyun-acr"].defaults`。

### T3 配置编辑器拆分起点

- `apps/web/app/ui/sections/pipeline-config-editor.tsx` 已瘦身为 4 行 wrapper，保持旧 import 路径兼容。
- 真实实现移到 `apps/web/app/ui/pipeline-config/editor-core.tsx`。
- 纯模型与 helper 已拆到 `apps/web/app/ui/pipeline-config/model.ts`：
  - 任务定义、阶段标签、变量注入时机 label/options
  - 仓库 provider/identity/url 解析
  - source policy 构造
  - package mode label/help/output path 解析
  - 变量归一化、注入阶段归类
- `apps/web/app/ui/pipeline-config/basic-panel.tsx` 已拆出，旧行为保持：
  - 基本配置 / 成员信息侧栏
  - 流水线名称、环境、标签、分组、流水线源入口
  - 删除流水线与复制流水线 ID 操作

### 运行命令可视化

- `apps/api/src/executors/local-docker.executor.ts` 在命令执行期间持续写入 `command` event：
  - `running` 开始事件
  - stdout/stderr chunk 的流式 `running` 事件，payload 包含 `streamed`、`outputChunk`、`output`
  - `success` / `failed` 完成事件
- `apps/web/app/ui/components/job-card.tsx` 现在支持在每个任务卡片内展开命令预览；长命令会自动换行，并在固定高度内滚动，避免 Git URL / docker build / docker push 命令被横向裁断。
- `apps/web/app/ui/sections/pipeline-run-detail.tsx` 会按阶段合并两类命令来源：
  - 有实时 command event 时展示“流式返回”
  - 尚未产生 command event 时展示“固定推演”
- 右侧执行过程面板继续保留完整脚本视图和复制脚本能力。

## 验证

- `pnpm --filter @deploy-management/shared check` 通过
- `pnpm --filter @deploy-management/shared build` 通过
- `pnpm --filter @deploy-management/api check` 通过
- `pnpm --filter @deploy-management/api build` 通过
- `pnpm --filter @deploy-management/web check` 通过
- `pnpm --filter @deploy-management/web build` 通过
- `pnpm -r --if-present check` 通过
- `pnpm -r --if-present test` 通过：31 tests passed

## 后续

T3 下一步继续把 `editor-core.tsx` 拆成以下面板和 hook：

- `use-pipeline-config-editor.ts`
- `basic-panel.tsx`
- `source-panel.tsx`
- `flow-panel.tsx`
- `trigger-panel.tsx`
- `variables-panel.tsx`
- `artifact-panel.tsx`
- `release-target-panel.tsx`

完成标准：

- `editor-core.tsx` 降到 400 行以内。
- 每个 panel 只接收自己需要的 typed props，避免重新堆成 `any` 大对象。
- 每次拆一个 panel 后跑 `pnpm --filter @deploy-management/web check`。
