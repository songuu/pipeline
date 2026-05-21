import type {
  LifecycleStageKey,
  PipelineDefinition,
  PipelineRun,
  PipelineStageRun,
} from "@deploy-management/shared";
import type { TektonTaskGraphNode } from "@deploy-management/shared";
import type {
  PipelineGraph,
  PipelineGraphEdge,
  PipelineGraphEdgeKind,
  PipelineGraphNode,
  PipelineGraphNodeData,
} from "./pipeline-graph-types";

const COLUMN_WIDTH = 240;
const ROW_HEIGHT = 120;

const STAGE_TITLES: Record<LifecycleStageKey, string> = {
  source: "拉取源码",
  test: "测试",
  build: "构建",
  env: "环境配置",
  package: "打包",
  upload: "上传",
  deploy: "部署",
  canary: "灰度",
  approval: "审批",
  promote: "全量发布",
};

const DEFAULT_STAGE_DAG: Record<LifecycleStageKey, LifecycleStageKey[]> = {
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

const STAGE_FALLBACK_ORDER: LifecycleStageKey[] = [
  "source",
  "test",
  "build",
  "env",
  "package",
  "upload",
  "deploy",
  "canary",
  "approval",
  "promote",
];

function dedupeStages(stages: LifecycleStageKey[]): LifecycleStageKey[] {
  return [...new Set(stages)];
}

function collectNearestEnabledDependencies(
  stage: LifecycleStageKey,
  enabledStages: ReadonlySet<LifecycleStageKey>,
  visited = new Set<LifecycleStageKey>(),
): LifecycleStageKey[] {
  if (visited.has(stage)) return [];
  visited.add(stage);

  const resolvedDependencies: LifecycleStageKey[] = [];
  for (const dependency of DEFAULT_STAGE_DAG[stage] ?? []) {
    if (enabledStages.has(dependency)) {
      resolvedDependencies.push(dependency);
      continue;
    }
    resolvedDependencies.push(...collectNearestEnabledDependencies(dependency, enabledStages, visited));
  }
  return dedupeStages(resolvedDependencies);
}

function hasCompressedDependencyPath(
  stage: LifecycleStageKey,
  target: LifecycleStageKey,
  enabledStages: ReadonlySet<LifecycleStageKey>,
  visited = new Set<LifecycleStageKey>(),
): boolean {
  if (visited.has(stage)) return false;
  visited.add(stage);

  for (const dependency of collectNearestEnabledDependencies(stage, enabledStages)) {
    if (dependency === target) return true;
    if (hasCompressedDependencyPath(dependency, target, enabledStages, visited)) return true;
  }
  return false;
}

function pruneRedundantDependencies(
  dependencies: LifecycleStageKey[],
  enabledStages: ReadonlySet<LifecycleStageKey>,
): LifecycleStageKey[] {
  const uniqueDependencies = dedupeStages(dependencies);
  return uniqueDependencies.filter(
    (dependency) =>
      !uniqueDependencies.some(
        (otherDependency) =>
          otherDependency !== dependency &&
          hasCompressedDependencyPath(otherDependency, dependency, enabledStages),
      ),
  );
}

export function defaultStageRunAfter(
  stage: LifecycleStageKey,
  enabledStages: ReadonlySet<LifecycleStageKey>,
): LifecycleStageKey[] {
  return pruneRedundantDependencies(collectNearestEnabledDependencies(stage, enabledStages), enabledStages);
}

export function stageNodeId(stage: LifecycleStageKey): string {
  return `stage:${stage}`;
}

export function edgeId(from: LifecycleStageKey, to: LifecycleStageKey, kind: PipelineGraphEdgeKind = "runAfter"): string {
  return `e:${kind}:${from}->${to}`;
}

interface BuildOptions {
  stageStatuses?: Map<LifecycleStageKey, PipelineStageRun>;
  commandCounts?: Map<LifecycleStageKey, number>;
  artifactCounts?: Map<LifecycleStageKey, number>;
  errorSummaries?: Map<LifecycleStageKey, string>;
  taskRunNames?: Map<LifecycleStageKey, string>;
}

interface StageEdge {
  from: LifecycleStageKey;
  to: LifecycleStageKey;
  kind: PipelineGraphEdgeKind;
}

function buildAdjacency(
  stages: ReadonlyArray<LifecycleStageKey>,
  dependencies: Map<LifecycleStageKey, LifecycleStageKey[]>,
): { incoming: Map<LifecycleStageKey, LifecycleStageKey[]>; edges: StageEdge[] } {
  const stageSet = new Set(stages);
  const incoming = new Map<LifecycleStageKey, LifecycleStageKey[]>();
  const edges: StageEdge[] = [];
  for (const stage of stages) {
    const deps = (dependencies.get(stage) ?? []).filter((dep) => stageSet.has(dep));
    incoming.set(stage, deps);
    for (const dep of deps) {
      edges.push({ from: dep, to: stage, kind: "runAfter" });
    }
  }
  return { incoming, edges };
}

export function detectCycle(
  stages: ReadonlyArray<LifecycleStageKey>,
  dependencies: Map<LifecycleStageKey, LifecycleStageKey[]>,
): LifecycleStageKey[] | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<LifecycleStageKey, number>();
  for (const stage of stages) color.set(stage, WHITE);
  const path: LifecycleStageKey[] = [];

  function visit(stage: LifecycleStageKey): LifecycleStageKey[] | null {
    color.set(stage, GRAY);
    path.push(stage);
    const deps = dependencies.get(stage) ?? [];
    for (const dep of deps) {
      const state = color.get(dep) ?? WHITE;
      if (state === GRAY) {
        const cycleStart = path.indexOf(dep);
        return cycleStart >= 0 ? [...path.slice(cycleStart), dep] : [dep, stage, dep];
      }
      if (state === WHITE) {
        const cycle = visit(dep);
        if (cycle) return cycle;
      }
    }
    color.set(stage, BLACK);
    path.pop();
    return null;
  }

  for (const stage of stages) {
    if (color.get(stage) === WHITE) {
      const cycle = visit(stage);
      if (cycle) return cycle;
    }
  }
  return null;
}

