import type { Edge, Node } from "@xyflow/react";
import type { LifecycleStageKey, StageStatus } from "@deploy-management/shared";

export type PipelineGraphMode = "readonly" | "editable" | "template-preview";

export type PipelineGraphEdgeKind =
  | "runAfter"
  | "condition"
  | "artifact"
  | "approval"
  | "finally";

export interface PipelineGraphNodeData extends Record<string, unknown> {
  stage: LifecycleStageKey;
  title: string;
  subtitle?: string;
  status?: StageStatus;
  commandCount?: number;
  artifactCount?: number;
  durationMs?: number;
  taskRunName?: string;
  selected?: boolean;
  disabled?: boolean;
  errorSummary?: string;
}

export interface PipelineGraphEdgeData extends Record<string, unknown> {
  kind: PipelineGraphEdgeKind;
  label?: string;
  condition?: string;
  active?: boolean;
}

export type PipelineGraphNode = Node<PipelineGraphNodeData, "pipelineStage">;
export type PipelineGraphEdge = Edge<PipelineGraphEdgeData>;

export interface PipelineGraph {
  nodes: PipelineGraphNode[];
  edges: PipelineGraphEdge[];
}

export interface PipelineFlowConnectPayload {
  source: LifecycleStageKey;
  target: LifecycleStageKey;
}

export interface PipelineFlowCanvasProps {
  graph: PipelineGraph;
  mode?: PipelineGraphMode;
  selectedStageKey?: LifecycleStageKey;
  onSelectStage?: (stage: LifecycleStageKey) => void;
  onConnectStages?: (payload: PipelineFlowConnectPayload) => void;
  className?: string;
  minHeight?: number;
}
