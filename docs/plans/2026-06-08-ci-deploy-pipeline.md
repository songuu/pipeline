---
title: "离机构建发布流水线（取代机上构建 SSH 部署）"
type: sprint
status: done
created: "2026-06-08"
updated: "2026-06-09"
tags: [sprint, deploy, ci, github-actions, production]
aliases: ["ci deploy pipeline", "off-box build deploy"]
decisions:
  build_location: "GitHub Actions（ubuntu-latest 2C/7G）离机构建；1.8GB 盒子永不跑 next/nest build"
  delivery: "tar 产物 scp 到 releases/<sha-ts> + current symlink + 健康门 + 一键回滚"
  trigger: "push main 自动 + workflow_dispatch；secret 缺失时 deploy 优雅跳过"
  runtime: "保留 pm2（不引入 dockerd，1.8GB 省内存）；nginx+TLS+Basic 与 Supabase 不变"
invariants:
  - "构建离机：end state 盒子上无 next/nest build（消除 OOM 根因）"
  - "密钥只走 .env.production（留盒子 /opt/.../shared）+ GitHub Secret（仅 SSH deploy key）；绝不进 git/产物/CI 日志/镜像"
  - "每次发布原子可回滚：releases/<sha-ts> + current symlink + rollback.sh，一键回退不重建"
  - "健康门失败必须自动回滚并 exit 非0，坏版本不留存"
  - "nginx+TLS+Basic 边界与 Supabase 外部存储零改动"
  - "/healthz 无鉴权、在 /api 前缀外、不泄露敏感信息；探针走 127.0.0.1 直连"
  - "发布幂等；保留最近 N 份产物，防撑爆 40G/80% 盘"
invariant_tests:
  - "health.controller.spec：/healthz 返回 200 且无 RequireRoles 元数据"
  - "web app/healthz route 测试：GET 返回 200 {status:ok}"
  - "deploy 脚本：bridge 构建仅 EXECUTOR=tekton；本地 shellcheck/语法自检"
---

# 离机构建发布流水线

## 背景（根因）
之前“SSH 直连部署”的真痛点不在 SSH 传输，而在 `scripts/deploy-server.sh:51` 的 `pnpm -r build` 跑在 **1.8GB 盒子**上 → `next build` OOM。SSH 当传输完全 OK。解法 = 构建移出盒子（GitHub Actions 免费），盒子只跑预构建产物 + 原子发布 + 健康门回滚。

研究全过程与排序见 `docs/plans/2026-06-05-harness-gap-borrow-plan.md` 旁路 + 本次 workflow 结论。Top pick = CI 出 tar 产物 over SSH（适配 9，零新增常驻内存，$0）。明确不做：Coolify（自身 2GB 出局）、仅为应用跑 dockerd（300-400MB 税）、双份蓝绿（1.8GB OOM）、CapRover/Dokku 机上构建。

## 目标架构
```
push main → .github/workflows/deploy.yml (ubuntu 2C/7G)
  → pnpm -r build (shared→api→web standalone)  ← 唯一构建处
  → assemble-bundle.sh 打 tar（bridge 仅 EXECUTOR=tekton 时构建）
  → [secret 缺失则跳过 deploy] scp tar → /opt/deploy-management/releases/incoming
  → ssh: tar -x → releases/<sha-ts> → activate-release.sh
       link .env → pnpm i --prod → ln -sfn current
       健康门 curl 127.0.0.1:4000/healthz + :3000/healthz
       失败 → rollback（symlink 回退 + reload）+ exit 非0
       prune 留最近 N 份
nginx+TLS+Basic / Supabase 不动；.env.production 留盒子；CI 只持 SSH key
```

## 任务（增量，每步独立可发可回退）
1. **去除被追踪产物**：`git rm --cached packages/shared/dist/*`(4) + `apps/web/next-env.d.ts`；`.gitignore` 补 `next-env.d.ts`。消除 `git pull --ff-only` 必失败。
2. **硬化 deploy-server.sh**：go PATH 健壮化；bridge 构建 gated 到 `EXECUTOR=tekton`（prod=local-docker 跳过）；pm2 用 `startOrReload <ecosystem>` 全量式。
3. **/healthz 端点**：Nest `GET /healthz`（无 RequireRoles，/api 外）+ Next `app/healthz/route.ts`，均 200。补测试。
4. **原子发布 + 回滚 + 健康门**：`scripts/lib/release-common.sh` 公共函数 + 重写 `deploy-server.sh` + `scripts/rollback.sh` + `scripts/activate-release.sh`（CI/机上共用激活逻辑）+ 保留 N 份。
5. **Next standalone**：`output:'standalone'` + `outputFileTracingRoot=repo根`；`run-web.sh` 优先 `node server.js`（带回退）；`ecosystem` 加 `max_memory_restart` 护栏（Next16+Node22 fetch-cache 增长 #85914）。
6-7. **deploy.yml**：离机构建 + assemble + scp + ssh 激活；push main + workflow_dispatch；secret 缺失优雅跳过；退役机上构建（`deploy-server.sh` 仅作 break-glass）。

