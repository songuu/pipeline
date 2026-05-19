"use client";

import { useMemo } from "react";
import type { LifecycleStageKey, PipelineDefinition } from "@deploy-management/shared";
import { PipelineFlowCanvas } from "../graph/pipeline-flow-canvas";
import { pipelineDefinitionToGraph } from "../graph/pipeline-graph-adapter";
import type {
  PipelineFlowConnectPayload,
  PipelineGraphEdge,
  PipelineGraphNodeData,
} from "../graph/pipeline-graph-types";
import { STAGE_LABELS } from "./model";

export interface PipelineConfigFlowCanvasProps {
  pipeline: PipelineDefinition;
  selectedStage: LifecycleStageKey;
  invalidStages?: ReadonlySet<LifecycleStageKey>;
  customEdges?: ReadonlyArray<{ from: LifecycleStageKey; to: LifecycleStageKey }>;
  onSelectStage: (stage: LifecycleStageKey) => void;
  onConnectStages?: (payload: PipelineFlowConnectPayload) => void;
  minHeight?: number;
}

export function PipelineConfigFlowCanvas({
  pipeline,
  selectedStage,
  invalidStages,
  customEdges,
  onSelectStage,
  onConnectStages,
  minHeight = 480,
}: PipelineConfigFlowCanvasProps) {
  const graph = useMemo(() => {
    const base = pipelineDefinitionToGraph(pipeline);
    const customEdgeEntries: PipelineGraphEdge[] =
      customEdges?.map((edge) => ({
        id: `e:custom:${edge.from}->${edge.to}`,
        source: `stage:${edge.from}`,
        target: `stage:${edge.to}`,
        type: "smoothstep",
        data: { kind: "runAfter", active: true },
      })) ?? [];
    const existingIds = new Set(base.edges.map((edge) => edge.id));
    const dedupedCustom = customEdgeEntries.filter((edge) => !existingIds.has(edge.id));
    return {
      ...base,
      edges: [...base.edges, ...dedupedCustom],
      nodes: base.nodes.map((node) => {
        const stage = node.data.stage;
        const enriched: PipelineGraphNodeData = {
          ...node.data,
          title: STAGE_LABELS[stage] ?? node.data.title,
          status: invalidStages?.has(stage) ? "failed" : "pending",
          errorSummary: invalidStages?.has(stage) ? "缺少必需配置" : undefined,
        };
        return { ...node, data: enriched };
      }),
    };
  }, [pipeline, invalidStages, customEdges]);

  return (
    <PipelineFlowCanvas
      graph={graph}
      mode="editable"
      selectedStageKey={selectedStage}
      onSelectStage={onSelectStage}
      onConnectStages={onConnectStages}
      minHeight={minHeight}
    />
  );
}
