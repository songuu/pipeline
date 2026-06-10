---
type: incident-and-hardening
date: "2026-06-10"
host: "root@47.253.230.197 (songuu.top)"
spec: 1.8GB RAM / 40GB disk / EXECUTOR=local-docker / STORAGE=supabase
status: implemented locally; remote current aligned; release validation pending
tags: [incident, small-vm, local-docker, pm2, release, hardening]
invariants:
  - "前置 CI 发布 invariant 仍成立：默认生产控制面应由离机构建产物 + releases/current + 健康门回滚承载，小机器不重新承担 next/nest 控制面构建。"
  - "本次保留盒子 local-docker 构建仅限用户流水线执行器的临时运行策略，不撤回 off-box control-plane deploy 决策。"
  - "local-docker 的 queued 文案必须区别启动窗口、单飞排队和 stale run；不得继续复用 approval / runner capacity 文案。"
  - "pm2 激活必须保证进程 script/cwd 与 current 对齐；发现漂移时发布脚本必须能重注册或经验证稳定跟随软链。"
invariant_tests:
  - "pnpm --filter @deploy-management/api test -- runs.service.spec.ts"
  - "pnpm --filter @deploy-management/api check"
  - "bash -n scripts/lib/release-common.sh scripts/activate-release.sh scripts/rollback.sh scripts/runtime/run-api.sh scripts/runtime/run-web.sh scripts/runtime/run-tekton-bridge.sh"
deferred:
  - sprint: "future-capacity"
    item: "用户流水线构建迁出 1.8GB 盒子，改为 CI/专用 runner/Tekton worker"
    deadline: "2026-07-10"
    reason: "当前用户决策保留 local-docker 盒上构建；OOM 只能缓解，无法根除。"
---

# 流水线“排队中”故障诊断与小机器加固方案

> 现象起点：某流水线 run 长期卡在 **“排队中 / 等待执行器分配资源”**，机器上并无其它任务，却始终排队；进一步表现为「代码能拉取/检测，之后没有任何动静」。
>
> 硬约束：**当前阶段只能在这台 1.8GB / 40GB 小机器上运行**，无法扩容，且机器同时被当通用开发机使用。

---

## 一、问题现象

1. 控制台显示 run 状态 `排队中`，副标题 `等待执行器分配资源`；Tekton 运行对象面板显示 `Pending / PipelineRun is waiting for approval or runner capacity`，Executor `local-docker`。
2. 机器上没有其它流水线在跑，却始终“排队”。
3. 后续观察：`拉取代码`/`测试与检测` 看似正常，之后流水线再无推进。

---

## 二、诊断与根因

### 2.1 “排队”语义澄清（关键认知纠偏）

- `local-docker` 执行器**没有任何并发队列 / runner 池**。`LocalDockerExecutor` 内部用一个内存 `Map` 存 run（`apps/api/src/executors/local-docker.executor.ts`），`start()` 同步置 `RUNNING` 后即 fire-and-forget 执行，**永远不会因为别的任务在跑而排队**。
- UI 那句 `waiting for approval or runner capacity` 是 `apps/api/src/snapshot/snapshot.service.ts:645` 照搬 Tekton/云效的措辞，对 local-docker 是**误导文案**。
- “排队中”的真实含义仅是 `run.status === "queued"`：
  - `createRun()` 写死初始状态 `queued`（`apps/api/src/lifecycle/lifecycle.engine.ts:104`）。
  - `queued → running` 的**唯一**切换条件是「第一个 stage 真正进入 `RUNNING`」（`lifecycle.engine.ts:185-191`）。
  - local-docker `execute()` 在进入 stage 循环**之前**先 `rm -rf runDir` + `mkdir`（`local-docker.executor.ts:165-178`）；这段窗口内 overall 已 RUNNING 但无任何 stage RUNNING → 落到 `else` 分支显示 `queued`。
- 因此「没别的任务却排队」是**正常的**：它不是在等资源，而是在等首个 stage 起跑。**长时间**卡 queued 才是故障——意味着 executor 根本没把流水线驱动起来。

### 2.2 现场证据（SSH 只读诊断）

