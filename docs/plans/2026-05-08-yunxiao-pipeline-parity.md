---
title: "云效流水线功能与视觉一致性优化"
type: sprint
status: completed
created: "2026-05-08"
updated: "2026-05-08"
tasks_total: 9
tasks_completed: 9
tags: [sprint, cicd, yunxiao, pipeline, nextjs]
aliases: ["云效流水线一致性"]
---

# 云效流水线功能与视觉一致性优化

## 需求分析

用户要求流水线部分继续参照阿里云云效完善，并且功能和页面风格都要高度一致。当前验收锚点来自三张截图：

- Codeup 仓库内的流水线空态：左侧仓库菜单、中心创建入口、下拉项、推荐模板条。
- Flow 工作台的我的流水线与模板选择弹窗：侧边栏、列表工具栏、模板分类、可视化/YAML 创建方式、推荐模板卡片。
- 流水线最近运行详情：顶部运行信息、编辑/运行按钮、失败状态、源面板、阶段分组、任务卡、重试入口。
- 模板选择弹窗补充 Node.js 分类点击、Node.js 三类模板、空模板和其他执行命令模板。
- 流水线详情编辑页补充 `基本信息 / 流程配置 / 触发设置 / 变量和缓存` 四类配置。

同时不能只做静态页面，必须继续支持真实操作：

- 新建流水线调用 `POST /api/pipelines`。
- 运行流水线调用 `POST /api/pipelines/:pipelineId/trigger`。
- 运行配置支持仓库、分支、tag、环境、灰度比例和生命周期阶段。
- 生命周期可视化覆盖拉代码、测试、构建、制品、上传、部署、灰度、审批、全量。

## 技术方案

前端保留现有 Next.js 单页数据入口，但把流水线部分拆成三种云效式 surface：

1. `landing`：Codeup 仓库内流水线空态。
2. `list`：Flow 工作台我的流水线列表与模板创建入口。
3. `detail`：最近运行详情画布。

模板创建采用前端模板定义生成 `CreatePipelineRequest`，继续走 Nest API 保存真实流水线。运行详情的“编辑”按钮展开运行配置区，复用已有可配置字段并触发真实运行。

第二轮优化后，详情页从“运行详情 + 小型运行参数”升级为云效式编辑页：

- `基本信息`：基本配置、成员信息、名称、ID、环境、标签、分组、删除入口。
- `流程配置`：流水线源、测试、构建、新阶段、任务配置抽屉、构建集群、构建节点、镜像、服务连接、下载源、任务步骤。
- `触发设置`：Webhook 触发、定时触发、并发度限制。
- `变量和缓存`：变量、通用变量组、缓存配置、空表状态和新建变量入口。

## 任务拆解

- [x] 改造流水线入口为空态创建页。
- [x] 增加 Flow 工作台列表和云效模板弹窗。
- [x] 增加最近运行详情画布与阶段任务卡。
- [x] 文档记录本轮功能边界和验收方式。
- [x] 执行 `pnpm check` 与 `pnpm build`。
- [x] 模板分类支持点击切换。
- [x] Node.js 模板支持三种云效预置链路。
- [x] 详情页新增四类配置菜单。
- [x] 流程配置新增右侧任务配置面板。

## 风险与约束

- 云效是参考交互和视觉风格，不复制云效私有资源或真实内部实现。
- “完全一致”以用户提供截图为当前对齐依据；若后续补充更多截图，需要继续扩展对应状态。
- 当前执行器仍是模拟 adapter，生产化时需要把 Git、构建、制品、部署和灰度 adapter 接入真实系统。

## 验证

已验证：

```bash
pnpm check
pnpm build
```

后端配置链路烟测：

```bash
node -e "<instantiate CicdService, create tag pipeline, trigger tag run>"
```

结果：

```json
{"pipeline":"pipe-custom-4","ref":"tag:v2026.05.08","run":"run-23848","runRef":"tag:v2026.05.08","status":"waiting_approval","stages":9}
```

第二轮验证：

```bash
pnpm check
pnpm build
node -e "<instantiate CicdService, create Node.js ACK release template, trigger run>"
```

结果：

```json
{"pipeline":"nodejs-ack-release","ref":"branch:main","run":"run-23848","status":"waiting_approval","stages":"source,test,build,package,upload,deploy,canary,approval,promote"}
```