## 运维迁移注记（操作者在盒子上执行，confirm-required）
- **步骤1 首次**：盒子现有 clone 仍本地追踪那 5 个文件，需一次 `git reset --hard origin/main`（仅限 `/opt/deploy-management/app` 部署 checkout，**destructive，需确认**）。
- **布局收敛**：现 prod pm2 指向 `/opt/deploy-management/app`；切到 `releases/current` 布局后首次需 `pm2 delete dm-web dm-api && pm2 start current/ecosystem.config.cjs && pm2 save`（一次性重指）。
- **GitHub Secrets 需配**：`DEPLOY_SSH_KEY`(私钥) / `DEPLOY_HOST`(47.253.230.197) / `DEPLOY_USER`(root) / `DEPLOY_PORT`(22)。**绝不入库**。配齐前 deploy 步骤自动跳过，仅跑构建。
- **首跑建议**：先 `workflow_dispatch` 手动触发验证端到端，再依赖 push-main 自动。

## 验证 + 多角度审查（2026-06-09 收尾）
全部 7 步落地。构建/打包/审查实测：
- **构建绿**：`pnpm -r build` shared/api/web 全过；web standalone 产物 `apps/web/.next/standalone/apps/web/server.js` 生成。
- **打包绿**：`assemble-bundle.sh` 实测产出含 standalone+static+脚本+清单的完整 release（必需产物 12/12）。
- **api/web 测试绿**：health.controller.spec + web healthz route + 既有套件（api 单 fork 跑 85 测试全过；多 worker 失败为 Windows/Node24 tinypool 偶发，CI Linux 不受影响）。
- **6 脚本 `bash -n` 全过**。

5 维度对抗审查 workflow（secrets/rollback/idempotency/shell/ci-consistency，每 finding 再对抗验证）：49 条原始 → 10 条经验证确认。逐条按真实生产事实裁决，**已修 6 条**：
1. **[CRITICAL] activate_release 原子性**：切 symlink 后 `pm2_reload_all`（非条件位）在 `set -e` 下失败会“到回滚块前”中止，把 current 永久卡在坏 release。改：`pm2 重载 || ok=0` + `health_gate || ok=0` 统一汇到回滚路径。
2. **[HIGH] 自动回滚后不复检**：回滚到上一份后未再健康检查，坏的上一份会被当“已恢复”。改：回滚后 `health_gate`，仍失败打 CRITICAL 提示人工。
3. **[MEDIUM] 健康门不分服务**：改 `health_gate` 分别打印 api/web PASS/FAIL，运维可定位。
4. **[MEDIUM] CI 激活路径缺 pnpm**：appleboy/ssh-action 非登录 shell PATH 可能无 pnpm（同已知 go 坑）。activate-release.sh 加 corepack enable + pnpm 硬预检。
5. **[硬化] deploy.yml DEPLOY_ROOT** 改 `export`。
6. **[MEDIUM] rollback.sh 切前校验** target 含 `ecosystem.config.cjs`，拒绝指向残缺 release。

**WSL 实测回滚逻辑 8/8 绿**（真符号链接语义）：pm2 失败→回滚 prev rc=1 / 健康失败→回滚 / 全绿→current=new / 首发无 prev 不崩。

裁决**不改**（附理由）：fallback `copy apps/web/.next`（防御非 bug）；不加 `packageManager`（会引入 corepack 本地下载摩擦，CI 已 `version:9` 显式锁）；prune 保持 after-success（prune-before 会牺牲回滚目标）；workflow chmod 保留（防 tar/git 丢权限位）。

**安全复核**（约 23 个 verify agent 因 502 崩，安全类 finding 未自动验证 → 亲自核）：无任何 `.env`/key/secret 文件入库（仅 `.env.example` 模板 + `secret-resolver.service.ts` 源码）；`.env.production` 未跟踪；deploy.yml 仅 echo “缺失 secret”提示从不打印值；源码无硬编码密钥。判定均为假阳性。

## 待确认（openQuestions）
- 仓库 public/private（影响 Actions 免费额度叙述；private Free=2000min/月，单次构建 3-6min 充裕）。
- GitHub runner 美区 → Aliyun us-east-1 国际站 scp 吞吐（~50-150MB tar）。
- 盘余量：40G/80%，保留份数定 2-3 还是 3-5。
