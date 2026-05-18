---
title: "Supabase Storage Integration"
type: sprint
status: in-progress
created: "2026-05-14"
updated: "2026-05-18"
tags: [supabase, storage, postgres, pipeline, config, release, canary]
---

# Supabase Storage Integration

## 需求分析

目标：把控制面的流水线信息、配置、运行记录、制品、上线、审批、审计和运行事件从本地 JSON/内存态升级为 Supabase PostgreSQL 持久化，并保持当前 Nest service、Repository 和前端 API 行为稳定。

安全边界：

- `SUPABASE_SERVICE_ROLE_KEY` 只能在 API 服务端环境变量中使用，不能出现在前端、构建产物、文档示例或提交文件。
- 前端如果未来直接使用 Supabase，只能使用 `NEXT_PUBLIC_SUPABASE_ANON_KEY`，且必须配合 RLS 策略；当前阶段不让前端直连 Supabase。
- 缺少 `SUPABASE_URL` 时不能真实连接 Supabase；代码必须给出明确错误，而不是回退成假成功。

成功标准：

- 一份可直接在 Supabase SQL Editor 执行的迁移 SQL。
- `DEPLOYMENT_STORAGE=supabase` 后，现有 Repository 自动使用 Supabase 存储。
- 默认不配置时继续使用 `DEPLOYMENT_DATA_DIR` 本地 JSON，不破坏当前本地开发。
- 所有写入保留当前集合顺序，支持 seed、snapshot、prepend、update、delete。
- 不引入前端 secret 泄漏风险。

## 技术方案

官方依据：

- Supabase Data API 暴露表必须启用 RLS，原始 SQL 创建的表需要主动 `alter table ... enable row level security`。参考：https://supabase.com/docs/guides/database/postgres/row-level-security
- `service_role` / secret key 只能用于后端，因为它具备高权限并可绕过 RLS；不能放到浏览器或公开文档中。参考：https://supabase.com/docs/guides/api/api-keys
- RPC 适合把数据库内事务逻辑封装为函数后通过 API 调用，本方案用 RPC 做集合级原子替换。参考：https://supabase.com/docs/client/rpc

### 存储模型

第一阶段采用“领域文档表 + JSONB payload”的方式：

```text
deployment_records
  collection     pipelines / runs / artifacts / releases / approvals / audit-events / ...
  entity_id      领域对象 id
  payload        完整领域对象 JSONB
  sort_order     Repository 当前顺序
  created_at
  updated_at
```

理由：

- 当前 `packages/shared` 领域模型变化快，强行拆几十张关系表会让本轮迁移风险过高。
- 控制面读写模式目前是按集合 snapshot/list，再在 service 层聚合。
- JSONB + GIN index 足够支撑第一阶段配置、运行、审计查询。
- 后续可以在不破坏 API 的情况下，把热点集合逐步规范化为 `pipelines`、`pipeline_runs`、`artifacts`、`releases` 等关系表。

### 访问路径

```text
Nest Repository
  -> InMemoryRepository facade
    -> Local JsonRepositoryStore       默认
    -> SupabaseRepositoryStore         DEPLOYMENT_STORAGE=supabase
      -> PostgREST /rest/v1/deployment_records
      -> RPC replace_deployment_records(collection, records)
```

`replace_deployment_records` 在数据库内一次事务完成集合替换：

- upsert 当前集合的所有 entity。
- 删除当前集合里已经不存在的 entity。
- 保留 sort_order，支持 `prepend` 后的顺序。

## 环境变量

```powershell
$env:DEPLOYMENT_STORAGE = "supabase"
$env:SUPABASE_URL = "https://br-ideal-fawn-814db5fc.supabase.aidap-global.cn-beijing.volces.com:443"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service-role-key>"
```

可选：

```powershell
$env:SUPABASE_SCHEMA = "public"
```

## Sprint 任务拆解

- [x] Task 1: 定义 Supabase 表结构、索引、RLS 和原子替换 RPC。
- [x] Task 2: Repository store 增加 Supabase adapter，默认本地 JSON 不变。
- [x] Task 3: README 补环境变量、迁移执行方式和 secret 边界。
- [x] Task 4: 增加 Supabase health/preflight API。
- [x] Task 4.1: API 启动时加载 `.env`，避免本地配置只写文件但进程读不到。
- [x] Task 4.2: 灰度发布对象接入 Supabase collection：deployment-targets、environment-locks、release-plans、release-executions、release-events。
- [ ] Task 5: 增加查询优化：按 runId / pipelineId / collection 的局部读取，减少全量 snapshot。
- [ ] Task 6: 第二阶段规范化表设计：pipeline_runs、artifacts、release_deployments、audit_events。

## 变更日志

- 2026-05-14: 新增 `supabase/migrations/20260514_deployment_records.sql`，创建 `deployment_records`、更新时间触发器、原子替换 RPC，并启用 RLS。
- 2026-05-14: `apps/api/src/common/in-memory.repository.ts` 支持 `DEPLOYMENT_STORAGE=supabase`，通过 Supabase REST/RPC 持久化所有已有 collection。
- 2026-05-14: `apps/api/src/storage` 新增 `/api/storage/health`，用于检查当前存储后端、Supabase URL/service role 配置和 `deployment_records` 表是否可访问。
- 2026-05-14: `apps/api/src/common/load-env.ts` 新增零依赖 `.env` loader；`apps/api/src/main.ts` 在 Nest bootstrap 前加载，shell 环境变量优先。
- 2026-05-18: 新增 `release-events` collection。`deployArtifact`、灰度推进、暂停、恢复、全量、回滚、失败和环境锁释放都会写入独立事件记录；Supabase 模式下通过现有 `deployment_records` 自动入库。
- 2026-05-18: 新增 `supabase/migrations/20260518_release_records_indexes.sql`，为 `release-events`、`release-executions`、`release-plans`、`environment-locks`、`deployment-targets` 补常用查询索引。

## 审查记录

待补。

## 复利记录

待补。
