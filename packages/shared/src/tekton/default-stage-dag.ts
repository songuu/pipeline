import type { LifecycleStageKey } from "../platform";

/**
 * Canonical lifecycle stage DAG. Source of truth for both:
 * - apps/api buildTaskGraph (via re-export)
 * - services/tekton-bridge defaultStageDAG (mirror, guarded by snapshot.service.spec.ts sync test)
 */
export const DEFAULT_STAGE_DAG: Record<LifecycleStageKey, LifecycleStageKey[]> = {
  source: [],
  test: ["source"],
  build: ["source"],
  env: ["test", "build"],
  package: ["env"],
  upload: ["package"],
  deploy: ["upload"],
  canary: ["deploy"],
  approval: ["canary"],
  promote: ["approval"],
};

/** Returns the runAfter list for a stage, filtered to only enabled upstream stages. */
export function resolveStageRunAfter(
  stage: LifecycleStageKey,
  enabledStages: ReadonlySet<LifecycleStageKey>,
): LifecycleStageKey[] {
  return (DEFAULT_STAGE_DAG[stage] ?? []).filter((dep) => enabledStages.has(dep));
}

/**
 * Resolve the set of stages that are valid direct upstreams of `toStage` when only `enabledStages`
 * are present. Walks DEFAULT_STAGE_DAG transitively, skipping disabled stages so that the closest
 * enabled ancestor remains allowed (matches buildTaskGraph fallback behaviour).
 */
export function resolveAllowedAncestors(
  toStage: LifecycleStageKey,
  enabledStages: ReadonlySet<LifecycleStageKey>,
): Set<LifecycleStageKey> {
  const allowed = new Set<LifecycleStageKey>();
  const visited = new Set<LifecycleStageKey>();
  const queue: LifecycleStageKey[] = [...(DEFAULT_STAGE_DAG[toStage] ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (enabledStages.has(current)) {
      allowed.add(current);
      continue;
    }
    const parents = DEFAULT_STAGE_DAG[current] ?? [];
    queue.push(...parents);
  }
  return allowed;
}
