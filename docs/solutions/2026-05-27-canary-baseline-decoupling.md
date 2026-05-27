---
title: "灰度发布基线版本解耦"
date: 2026-05-27
tags: [solution, release, canary, decoupling]
related_instincts: []
aliases: ["灰度版本选择", "canary baseline selection"]
---

# 灰度发布基线版本解耦

## Problem

灰度发布时 baseline（对照版本）始终由 `findLatestStableRelease()` 自动解析，用户无法指定历史版本作为对照基线。

## Root Cause

`releases.service.ts` 的 `deployArtifact()` 方法硬编码了 `findLatestStableRelease()` 作为唯一的 baseline 来源，没有提供外部注入点。

## Solution

将"唯一来源"降级为"fallback"：

1. `DeployArtifactRequest` 新增 `baselineArtifactId?: string`
2. 新增 `resolveBaseline()` 方法：有值时使用指定 artifact + 校验 applicationId/packageMode 一致性；无值时 fallback 到原有自动解析
3. UI 制品中心加 `BaselineVersionSelector` 下拉组件

关键代码（`releases.service.ts`）：

```ts
private resolveBaseline(request, applicationId, environment, candidatePackageMode) {
  if (request.baselineArtifactId) {
    const baselineArtifact = this.artifacts.get(request.baselineArtifactId);
    const baselineRun = this.runs.get(baselineArtifact.runId);
    // P0: 跨应用隔离
    if (baselineRun.applicationId !== applicationId) throw ...;
    // packageMode 一致性
    if (baselinePackageMode !== candidatePackageMode) throw ...;
    return { stableRelease, baselineArtifactId, baselineSource: "user-selected" };
  }
  return { stableRelease: findLatestStableRelease(...), baselineSource: "auto-resolved" };
}
```

## Prevention

- 跨资源引用（artifact → release/run）必须先校验 applicationId 归属
- 用户显式选择失败时应报错，不静默 fallback
- 可选参数解耦时，始终保持无值时 100% 兼容

## Related

- [[feedback_cross_resource_app_isolation]] — 跨资源引用必须校验归属
- [[feedback_zod_security_first_pass]] — zod schema 安全校验第一版就到位
