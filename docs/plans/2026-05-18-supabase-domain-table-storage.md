---
title: "Supabase 领域表持久化"
type: sprint
status: completed
created: "2026-05-18"
updated: "2026-05-18"
checkpoints: 0
tasks_total: 5
tasks_completed: 5
tags: [sprint, supabase, persistence, architecture]
aliases: ["Supabase 分表存储", "Domain Table Storage"]
---

# Supabase 领域表持久化

## Phase 1: Think

当前问题：之前为了先让数据进入 Supabase，采用了 `deployment_records(collection, payload)` 单表模型。这个模型能快速落地，但流水线、运行、运行事件、制品、上线、灰度、审批、审计全部混在同一张表里，不符合后续完整系统的治理方式。

本轮目标：保持现有 Repository facade 不大改服务层，同时让 Supabase 端按业务域拆表。不同业务位置必须有不同表、不同索引、不同健康检查结果。

非目标：

- 不引入 Prisma 或 ORM。
- 不把 shared 类型完全拆成固定 SQL 列。当前平台模型仍在快速演进，第一版使用领域表 + `payload jsonb` 保留兼容性。
- 不把 service role key 暴露给前端。

## Phase 2: Plan

采用“领域表 + JSONB payload + 领域索引”的中间架构：

```text
Repository<T>(collection)
  -> JsonRepositoryStore                  # 本地仍然按 collection 写 JSON 文件
  -> SupabaseRepositoryStore
     -> collection -> dm_* table mapping
     -> REST load from domain table
     -> RPC replace_dm_records(table, records)
```

领域表矩阵：

| Collection | Supabase table | 用途 |
|---|---|---|
| applications | dm_applications | 应用、负责人和默认仓库关系 |
| code-repositories | dm_source_repositories | 代码仓库、provider、分支和 tag 缓存 |
| pipelines | dm_pipelines | 流水线定义、阶段、变量、构建和镜像配置 |
| runs | dm_pipeline_runs | PipelineRun 主记录和阶段状态快照 |
| run-events | dm_run_events | 运行事件、命令流、日志和执行器状态回写 |
| artifacts | dm_artifacts | 镜像、包、SBOM、provenance 等制品 |
| releases | dm_releases | 上线部署主记录和当前灰度流量 |
| deployment-targets | dm_deployment_targets | 环境部署目标、namespace、workload 和健康检查配置 |
| environment-locks | dm_environment_locks | 同应用同环境的上线锁 |
| release-plans | dm_release_plans | 制品上线计划和灰度策略 |
| release-executions | dm_release_executions | 上线执行、步骤和回滚锚点 |
| release-events | dm_release_events | 灰度推进、暂停、恢复、全量、回滚事件流 |
| approvals | dm_approvals | 审批请求与决策 |
| audit-events | dm_audit_events | 控制面审计事件 |
| environments | dm_environments | 部署环境状态、当前版本和活跃锁 |
| runner-pools | dm_runner_pools | 执行池容量与队列状态 |

## Phase 3: Work

- [x] Task 1: 新增 Supabase 领域表迁移 `20260518_domain_storage_tables.sql`。
- [x] Task 2: Repository store 新增 collection -> domain table 映射，Supabase 模式不再写入 `deployment_records`。
- [x] Task 3: `GET /api/storage/health` 返回 domains/tables，并逐表检查迁移是否完整。
- [x] Task 4: README 更新 Supabase 接入说明，明确旧 generic migration 仅作为兼容参考。
- [x] Task 5: 运行 API 测试、全工作区 type-check 和 build。

验证结果：

```powershell
pnpm --filter @deploy-management/api test
pnpm check
pnpm build
```

结果：全部通过。第一次 API test 在沙箱内触发 Vitest/esbuild `spawn EPERM`，按权限策略在沙箱外重跑后通过。

## Phase 4: Review

审查重点：

- 未映射 collection 不能自动落到 catch-all 表，必须失败并提示补迁移。
- 领域表必须开启 RLS，只允许 service role 管理。
- 健康检查必须逐表发现缺失迁移，不能只检查一个旧表。
- 本地 JSON 模式不能被破坏。

## Phase 5: Compound

本轮沉淀：

- Supabase 持久化不再使用单一 `deployment_records` 承载所有业务对象。
- Repository facade 保持不变，服务层不需要知道 Supabase 表名。
- 新增 collection 时必须同时补 `DEPLOYMENT_STORAGE_COLLECTIONS` 和 `20260518_domain_storage_tables.sql`，否则 Supabase 模式会显式失败。