function topoLayers(
  stages: ReadonlyArray<LifecycleStageKey>,
  incoming: Map<LifecycleStageKey, LifecycleStageKey[]>,
): LifecycleStageKey[][] {
  const layers: LifecycleStageKey[][] = [];
  const remaining = new Map(stages.map((stage) => [stage, [...(incoming.get(stage) ?? [])]] as const));
  const placed = new Set<LifecycleStageKey>();

  while (remaining.size > 0) {
    const layer: LifecycleStageKey[] = [];
    for (const [stage, deps] of remaining) {
      if (deps.every((dep) => placed.has(dep))) {
        layer.push(stage);
      }
    }
    if (layer.length === 0) {
      const fallback = [...remaining.keys()].sort(
        (a, b) => STAGE_FALLBACK_ORDER.indexOf(a) - STAGE_FALLBACK_ORDER.indexOf(b),
      );
      layer.push(...fallback);
    }
    layer.sort((a, b) => STAGE_FALLBACK_ORDER.indexOf(a) - STAGE_FALLBACK_ORDER.indexOf(b));
    layers.push(layer);
    for (const stage of layer) {
      placed.add(stage);
      remaining.delete(stage);
    }
  }
  return layers;
}

function buildNodesAndEdges(
  stages: ReadonlyArray<LifecycleStageKey>,
  dependencies: Map<LifecycleStageKey, LifecycleStageKey[]>,
  options: BuildOptions = {},
): PipelineGraph {
  const cycle = detectCycle(stages, dependencies);
  if (cycle) {
    throw new Error(`pipeline graph has cycle: ${cycle.join(" -> ")}`);
  }

  const { incoming, edges: stageEdges } = buildAdjacency(stages, dependencies);
  const layers = topoLayers(stages, incoming);

  const positionByStage = new Map<LifecycleStageKey, { x: number; y: number }>();
  layers.forEach((layer, columnIndex) => {
    layer.forEach((stage, rowIndex) => {
      positionByStage.set(stage, {
        x: columnIndex * COLUMN_WIDTH,
        y: rowIndex * ROW_HEIGHT,
      });
    });
  });

  const nodes: PipelineGraphNode[] = stages.map((stage) => {
    const stageRun = options.stageStatuses?.get(stage);
    const data: PipelineGraphNodeData = {
      stage,
      title: stageRun?.title ?? STAGE_TITLES[stage] ?? stage,
      status: stageRun?.status,
      durationMs: stageRun?.durationMs,
      commandCount: options.commandCounts?.get(stage),
      artifactCount: options.artifactCounts?.get(stage),
      errorSummary: options.errorSummaries?.get(stage),
      taskRunName: options.taskRunNames?.get(stage),
    };
    return {
      id: stageNodeId(stage),
      type: "pipelineStage",
      position: positionByStage.get(stage) ?? { x: 0, y: 0 },
      data,
    };
  });

  const edges: PipelineGraphEdge[] = stageEdges.map(({ from, to, kind }) => ({
    id: edgeId(from, to, kind),
    source: stageNodeId(from),
    target: stageNodeId(to),
    type: "smoothstep",
    data: { kind },
  }));

  return { nodes, edges };
}

