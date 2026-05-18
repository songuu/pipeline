"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import type { LifecycleStageKey } from "@deploy-management/shared";
import { PipelineFlowNode } from "./pipeline-flow-node";
import type { PipelineFlowCanvasProps, PipelineGraphNode } from "./pipeline-graph-types";

const NODE_TYPES: NodeTypes = { pipelineStage: PipelineFlowNode };

function PipelineFlowCanvasInner({
  graph,
  mode = "readonly",
  selectedStageKey,
  onSelectStage,
  className,
  minHeight = 480,
}: PipelineFlowCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { fitView } = useReactFlow();

  const isReadonly = mode === "readonly" || mode === "template-preview";

  const nodes = useMemo(
    () =>
      graph.nodes.map((node) => ({
        ...node,
        data: { ...node.data, selected: node.data.stage === selectedStageKey },
        selected: node.data.stage === selectedStageKey,
      })),
    [graph.nodes, selectedStageKey],
  );

  const edges = useMemo(() => graph.edges, [graph.edges]);

  const handleNodeClick = useCallback<NodeMouseHandler<PipelineGraphNode>>(
    (_event, node) => {
      if (!onSelectStage) return;
      onSelectStage(node.data.stage as LifecycleStageKey);
    },
    [onSelectStage],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => fitView({ padding: 0.15, duration: 0 }));
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [fitView]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: "100%",
        height: "100%",
        minHeight,
        overflow: "hidden",
        background: "var(--soft, #f9fbfd)",
        border: "1px solid var(--line, #e5eaf0)",
        borderRadius: 12,
        position: "relative",
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        nodesDraggable={!isReadonly}
        nodesConnectable={!isReadonly}
        elementsSelectable={true}
        edgesFocusable={false}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#d8e0ea" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      <style>{`@keyframes pipeline-flow-pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.25); opacity: 0.7; }
      }`}</style>
    </div>
  );
}

export function PipelineFlowCanvas(props: PipelineFlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <PipelineFlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export { PipelineFlowNode } from "./pipeline-flow-node";
export type {
  PipelineGraph,
  PipelineGraphEdge,
  PipelineGraphEdgeData,
  PipelineGraphEdgeKind,
  PipelineGraphMode,
  PipelineGraphNode,
  PipelineGraphNodeData,
  PipelineFlowCanvasProps,
} from "./pipeline-graph-types";
