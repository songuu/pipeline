---
title: "流水线任务面板与变量注入时机"
type: sprint
status: completed
created: "2026-05-12"
updated: "2026-05-12"
checkpoints: 0
tasks_total: 5
tasks_completed: 5
tags: [sprint, cicd, tekton, ui]
aliases: ["任务面板差异化", "变量注入时机"]
---

# 需求分析

目标：流程配置页中，点击不同流水线任务时，右侧面板必须展示和该任务真实职责对应的配置内容；环境变量必须明确区分构建时注入、运行时注入、部署时注入，避免把运行密钥或部署参数错误打进镜像。

## 范围

1. 扩展共享变量模型，记录变量注入时机和适用阶段。
2. API Tekton 派生数据按变量时机生成 Task params 和 TaskRun results。
3. 配置页右侧任务面板按 source/test/build/env/package/upload/deploy/canary/approval/promote 展示差异化内容。
4. 变量页支持编辑每个变量的注入时机。
5. 类型检查和浏览器验证。

## 非范围

1. 不接真实 Kubernetes Secret/ConfigMap。
2. 不新增数据库持久化层。
3. 不改变当前模拟执行器的阶段推进机制。

# 技术方案

采用兼容扩展：`GlobalParam` 新增可选字段 `injectionTiming` 和 `targetStages`。旧数据缺失字段时由前端和 API 使用默认规则补齐：

- `NODE_ENV`、`IMAGE_TAG`：构建时注入，作用于测试、构建、制品阶段。
- `DEPLOY_NAMESPACE`：部署时注入，作用于部署、灰度、全量发布阶段。
- `RELEASE_NOTE` 和其他运行参数：运行时注入，作用于部署、灰度、审批、全量发布阶段。

# 任务拆解

- [x] Task 1: 扩展 shared/API 变量注入模型
- [x] Task 2: API snapshot 让 Tekton Task params/results 感知变量注入时机
- [x] Task 3: 配置页右侧任务面板按任务类型差异化
- [x] Task 4: 变量页和样式补齐注入时机交互
- [x] Task 5: 类型检查、构建和浏览器冒烟验证

# 验证策略

风险等级：L3。修改 shared、api、web，影响流水线配置核心页面。

验证命令：

1. `pnpm --filter @deploy-management/shared check`
2. `pnpm --filter @deploy-management/api check`
3. `pnpm --filter @deploy-management/web check`
4. `pnpm --filter @deploy-management/web build`
5. Chrome/Playwright 验证流程配置页点击不同任务，右侧面板标题和字段发生变化；变量页可切换注入时机。

## 验证结果

1. `pnpm --filter @deploy-management/shared check` 通过。
2. `pnpm --filter @deploy-management/shared build` 通过。
3. `pnpm --filter @deploy-management/api check` 通过。
4. `pnpm --filter @deploy-management/api build` 通过。
5. `pnpm --filter @deploy-management/web check` 通过。
6. `pnpm --filter @deploy-management/web build` 通过；Windows 本地 `.next` 文件占用导致首次 sandbox 构建 EPERM，提升权限后构建成功。
7. Chrome 自动化验证通过：点击流水线源、Node.js 构建、注入环境变量后，右侧面板标题和字段均按任务变化；变量页出现“注入时机”列，3 个默认变量可切换注入时机。

# 变更日志

- 2026-05-12: 创建 sprint 文档，冻结范围和变量注入策略。
- 2026-05-12: `GlobalParam` 增加 `injectionTiming`、`targetStages`。
- 2026-05-12: API create/update schema 接收变量注入时机。
- 2026-05-12: API 默认变量和 Tekton snapshot 按注入时机派生 Task params/results。
- 2026-05-12: 配置页右侧面板按任务类型拆分为源、测试/构建、变量注入、制品、上传、部署、灰度、审批、全量发布等视图。
- 2026-05-12: 变量页新增注入时机编辑，支持构建时、运行时、部署时三类变量策略。
- 2026-05-12: Tekton binding 对旧流水线补齐默认变量，避免种子数据缺少注入策略。

# 审查结果

P0/P1：未发现。

剩余风险：

1. 当前仍是内存模拟控制面，没有真实 Kubernetes Secret/ConfigMap 的敏感变量下发能力。
2. Chrome 扩展的 `finalize` 调用超时，但页面交互和控制台业务错误检查已完成；捕获到的异步响应报错来自扩展通信噪音。
3. `127.0.0.1:3000` 曾触发 API CORS/loading 问题，`localhost:3000` 验证正常；如后续要同时支持这两个 origin，需要统一 API CORS 配置。

# 复利记录

1. 流水线变量不能只建一张“全局变量表”。CI/CD 中至少要显式区分：
   - 构建时注入：影响测试、构建、镜像和 SBOM，不应承载运行密钥。
   - 运行时注入：进入容器运行环境，通常来自 Secret/ConfigMap。
   - 部署时注入：用于 Helm/Kustomize/Kubernetes manifest 渲染和发布策略。
2. Tekton 模型映射应让 `Pipeline.params`、`Task.params`、`PipelineRun.params` 与 UI 策略一致；否则 UI 看起来配置完整，运行对象仍会丢上下文。
3. 任务右侧面板必须围绕任务职责组织字段，不要用同一个通用表单覆盖所有任务；用户点击不同节点时，应该马上看到该任务的输入、凭据、产物、结果和风险点。