- **run 列表**：13 个 run，大量 `queued` 且**全 stage `pending`**（从未启动），时间跨度 2026-05-21 → 06-09；仅 06-05 两个 run 真正 `source:success → build:failed`。
  - 卡住的 `run-mq6esdot-c71d4e00e810`：`queued`，所有 stage `pending`，工作目录**空**（只 `mkdir` 过，无 source checkout）。
- **内存**：1.8Gi total，available 一度仅 ~495Mi；`vm.swappiness=80`（激进 swap）。
- **磁盘**：`/dev/vda3 40G` 用到 **93~94%**，可用仅 2.6G。
- **四个叠加故障**：

| # | 故障 | 证据 |
|---|------|------|
| 1 | 流水线 executor 未被驱动 | 多数 run `queued` 且全 `pending`，长期僵死 |
| 2 | dm-api 反复崩溃 | `error.log` `MODULE_NOT_FOUND @ /app/apps/api/dist/main.js`；pm2 脚本却指 `/releases/<sha>/...` |
| 3 | 磁盘被构建残留撑满 | `shared/local-docker-runs` 7 个残留 run 目录占 **1.5G**，从不清理 |
| 4 | 闲置 kind k8s + bridge 挂死 | 常驻 `kubelet/kube-apiserver/controller`（白吃内存）；`dm-tekton-bridge` errored ×45（Go 二进制缺失） |

### 2.3 根因链（已闭合）

**主链 —— run 卡 queued 僵尸：**

```
CI 发布建好新 release 747ca41ba059-5 并切 current 软链
  → 但 pm2 reload/startOrReload 不更新已存在进程的 script path / cwd（pm2 硬坑）
  → dm-api 仍在【旧】release c7149a4cb89d-3 上运行（实测进程 cwd = .../c7149a4.../apps/api）
  → 叠加 deploy:local 兜底遗留的游离 /app（含 .git 工作树，依赖不全）
  → 三套代码树并存不一致，dm-api 不稳定、崩溃重启
  → 进程重启使 LocalDockerExecutor 内存态(records Map)全部丢失
  → 当前仓库已在 RunsService.onModuleInit 增加 local-docker live run 恢复失败标记（runs.service.ts:49-70）
  → 但远端 dm-api 仍钉旧 release，未实际运行该修复；或部分历史 run 缺少 executor/backend 元数据，无法被该恢复逻辑识别
  → 表现为 run 永久“排队中”
```

三套代码树实测：

```
dm-api 真实 cwd = releases/c7149a4cb89d-3/apps/api   ← pm2 钉【旧】
current         → releases/747ca41ba059-5            ← 发布切到【新】，pm2 没跟（完整可跑）
/app (.git 工作树, admin 所有, 仍在变动)              ← deploy:local 兜底的游离第三套
```

**副链 —— build OOM / swap thrash：**

```
EXECUTOR=local-docker 在盒子上执行 pnpm install + next build
  → 1.8GB 内存扛不住，6/5 两个 run 直接 build:failed
  → vm.swappiness=80 触发激进 swap，慢磁盘上 swap thrash，构建“卡住没动静”
  → 命令 15 分钟超时（local-docker.executor.ts:819-823）后才报错
```

> 注：项目既定的「控制面离机构建发布」决策仍然成立；本方案里的“保留盒上构建”仅指用户流水线的 local-docker 执行器，是当前阶段的临时运行约束，不代表撤回 off-box control-plane deploy。

---

## 三、已处置（本次会话已完成，均可逆/低风险）

| 处置 | 结果 |
|------|------|
| `docker stop tekton-cluster-control-plane`（kind） | 释放常驻内存（available +316M），`docker start` 可拉回 |
| `pm2 stop dm-tekton-bridge` + `pm2 save` | 终止 ×45 重启循环，`pm2 restart` 可拉回 |
| 删除 `shared/local-docker-runs` 7 个残留目录 | 释放 1.5G |
| journald `SystemMaxUse=200M`（`/etc/systemd/journald.conf.d/size.conf`）+ vacuum | `/var/log/journal` 1.7G → 193M |
| `vm.swappiness 80 → 10`（`/etc/sysctl.d/99-swappiness.conf`） | 减少 swap thrash（构建卡死的直接帮凶） |
| cron 兜底清理 `/usr/local/bin/clean-local-docker-runs.sh`（每日 04:00 清 >1天旧 run 目录） | 防磁盘再被撑满 |
| 复核 pm2 内存熔断 | dm-web 已有 `max_memory_restart:400M`（repo `ecosystem.config.cjs` 管理），无需改 |

