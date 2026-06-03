---
title: "生产部署调整与核对清单"
type: sprint
status: planning
created: "2026-06-03"
updated: "2026-06-03"
tags: [sprint, deploy, production]
aliases: ["prod deploy checklist"]
decisions:
  executor: "tekton + local-docker 两组都备（EXECUTOR 单一全局开关，运行时只生效一个）"
  storage: "supabase"
---

# 生产部署调整与核对清单

部署机制已存在（`scripts/deploy-prod.ps1` + `pnpm deploy:prod`），本清单只覆盖**让它完整正确运行需要调整/准备的项**。

## 决策
- **执行器**: tekton + local-docker 两组配置都备齐。`EXECUTOR` 是单一全局开关，运行时只生效一个；切换需改 `.env.production` 的 `EXECUTOR` 并 `pm2 restart`。主用 `tekton`。
- **存储**: Supabase。

---

## 一、部署前（本地 / 一次性）

- [ ] **填 `.env.production`**：替换所有 `<...>` 占位（已生成于仓库根，gitignored）
  - [ ] `CONTROL_PLANE_API_TOKEN` = `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  - [ ] `CONTROL_PLANE_DEFAULT_ROLE=viewer`（**勿用 admin**：JWT 解析失败会回退此值）
  - [ ] `SUPABASE_SERVICE_ROLE_KEY`（仅服务端，禁进前端）
  - [ ] tekton 组：`TEKTON_BRIDGE_NAMESPACE` / `TEKTON_SERVICE_ACCOUNT` / `TEKTON_SOURCE_PVC` / `TEKTON_DOCKER_SECRET`
  - [ ] local-docker 组：`ACR_USERNAME` / `ACR_PASSWORD`
  - [ ] `WEBHOOK_SECRET`（如接 VCS webhook）
- [ ] **Supabase 建表**：SQL Editor 跑 `supabase/migrations/20260518_domain_storage_tables.sql`
- [ ] **（如有存量 JSON 数据要迁移）** `$env:DRY_RUN="true"; pnpm migrate:storage:supabase` 核对数量 → 去掉 DRY_RUN 正式迁一次

## 二、远端 VM 基础设施（脚本不装，需预置）

- [ ] `node`（建议 LTS）、`pnpm`（`corepack enable`）、`pm2`、`git`、`tar`
- [ ] **`go`（>=1.22）**：服务器原地构建 bridge 需要（git 部署不再本地交叉编译）
- [ ] **tekton 模式**：`kubeconfig` 文件放 `/opt/deploy-management/shared/kubeconfig`，能连目标集群；集群已装 Tekton Pipelines，namespace/PVC/ServiceAccount/docker Secret 就绪
- [ ] **local-docker 模式**：VM 装 docker daemon，当前用户可访问 docker.sock，能 `docker login` 到 ACR
- [ ] **反向代理 + TLS**：nginx 反代 web(3000)/api(4000)，配 HTTPS 证书
- [ ] **防火墙**：对外仅开 nginx(443)；bridge `5050` 限本机；api `4000`/web `3000` 不直接对公网
- [ ] **pm2 开机自启**：`pm2 startup` + 首次 `pm2 save`

## 三、执行部署（服务器原地 git 部署，推荐）

> 不再本地交叉编译 + 打包 SCP，改为在服务器上 `git pull` 后原生构建运行。
> 旧的 `pnpm deploy:prod`（Windows 本地打包 + SCP）仍保留备用，见文末。

### 一次性 bootstrap（每台服务器一次）

```bash
# 1. 装工具链
#    - node (LTS) + corepack（启用 pnpm）
#    - go (>=1.22，原生构建 bridge)
#    - pm2:  npm i -g pm2
#    - git, tar；tekton 模式需 kubectl；local-docker 模式需 docker daemon

# 2. 克隆仓库到固定目录
sudo mkdir -p /opt/deploy-management && sudo chown "$USER" /opt/deploy-management
git clone <repo-url> /opt/deploy-management/app
cd /opt/deploy-management/app

# 3. 放生产配置（gitignored，git pull 不会覆盖）
cp .env.example .env.production
#    编辑 .env.production，按“一、部署前”填齐所有 <...>
#    把 kubeconfig 放到 /opt/deploy-management/shared/kubeconfig（tekton 模式）

# 4. 首次部署
bash scripts/deploy-server.sh

# 5. 开机自启
pm2 startup        # 按提示执行它打印的命令
pm2 save
```

### 每次发布（拉新代码重新部署）

```bash
cd /opt/deploy-management/app
bash scripts/deploy-server.sh      # = pnpm deploy:server
```

`scripts/deploy-server.sh` 做的事：`git pull --ff-only` → 软链 `.env.production`→`.env` → `pnpm install --frozen-lockfile` → `pnpm -r build`（shared/api/web）→ `go build -tags tekton`（CGO_ENABLED=0，原生）→ `pm2 startOrReload ecosystem.config.cjs --update-env` → `pm2 save`。

> `.env.production` 是 untracked，`git pull` 不会动它，配置在服务器上长期保留。
> 服务器 checkout 须保持干净；若有本地改动导致 `git pull --ff-only` 失败（fail-safe），手动 `git reset --hard origin/main` 后重跑。

## 四、部署后验证（完整且正确运行）

- [ ] `pm2 status` 三服务 online，无 restart 抖动
- [ ] bridge 日志含 `backend=tekton`（非 simulated）
- [ ] `GET /api/kubernetes/capabilities` 返回集群可用（非 `local-disabled`）
- [ ] 带 token 调写接口成功；不带 token 返回 401/403（验证认证生效）
- [ ] 跑一条含 `build`+`upload` 的真实流水线 → 产出真实镜像并推送到 registry（非模拟）
- [ ] 重启 pm2 后控制面状态仍在（验证 Supabase 持久化，非内存/临时目录）

---

## 关键风险（已在 .env.production 处置）

| 风险 | 处置 |
|------|------|
| 控制面数据每次发布丢失（`.deploy-data` 相对 cwd，pm2 cwd 每发布换目录） | 用 Supabase（`DEPLOYMENT_STORAGE=supabase`） |
| `EXECUTOR` 默认 simulated，不产真实镜像 | 设 `EXECUTOR=tekton`；`TEKTON_ALLOW_SIMULATED_FALLBACK=false` |
| JWT 解析失败回退 admin | `CONTROL_PLANE_DEFAULT_ROLE=viewer` |
| 生产要求 auth 但无 token = 无人可调写接口 | 设 `CONTROL_PLANE_API_TOKEN` |
| local-docker 工作区随发布丢失 | `LOCAL_DOCKER_WORKDIR` 绝对路径到 shared/ |
| bridge `:5050` 暴露 | 监听 127.0.0.1 + 防火墙 |

## 旧方案（备用）：本地打包 + SCP

`pnpm deploy:prod`（`scripts/deploy-prod.ps1`）在 Windows 本地构建 + 交叉编译 bridge + 打 bundle + SCP 到远端 + pm2。适合服务器无 Go/git 访问、或不想在服务器上拉代码的场景。git 原地部署为推荐路径，二者用同一套 `.env.production` 与 pm2 服务名。

## 非阻断（可后置硬化，代码侧）

- API 无 helmet / rate-limit / 全局 ValidationPipe（仅部分接口 ZodValidationPipe）
- 无全局异常过滤器、无结构化日志（`console.error`）
- `package.json` 未 pin `engines.node`
- Next 未用 `output: standalone`（`next` 在 dependencies，`pnpm install --prod` 后 `next start` 可正常跑，故非必须）
