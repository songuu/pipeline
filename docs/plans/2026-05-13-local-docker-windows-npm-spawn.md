---
title: "Local Docker Windows NPM Spawn"
type: sprint
status: completed
created: "2026-05-13"
updated: "2026-05-13"
checkpoints: 0
tasks_total: 4
tasks_completed: 4
tags: [sprint, bugfix, local-docker, windows]
aliases: ["local-docker npm ENOENT"]
---

# Local Docker Windows NPM Spawn

## 需求分析

本地 `local-docker` 执行器在真实打包阶段执行 `npm ci` 时失败：

```text
failed to start command "npm ci" in C:\tmp\deploy-management-local-docker\run-3\source: spawn npm ENOENT
```

目标是从根上解决 Windows 本地执行器的命令启动问题，而不是继续依赖用户手工修 PATH 或反复重启尝试。

复查 `run-5` 时确认还有一个叠加问题：4000 端口仍有旧 Node 进程监听，页面请求打到了旧执行器代码，因此即使源码已修复，运行结果仍然显示旧格式的 `spawn npm ENOENT`。

## 技术方案

1. 本地执行器需要有统一命令解析层，不能直接 `spawn("npm")`。
2. Windows 下 `npm` 优先解析为当前 Node 安装目录中的 `npm-cli.js`，通过 `process.execPath` 启动，避开 `.cmd` shim 和 `PATH` 解析。
3. `pnpm` / `yarn` / `npx` 走显式 `cmd.exe /d /s /c` 包装，并对参数做转义。
4. 启动脚本归一化当前 shell 的 Node / pnpm 目录到 `PATH`，降低运行进程与交互 shell 不一致的概率。
5. 错误日志必须展示原始命令、解析后的可执行入口和工作目录。
6. 本地启动脚本必须在启动前清理 4000 端口旧监听，避免新旧 API 混跑。

## 任务拆解

- [x] Task 1: 定位当前运行错误与执行器命令层边界。
- [x] Task 2: 重构 `LocalDockerExecutor.runCommand`，引入命令解析和 Windows 包管理器兼容。
- [x] Task 3: 补强 `scripts/dev-api-local-docker.ps1` 的 PATH 归一化。
- [x] Task 4: 类型检查、构建验证，并给出重启与复测步骤。

## 变更日志

- 2026-05-13: 创建 sprint 文档，冻结本轮修复范围。
- 2026-05-13: `npm` 在 Windows 下改为优先通过 `node.exe npm-cli.js` 启动，并保留 `cmd.exe /d /s /c npm ...` fallback。
- 2026-05-13: `pnpm` / `yarn` / `npx` 在 Windows 下统一走显式 `cmd.exe` 包装，避免裸 `spawn` 找不到 shim。
- 2026-05-13: 本地启动脚本补充 `Path` / `PATH` 归一化，并自动设置 `NPM_CLI_JS`。
- 2026-05-13: 本地启动脚本启动前自动清理 4000 端口旧监听；已手动停止旧 PID 37504。
- 2026-05-13: 使用修复后的 `pnpm dev:api:local-docker` 启动 API，当前监听 PID 3924，启动日志确认 `NPM_CLI_JS=C:\nvm4w\nodejs\node_modules\npm\bin\npm-cli.js`。

## 验证

```text
pnpm --filter @deploy-management/api check
pnpm --filter @deploy-management/api build
PowerShell PSParser: scripts/dev-api-local-docker.ps1 ok
git diff --check -- apps/api/src/executors/local-docker.executor.ts scripts/dev-api-local-docker.ps1 docs/plans/2026-05-13-local-docker-windows-npm-spawn.md
netstat -ano | findstr ":4000" -> no listener after cleanup
pnpm dev:api:local-docker -> API started on 4000, PID 3924
```

## 审查结果

- P0: 未发现。
- P1: 当前验证环境对 Node `spawn` 有沙箱限制，不能在 Codex shell 内完整复现用户本机 API 进程的真实子进程行为；已通过代码路径、dist 同步和脚本解析验证降低风险。
