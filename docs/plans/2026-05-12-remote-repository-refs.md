---
title: "远程仓库分支 Tag 拉取"
type: sprint
status: reviewing
created: "2026-05-12"
updated: "2026-05-12"
tasks_total: 4
tasks_completed: 4
tags: [sprint, cicd, repository, refs]
---

# 远程仓库分支 Tag 拉取

## 需求分析

目标是在流水线源配置里直接填写仓库地址后即可使用，支持 GitHub、GitLab、GitCode，并在选择分支或 Tag 运行类型时通过后端接口拉取真实 refs 列表。

非目标：本轮不落地长期密钥存储和 OAuth 授权，只提供运行时 token / 环境变量 token 读取能力，后续可接服务连接。

## 技术方案

- 后端新增仓库 URL 解析与远程 refs adapter。
- API 支持解析仓库元信息、拉取 branch/tag 列表，并统一返回 provider、repositoryId、refs、defaultRef。
- 前端流水线源配置支持 provider、仓库地址、临时访问令牌，URL blur / 切换 branch-tag / 手动刷新时调用 API。
- 保存流水线时把 repositoryUrl 写入 pipeline draft，运行前若仓库地址为空则阻断并提示。

## 任务拆解

- [x] 确认现有代码源模型和创建草稿链路。
- [x] 新增 shared 类型、后端 DTO、远程 provider adapter 和 API。
- [x] 改造前端流水线源表单与 refs 下拉加载。
- [x] 类型检查、构建和接口冒烟验证。

## 变更日志

- 2026-05-12: 创建 sprint 文档，冻结本轮远程仓库 refs 能力范围。
- 2026-05-12: 后端支持 GitHub / GitLab / GitCode 仓库解析、refs 拉取、环境变量 token、分页返回。
- 2026-05-12: 前端支持自定义远程仓库地址，切换分支 / Tag 时通过接口刷新对应列表。
- 2026-05-12: 调试卡顿现象，确认本地 API 可启动；超大 GitHub 仓库分支拉取改为分页，避免默认遍历全仓库。

## 审查结果

- P0: 无。
- P1: GitHub 匿名 API 容易触发 403 rate limit；私有仓库或高频拉取应配置 `GITHUB_TOKEN` / `GITLAB_TOKEN` / `GITCODE_TOKEN`。
- P2: refs API 目前返回单页数据和 `hasMore`，后续如果前端需要无限滚动，可继续把 `page` / `perPage` 暴露到搜索输入交互。

## 验证记录

- `pnpm --filter @deploy-management/api check`：通过。
- `pnpm --filter @deploy-management/web check`：通过。
- `pnpm --filter @deploy-management/api build`：通过，并刷新 shared / api dist。
- `GET http://127.0.0.1:4001/api/snapshot`：200。
- `POST http://127.0.0.1:4001/api/repositories/refs` GitHub `vercel/next.js` branch：15 秒内返回 `count=101`、`hasMore=True`、`defaultRef=canary`。
- 并发 GitHub refs 冒烟时遇到匿名 API `403 rate limit exceeded`，确认需要 token 配置支撑高频或私有仓库访问。