export function pipelineDefinitionToGraph(pipeline: PipelineDefinition): PipelineGraph {
  const stages = pipeline.stages;
  const stageSet = new Set(stages);
  const dependencies = new Map<LifecycleStageKey, LifecycleStageKey[]>();
  for (const stage of stages) {
    dependencies.set(stage, defaultStageRunAfter(stage, stageSet));
  }
  return buildNodesAndEdges(stages, dependencies);
}

export interface PipelineRunGraphOptions {
  commandCounts?: Partial<Record<LifecycleStageKey, number>>;
  artifactCounts?: Partial<Record<LifecycleStageKey, number>>;
  errorSummaries?: Partial<Record<LifecycleStageKey, string>>;
  taskRunNames?: Partial<Record<LifecycleStageKey, string>>;
}

export function pipelineRunToGraph(
  run: PipelineRun,
  options: PipelineRunGraphOptions = {},
): PipelineGraph {
  const pipeline = run.definitionSnapshot;
  const stages = pipeline.stages;
  const stageSet = new Set(stages);
  const dependencies = new Map<LifecycleStageKey, LifecycleStageKey[]>();
  for (const stage of stages) {
    dependencies.set(stage, defaultStageRunAfter(stage, stageSet));
  }
  const stageStatuses = new Map<LifecycleStageKey, PipelineStageRun>();
  for (const stage of run.stages) {
    stageStatuses.set(stage.key, stage);
  }
  return buildNodesAndEdges(stages, dependencies, {
    stageStatuses,
    commandCounts: partialRecordToMap(options.commandCounts),
    artifactCounts: partialRecordToMap(options.artifactCounts),
    errorSummaries: partialRecordToMap(options.errorSummaries),
    taskRunNames: partialRecordToMap(options.taskRunNames),
  });
}

export function tektonTaskGraphToGraph(taskGraph: ReadonlyArray<TektonTaskGraphNode>): PipelineGraph {
  const stages = taskGraph.map((node) => node.name);
  const dependencies = new Map<LifecycleStageKey, LifecycleStageKey[]>();
  for (const node of taskGraph) {
    dependencies.set(node.name, [...node.runAfter]);
  }
  return buildNodesAndEdges(stages, dependencies, {
    taskRunNames: new Map(taskGraph.map((node) => [node.name, node.taskRef])),
  });
}

function partialRecordToMap<T>(record?: Partial<Record<LifecycleStageKey, T>>): Map<LifecycleStageKey, T> | undefined {
  if (!record) return undefined;
  const map = new Map<LifecycleStageKey, T>();
  for (const [key, value] of Object.entries(record) as [LifecycleStageKey, T][]) {
    if (value !== undefined) {
      map.set(key, value);
    }
  }
  return map;
}