磁盘：93% → **90%**（3.8G free）。

---

## 四、修复方案（已按优先级执行）

### 4.1 临时止血 —— 让 pm2 对齐到 current（已执行，重启控制面约 10s）

`current`(747ca41) 经验证完整（`dist/main.js`✅ `node_modules`✅ `.env→shared/.env`✅ `ecosystem`✅），可安全切：

```bash
cd /opt/deploy-management/current
pm2 delete dm-api dm-web
pm2 start ecosystem.config.cjs --only dm-api,dm-web --update-env
pm2 save
```

- `--only` 限定，**不动 dm-tekton-bridge**（保留 stop 待命）。
- 用 `delete + start`（而非 `reload`）强制更新 script path / cwd 到 current。
- 本轮实测结果：
  - `dm-api` / `dm-web` 已重新注册到 `releases/747ca41ba059-5`。
  - `http://127.0.0.1:4000/healthz` 与 `http://127.0.0.1:3000/healthz` 均返回 `{"status":"ok"}`。
  - `dm-api` `pm2 describe` 显示 `status=online`、`restarts=0`、`script path=/opt/deploy-management/releases/747ca41ba059-5/scripts/runtime/run-api.sh`、`exec cwd=/opt/deploy-management/releases/747ca41ba059-5`。
  - 运行列表 API 需要 `CONTROL_PLANE_API_TOKEN`；本轮未读取线上进程 env，未做 `/api/runs` 带 token 校验。
- 副作用：dm-api/dm-web 中断约 10s；重启触发 `onModuleInit`，会把带 local-docker executor 元数据的 live run 标记 failed（属清理，预期内）；缺 executor/backend 的旧 run 需另写一次性数据修复或人工取消。
- **局限**：仅治标。`ecosystem.config.cjs` 用 `cwd:__dirname`（`ecosystem.config.cjs:8`），pm2 会把软链 resolve 成真实 release 路径，**下次发布到新 sha 仍会漂移** → 需 4.2 根治。

### 4.2 根治 —— 部署脚本不再漂移（repo 已落方案 A）

- **方案 A（已落地）**：发布脚本末尾改为「`pm2 delete <names>` → `pm2 start <current>/ecosystem.config.cjs --only dm-api,dm-web --update-env` → `pm2 save`」，每次发布强制重注册 dm-api/dm-web。代价：每次发布控制面重启约 10s；收益：行为确定，立即消除 pm2 script/cwd 钉旧 release。
- **方案 B（候选，需先验证）**：让 pm2 永远指向稳定软链：
  - `ecosystem.config.cjs` 的 `script` 改为绝对软链路径 `/opt/deploy-management/current/scripts/runtime/run-*.sh`；
  - `run-*.sh` 内把 `cd "$(dirname "$0")/../.."` 改为 `cd /opt/deploy-management/current`；
  - 发布只需「切 `current` 软链 + `pm2 reload`」，cwd 跟软链走、永不漂。
  - 风险点：pm2 可能仍 resolve 软链到真实 release；必须先在本机或远端测试态验证 `pm2 describe` 的 script/cwd 是否随 current 更新，再升级为推荐。

> 关联既有教训（避免重复踩坑）：发布脚本里 `pm2` 多名 `reload` 只会命中第一个；`dist` 被 git 跟踪会致 `ff-only pull` 失败需先 reset；非登录 shell 无 go PATH。详见 `scripts/deploy-server.sh`。

### 4.3 清理游离 /app 定时炸弹（待确认）

`/app` 是 `deploy:local` 兜底遗留的 git 工作树，pm2 一旦从它启动即 `MODULE_NOT_FOUND`。建议：
- 明确**只走 CI release/current**，弃用 `deploy:local` 兜底（或让其也产出标准 release）；
- 确认 pm2 不再引用 `/app` 后，清理或归档该目录。**删除前需人工确认**（含 .git 工作树）。
- 本轮未删除 `/app`。

---

## 五、小机器长期加固（架构方向）

### 5.1 原则

> **小机器只配当「部署目标 + 轻量控制面」，不可既构建又跑 k8s。**

