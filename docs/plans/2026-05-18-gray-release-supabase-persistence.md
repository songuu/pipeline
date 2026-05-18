---
title: "灰度发布 Supabase 持久化"
type: sprint
status: in-progress
created: "2026-05-18"
updated: "2026-05-18"
checkpoints: 1
tasks_total: 5
tasks_completed: 4
tags: [sprint, supabase, release, canary, persistence]
aliases: ["灰度记录入库", "Release Events Supabase"]
---

# 灰度发布 Supabase 持久化

## Phase 1: Think

目标：灰度发布相关的配置、执行、锁、事件记录必须和流水线、运行、制品一样进入当前 Repository Store；当 `DEPLOYMENT_STORAGE=supabase` 时，所有灰度对象都必须写入 Supabase `deployment_records`，不能只存在 UI 状态或内存日志里。

成功标准：

- DeploymentTarget、EnvironmentLock、ReleasePlan、ReleaseExecution、ReleaseEvent 都是 repository-backed collection。
- 灰度动作必须产生独立事件：开始、成功、失败、推进、暂停、恢复、全量、回滚、环境锁释放。
- API 和 snapshot 能直接读到这些对象，方便前端后续展示 Release 详情页。
- Supabase migration 补充常用查询索引，避免 release event / lock 查询完全依赖 JSONB 全表扫描。

## Phase 2: Plan

采用已有 Supabase generic store，不新增业务专表：

```text
Release action
  -> ReleasesService
  -> ReleaseEventsRepository("release-events")
  -> InMemoryRepository facade
  -> JsonRepositoryStore | SupabaseRepositoryStore
  -> deployment_records(collection='release-events')
```

第一阶段不把 release event 拆成独立 SQL 表，原因是当前 shared 契约仍在快速演进；先用 JSONB payload 保留完整事件上下文，后续再根据查询热点规范化。

## Phase 3: Work

- [x] Task 1: shared 新增 `ReleaseEvent` / `ReleaseEventType`，`PlatformSnapshot` 新增 `releaseEvents`。
- [x] Task 2: API 新增 `ReleaseEventsRepository`，collection 名称为 `release-events`。
- [x] Task 3: `deployArtifact`、canary advance/pause/resume/promote/rollback/failed 全部记录 release event。
- [x] Task 4: API / snapshot / README / Supabase 索引迁移补齐。
- [ ] Task 5: 前端 Release 详情页展示 release event 时间线和事件 payload。

### 验证

```powershell
pnpm --filter @deploy-management/shared build
pnpm --filter @deploy-management/api check
pnpm --filter @deploy-management/web check
pnpm check
pnpm build
pnpm --filter @deploy-management/api test
```

## Phase 4: Review

重点风险：

- release event 写入失败时，不能留下 active environment lock。
- service role key 仍然只在 API 端使用，前端不得直连 Supabase 读取 release event。
- 当前 Supabase 存储是集合级 replace RPC，事件量大以后需要 Task 5/Task 6 的局部读取优化。

## Phase 5: Compound

待本轮实现验证后补充。
