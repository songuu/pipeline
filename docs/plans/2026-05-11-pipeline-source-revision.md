---
title: "流水线源与运行 Revision 完整链路"
type: sprint
status: completed
created: "2026-05-11"
updated: "2026-05-11"
checkpoints: 0
tasks_total: 5
tasks_completed: 5
tags: [sprint, cicd, tekton, yunxiao, pipeline-source]
aliases: ["流水线源置顶", "仓库分支Tag运行配置"]
---

# 需求分析

用户要求按建议完整修改新建流水线与运行链路：仓库、分支、Tag 不再只是隐藏默认值，而是作为流水线源的一等配置贯穿创建、配置、运行和运行记录快照。

## Scope

- 新建模板后的配置页新增“流水线源”配置入口，优先配置仓库、默认分支或 Tag、运行时可选策略。
- 允许保存流水线时更新 repositoryId、默认 refType/refName 与 sourcePolicy。
- 点击“运行”先进入运行参数确认，选择仓库、分支或 Tag、可选 Commit、环境和灰度比例，再触发实时执行。
- 后端校验 sourcePolicy，PipelineRun 固化本次运行的 repo/ref/commit。
- Tekton 展示参数补齐 git-url、revision、ref-type、allowlist 等源信息。

## Non-scope

- 不接真实 Git provider API 拉取远程分支。
- 不实现真实 Tekton 集群提交，只保持当前模拟执行器和 Tekton 视图一致。
- 不改变现有 seed 数据的业务含义。

## Success

- 用户创建流水线后能先看到并配置“流水线源”。
- 保存后 PipelineDefinition 包含仓库与 revision 策略。
- 点击运行时可选择 branch/tag/commit，并且运行页展示实时执行过程。
- 后端拒绝不符合策略的 ref。
- API/Web 类型检查和构建通过，接口冒烟验证能看到 queued → running → success/waiting。

# 技术方案

1. Shared domain 增加 `PipelineSourcePolicy`、`SourceCommit`、`commitSha` 字段，并让 create/update request 支持 sourcePolicy/repositoryId。
2. API create/update/trigger 全部基于 repositoryId + refType + refName + commitSha 做校验和快照。
3. Web 配置页新增 source tab，基本信息与流程图只展示摘要，详细源策略在 source tab 编辑。
4. Web 运行按钮改为打开运行确认弹窗；弹窗提交后再调用 trigger。
5. Snapshot/Tekton 视图补充源码策略参数。

# 任务拆解

- [x] Task 1: 扩展 shared 类型、seed 数据、API DTO 与 service 校验。
- [x] Task 2: 新增配置页流水线源 tab，并保存 repository/ref/sourcePolicy。
- [x] Task 3: 新增运行确认弹窗，贯通运行时 branch/tag/commit。
- [x] Task 4: 补齐 Tekton binding、运行页源信息和日志展示。
- [x] Task 5: 执行 check/build 与运行接口冒烟验证。

# 变更日志

- 2026-05-11: 创建 sprint 文档，冻结范围与验收标准。
- 2026-05-11: 完成 sourcePolicy/commitSha/recentCommits 领域模型，API create/update/trigger 已校验源策略。
- 2026-05-11: 完成配置页“流水线源”tab 与运行确认弹窗，运行前可选择 branch/tag/commit。
- 2026-05-11: 完成 Tekton binding source params、策略拦截回归修复与实时执行冒烟验证。

# 审查结果

- L3 风险点：运行时 ref 策略必须基于原始 PipelineDefinition 校验，不能基于本次 run 的 definitionSnapshot 校验；已通过 400 拦截冒烟覆盖。
- L2 风险点：前端运行弹窗需要和配置页复用 RunConfig，避免保存配置和立即运行参数漂移；已通过 TypeScript 检查覆盖。
- 残余风险：当前分支/Tag/Commit 来源仍是 seed 数据，未来接真实 Git provider 时需要把 recentCommits 与 ref 列表换成服务端实时查询。

# 复利记录

- 经验：Pipeline 定义保存“默认源与约束”，PipelineRun 保存“一次运行的不可变 repo/ref/commit 快照”；策略校验必须发生在快照覆写之前。
- 验证：`pnpm --filter @deploy-management/shared build`、`pnpm --filter @deploy-management/api check/build`、`pnpm --filter @deploy-management/web check/build` 均通过。
- 冒烟：临时 API 4001 验证 sourcePolicy 出现在 snapshot/Tekton params，非法 runtime tag 返回 400，合法 branch+commit 运行从 running 流动到 success。
