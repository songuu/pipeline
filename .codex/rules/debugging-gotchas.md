# Debugging Gotchas

## shared 包改类型后 API tsc 报 "has no exported member"

shared package 通过 `dist/` 解析（`"types": "dist/index.d.ts"`）。改了 `packages/shared/src/` 的类型后必须先 `pnpm --filter @deploy-management/shared build` 再跑 API 的 `tsc --noEmit`，否则 dist 缓存仍是旧版。

来源: 2026-05-27 sprint Task 1-3，tsc 报 6 个 TS2305/TS2339 错误，rebuild shared 后即清。
