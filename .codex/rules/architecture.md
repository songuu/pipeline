# Architecture Rules

## 跨资源引用必须校验归属

Service 层接受外部资源 ID（artifactId / releaseId / runId）时，如果该资源与当前操作有归属关系（同一 application / pipeline），必须在业务校验前先检查 applicationId 一致性。

来源: 2026-05-27 灰度版本选择 sprint, P0 review finding。

## 解耦策略：唯一来源 → fallback

硬编码的默认来源需要开放给用户选择时，优先用"可选参数 + 有值覆盖 + 无值兼容"模式，不引入新 endpoint 或 breaking change。

来源: 2026-05-27 canary baseline decoupling。

## 显式选择 vs 系统默认

用户主动传入的可选参数 resolve 失败 → throw。系统自动填充的参数 resolve 失败 → 可 fallback。区分语义避免静默降级破坏用户信任。

来源: 2026-05-27 compound, P1-1 review finding。
