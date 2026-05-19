import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { PipelineFlowNode } from "../pipeline-flow-node";
import type { PipelineGraphNodeData } from "../pipeline-graph-types";

type NodeRenderProps = ComponentProps<typeof PipelineFlowNode>;

function makeNodeProps(data: PipelineGraphNodeData, selected = false): NodeRenderProps {
  return {
    id: `stage:${data.stage}`,
    type: "pipelineStage",
    data,
    selected,
    dragging: false,
    isConnectable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    width: 200,
    height: 80,
    zIndex: 0,
  } as unknown as NodeRenderProps;
}

function Wrapper({ children }: { children: ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

describe("PipelineFlowNode", () => {
  it("pending 状态显示待执行标签", () => {
    render(<PipelineFlowNode {...(makeNodeProps({ stage: "source", title: "拉取代码", status: "pending" }) )} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText("拉取代码")).toBeTruthy();
    expect(screen.getByText("待执行")).toBeTruthy();
    cleanup();
  });

  it("running 状态显示运行中标签 + 命令数", () => {
    render(
      <PipelineFlowNode
        {...(makeNodeProps({ stage: "build", title: "构建", status: "running", commandCount: 3 }) )}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText("构建")).toBeTruthy();
    expect(screen.getByText("运行中")).toBeTruthy();
    expect(screen.getByText("3 命令")).toBeTruthy();
    cleanup();
  });

  it("success 状态显示成功 + 耗时", () => {
    render(
      <PipelineFlowNode
        {...(makeNodeProps({ stage: "deploy", title: "部署", status: "success", durationMs: 12000 }) )}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText("部署")).toBeTruthy();
    expect(screen.getByText("成功")).toBeTruthy();
    expect(screen.getByText("12s")).toBeTruthy();
    cleanup();
  });

  it("failed 状态显示错误摘要", () => {
    render(
      <PipelineFlowNode
        {...(makeNodeProps({
          stage: "test",
          title: "测试",
          status: "failed",
          errorSummary: "依赖安装失败",
        }) )}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText("测试")).toBeTruthy();
    expect(screen.getByText("失败")).toBeTruthy();
    expect(screen.getByText("依赖安装失败")).toBeTruthy();
    cleanup();
  });

  it("skipped 状态不显示 errorSummary 即使设置了", () => {
    render(
      <PipelineFlowNode
        {...(makeNodeProps({
          stage: "canary",
          title: "灰度",
          status: "skipped",
          errorSummary: "本不应显示",
        }) )}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText("跳过")).toBeTruthy();
    expect(screen.queryByText("本不应显示")).toBeNull();
    cleanup();
  });
});