### 5.2 决策记录（本次会话用户拍板）

- **保留用户流水线的盒子 `local-docker` 构建**（暂不外移到 CI / 专用 runner）。
- **kind / tekton-bridge 保留 stop 待命**（暂不卸载）。
- **不撤回 2026-06-08 的控制面离机构建发布决策**：dm-api/dm-web 仍应使用 CI 产物 + release/current + 健康门；这里讨论的是“用户流水线执行器是否在盒子上跑 build”，不是控制面自身发布方式。
- 推论：**build OOM 无法根除，只能缓解**。核心策略是「让小机器一次只干一件事、干完即清、崩了能自愈」，本质是 **time-for-memory**（单飞排队 + 靠 swap 慢爬），代价是构建变慢、超大前端项目仍可能撞 15 分钟超时。

### 5.3 代码层待办（进 repo + 走发布，按优先级）

| 优先级 | 项 | 现状 | 改法 |
|--------|----|------|------|
| P0 | 远端对齐 current | 当前仓库已有 stale local-docker run 恢复失败标记，但远端 dm-api 钉旧 release 时不会生效 | 先执行 4.1；验证 cwd/current、历史 run 清理结果 |
| P0 | 修 dm-api 路径漂移 | 见 4.2 | 部署脚本根治：先落方案 A；方案 B 仅在 pm2 软链行为验证后采用 |
| P0 | 修 queued 文案 | local-docker 仍复用 Tekton/云效措辞 `waiting for approval or runner capacity` | `snapshot.service.ts` 按 executor backend 区分：local-docker 启动中/单飞排队/stale run，不再显示 approval/runner capacity |
| P1 | **run 单飞闸** | `records` Map 无锁，多 run 并发各自 build 抢 1.8G 全爆 | 控制面加并发队列：同时只放 **1** 个 run 真正执行；其余 run 保持 queued 且写入“等待本机单飞闸”；API 重启后等待队列统一标 failed 或重新入队，不能静默僵死 |
| P1 | 构建完成即清理 | `execute()` 只 rm 自身目录，历史不清 | executor terminal 后清 runDir，但先确保持久化 logs/result/artifact metadata；默认保留最近 1-2 个 terminal run 供排障 |
| P2 | build 内存封顶 | next build 无堆限制 | build 阶段注入 `NODE_OPTIONS=--max-old-space-size=<按 swap 配>`，宁慢勿崩 |

本轮代码执行状态：

- P0 远端对齐 current：已手动执行 4.1，并验证 API/Web healthz 与 pm2 script/cwd。
- P0 路径漂移：已将 `scripts/lib/release-common.sh` 改为 `delete + start --only dm-api,dm-web`，并加回归测试防止回退到 `startOrReload` 或误拉起 bridge。
- P0 queued 文案：已按 executor backend 区分，local-docker queued 不再显示 `approval or runner capacity`。
- P0 详情页 queued 摘要：已从固定“等待执行器分配资源”改为按 executor/单飞闸显示“等待 local-docker 执行器启动”或“等待本机单飞闸释放”。
- UX 直接运行：当前列表与详情页运行按钮已直接使用流水线默认/最新配置触发，不打开 `RunLaunchDialog`，并有前端回归测试覆盖。
- P1 单飞闸：已在 `RunsService` 增加 local-docker 单飞队列；释放 slot 时会跳过已终态等待项。
- P1 runDir 清理：已在 `LocalDockerExecutor` terminal 后清理旧 runDir，默认保留当前 run + 最近 1 个历史目录，可用 `LOCAL_DOCKER_RETAINED_RUN_DIRS` 调整。
- P2 build 内存封顶：已在 node/generic build 阶段注入 `NODE_OPTIONS=--max-old-space-size=1024`，保留用户显式 `--max-old-space-size`，可用 `LOCAL_DOCKER_NODE_MAX_OLD_SPACE_MB` 调整。

### 5.4 未来扩容时的根治方向（非当前阶段）

- 走**离机构建**：CI 构建产物 → tar over SSH 推到盒子 → 原子 `release/current` 切换 + 健康门回滚（项目已有实现 `project_ci_offbox_deploy`，盒子彻底不跑 build）。
- 或迁 Tekton 路径到独立的、配得起 k8s 的机器。

