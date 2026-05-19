import type { LifecycleStageKey } from "../platform";
import { resolveAllowedAncestors } from "./default-stage-dag";

export type DagViolationRule =
  | "no-cycle"
  | "no-reverse-stage"
  | "build-before-upload"
  | "source-required"
  | "source-no-incoming"
  | "stage-allowlist";

export interface DagViolation {
  rule: DagViolationRule;
  message: string;
  stages?: LifecycleStageKey[];
}

export interface DagEdge {
  from: LifecycleStageKey;
  to: LifecycleStageKey;
}

export interface PipelineGraphSnapshot {
  stages: LifecycleStageKey[];
  edges: DagEdge[];
}

const STAGE_ORDER: Record<LifecycleStageKey, number> = {
  source: 0,
  test: 1,
  build: 1,
  env: 2,
  package: 3,
  upload: 4,
  deploy: 5,
  canary: 6,
  approval: 7,
  promote: 8,
};


export function detectGraphCycle(snapshot: PipelineGraphSnapshot): LifecycleStageKey[] | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<LifecycleStageKey, number>();
  for (const stage of snapshot.stages) color.set(stage, WHITE);
  const adjacency = new Map<LifecycleStageKey, LifecycleStageKey[]>();
  for (const edge of snapshot.edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }
  const path: LifecycleStageKey[] = [];

  function visit(stage: LifecycleStageKey): LifecycleStageKey[] | null {
    color.set(stage, GRAY);
    path.push(stage);
    const next = adjacency.get(stage) ?? [];
    for (const target of next) {
      const state = color.get(target) ?? WHITE;
      if (state === GRAY) {
        const cycleStart = path.indexOf(target);
        return cycleStart >= 0 ? [...path.slice(cycleStart), target] : [target, stage];
      }
      if (state === WHITE) {
        const cycle = visit(target);
        if (cycle) return cycle;
      }
    }
    color.set(stage, BLACK);
    path.pop();
    return null;
  }

  for (const stage of snapshot.stages) {
    if (color.get(stage) === WHITE) {
      const cycle = visit(stage);
      if (cycle) return cycle;
    }
  }
  return null;
}

export function validatePipelineGraph(snapshot: PipelineGraphSnapshot): {
  valid: boolean;
  violations: DagViolation[];
} {
  const violations: DagViolation[] = [];
  const stageSet = new Set(snapshot.stages);

  if (!stageSet.has("source")) {
    violations.push({
      rule: "source-required",
      message: "source 阶段必须存在",
      stages: ["source"],
    });
  }

  for (const edge of snapshot.edges) {
    if (edge.to === "source") {
      violations.push({
        rule: "source-no-incoming",
        message: `source 阶段不允许有上游依赖 (from ${edge.from})`,
        stages: [edge.from, "source"],
      });
    }
  }

  if (stageSet.has("upload") && !stageSet.has("build")) {
    violations.push({
      rule: "build-before-upload",
      message: "启用 upload 必须同时启用 build",
      stages: ["build", "upload"],
    });
  }

  for (const edge of snapshot.edges) {
    if (!stageSet.has(edge.from) || !stageSet.has(edge.to)) continue;
    const fromOrder = STAGE_ORDER[edge.from];
    const toOrder = STAGE_ORDER[edge.to];
    if (fromOrder > toOrder) {
      violations.push({
        rule: "no-reverse-stage",
        message: `${edge.from} 不能依赖比自己更晚的阶段 ${edge.to}`,
        stages: [edge.from, edge.to],
      });
    }
    if (fromOrder === toOrder && edge.from !== edge.to) {
      // 同层（test 与 build）之间显式互依也不允许
      violations.push({
        rule: "no-reverse-stage",
        message: `同层阶段 ${edge.from} 与 ${edge.to} 之间不允许互相依赖`,
        stages: [edge.from, edge.to],
      });
    }
  }

  for (const edge of snapshot.edges) {
    if (!stageSet.has(edge.from) || !stageSet.has(edge.to)) continue;
    const allowed = resolveAllowedAncestors(edge.to, stageSet);
    if (!allowed.has(edge.from)) {
      const allowedList = Array.from(allowed).join(", ") || "(无)";
      // stage-allowlist 几乎只在"跳过启用的 gate stage"时触发。
      // 解释 why: edge.from 虽然是合法祖先，但被中间的启用 gate stage 截断。
      violations.push({
        rule: "stage-allowlist",
        message:
          `${edge.to} 的允许直接上游为 [${allowedList}]，不允许来自 ${edge.from}。` +
          `原因: 中间已启用的 stage 必须经过 — 请把依赖改连到 [${allowedList}] 之一。`,
        stages: [edge.from, edge.to],
      });
    }
  }

  const cycle = detectGraphCycle(snapshot);
  if (cycle) {
    violations.push({
      rule: "no-cycle",
      message: `存在循环依赖: ${cycle.join(" -> ")}`,
      stages: cycle,
    });
  }

  return { valid: violations.length === 0, violations };
}