---

## 六、验证清单

### 6.1 执行 4.1 后应满足

- [x] `pgrep -f dist/main.js` 的 `/proc/<pid>/cwd` 指向 `releases/747ca41ba059-5/...`（对齐 current，不再是 c7149a4）。
- [x] `pm2 describe dm-api | grep cwd` 指向 current 真实路径。
- [ ] 触发一个新 run，盯 `pm2 logs dm-api`：观察 `execute()` 是否真 spawn `git`，stage 是否从 `pending → running`，dm-api 是否当场崩。
- [ ] 历史 queued 僵尸 run：带 `executor.backend=local-docker` 的 live run 在重启后被标记 failed；缺 executor/backend 的旧 run 被列入一次性数据修复或人工取消清单。
- [ ] `free -h` 构建期 swap 不再剧烈 thrash；`df -h /` 维持下降趋势。

### 6.2 repo 修复后必须满足

- [x] `pnpm --filter @deploy-management/api test -- runs.service.spec.ts` 通过，覆盖 local-docker stale run 恢复失败标记、executor status sync 持久化、local-docker 单飞闸。
- [x] `pnpm --filter @deploy-management/api check` 通过。
- [x] `bash -n scripts/lib/release-common.sh scripts/activate-release.sh scripts/rollback.sh scripts/runtime/run-api.sh scripts/runtime/run-web.sh scripts/runtime/run-tekton-bridge.sh` 通过（本机用 `C:\Apps\Git\bin\bash.exe`，普通 `bash`/WSL 入口受权限限制）。
- [ ] 若采用方案 A：发布后 `pm2 describe dm-api dm-web` 的 script path / cwd 对齐当前 release；重复发布到新 release 后仍对齐。
- [ ] 若采用方案 B：先用测试态证明 pm2 没有把软链 script/cwd 固定到旧真实路径，再进入生产脚本。
- [x] local-docker `QUEUED` snapshot 文案按 backend 与原因区分，不再出现 `approval or runner capacity`。
- [x] 单飞闸场景：并发触发 2 个 run，第 1 个进入 running，第 2 个保持 queued 且显示“等待本机单飞闸”；释放 slot 后启动下一个，已终态等待项会被跳过。
- [x] local-docker runDir 清理与 Node build `NODE_OPTIONS` 封顶有单元测试覆盖。
- [x] `pnpm --filter @deploy-management/web test -- pipeline-run-detail-status.test.ts dashboard-shell-run-direct.test.tsx` 通过，覆盖详情页 queued 摘要和列表/详情页直接运行不弹窗。
- [x] `pnpm --filter @deploy-management/web check` 通过。

---

## 七、附录：可复用诊断命令

```bash
# A. 业务 run 层（API 在 :4000，:3000 是 web）
PID=$(pgrep -f dist/main.js); TOK=$(tr '\0' '\n' </proc/$PID/environ | sed -n 's/^CONTROL_PLANE_API_TOKEN=//p')
curl -s -H "Authorization: Bearer $TOK" http://127.0.0.1:4000/api/runs | python3 -m json.tool

# B. OS 子进程层（executor 真正 spawn 的命令 = 当前在跑的 stage）
ps -ef --forest | grep -E 'node|pnpm|git|docker' | grep -v grep

# C. 进程真实 cwd（判断 pm2 是否钉错 release）
readlink /proc/$(pgrep -f dist/main.js | head -1)/cwd

# D. 内存/OOM/磁盘
free -h; dmesg -T | grep -i 'oom-kill\|out of memory' | tail; df -h /

# E. release/current 一致性
ls -la /opt/deploy-management; readlink /opt/deploy-management/current
pm2 describe dm-api | grep -iE 'script path|cwd'
```

---

## 关联记忆 / 文档

- `project_production_deployment`（生产拓扑）
- `project_ci_offbox_deploy`（离机构建，已实现未推送）
- `feedback_offbox_first_cutover_traps`（首次切换三坑：shared/.env、pm2 钉旧/不迁 cwd、bridge 二进制缺）
- `feedback_deploy_server_sh_gotchas`（go PATH / dist 被跟踪 / pm2 多名 reload 只中第一个）
- `feedback_small_vm_oom_swappiness`（小机器 OOM 与 swappiness）
