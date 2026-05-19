import { describe, expect, it } from "vitest";
import { detectGraphCycle, validatePipelineGraph } from "./dag-validation";

describe("dag-validation", () => {
  it("接受合法线性 DAG", () => {
    const result = validatePipelineGraph({
      stages: ["source", "build", "deploy"],
      edges: [
        { from: "source", to: "build" },
        { from: "build", to: "deploy" },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("接受并行 + fan-in", () => {
    const result = validatePipelineGraph({
      stages: ["source", "test", "build", "env"],
      edges: [
        { from: "source", to: "test" },
        { from: "source", to: "build" },
        { from: "test", to: "env" },
        { from: "build", to: "env" },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("缺 source 触发 source-required", () => {
    const result = validatePipelineGraph({
      stages: ["build", "deploy"],
      edges: [{ from: "build", to: "deploy" }],
    });
    expect(result.violations.find((v) => v.rule === "source-required")).toBeDefined();
  });

  it("source 有入边触发 source-no-incoming", () => {
    const result = validatePipelineGraph({
      stages: ["source", "build"],
      edges: [{ from: "build", to: "source" }],
    });
    const rules = result.violations.map((v) => v.rule);
    expect(rules).toContain("source-no-incoming");
  });

  it("upload 缺 build 触发 build-before-upload", () => {
    const result = validatePipelineGraph({
      stages: ["source", "upload"],
      edges: [{ from: "source", to: "upload" }],
    });
    expect(result.violations.find((v) => v.rule === "build-before-upload")).toBeDefined();
  });

  it("deploy → build 反向触发 no-reverse-stage", () => {
    const result = validatePipelineGraph({
      stages: ["source", "build", "deploy"],
      edges: [
        { from: "source", to: "build" },
        { from: "deploy", to: "build" },
      ],
    });
    const reverse = result.violations.find((v) => v.rule === "no-reverse-stage");
    expect(reverse).toBeDefined();
    expect(reverse!.stages).toEqual(["deploy", "build"]);
  });

  it("test → build 同层互依触发 no-reverse-stage", () => {
    const result = validatePipelineGraph({
      stages: ["source", "test", "build"],
      edges: [
        { from: "source", to: "test" },
        { from: "source", to: "build" },
        { from: "test", to: "build" },
      ],
    });
    const reverse = result.violations.find((v) => v.rule === "no-reverse-stage");
    expect(reverse).toBeDefined();
  });

  it("跨过启用的 gate stage 触发 stage-allowlist (source -> env 当 test/build 都启用时)", () => {
    const result = validatePipelineGraph({
      stages: ["source", "test", "build", "env"],
      edges: [
        { from: "source", to: "test" },
        { from: "source", to: "build" },
        { from: "source", to: "env" },
        { from: "test", to: "env" },
        { from: "build", to: "env" },
      ],
    });
    const violation = result.violations.find(
      (v) => v.rule === "stage-allowlist" && v.stages?.[0] === "source" && v.stages?.[1] === "env",
    );
    expect(violation).toBeDefined();
  });

  it("中间 gate 全部禁用时, 跨级依赖被 fallback 接受 (source -> env 当 test+build 都禁用)", () => {
    const result = validatePipelineGraph({
      stages: ["source", "env"],
      edges: [{ from: "source", to: "env" }],
    });
    const violation = result.violations.find((v) => v.rule === "stage-allowlist");
    expect(violation).toBeUndefined();
  });

  it("检测环依赖", () => {
    const result = validatePipelineGraph({
      stages: ["source", "test", "build", "env"],
      edges: [
        { from: "source", to: "test" },
        { from: "test", to: "env" },
        { from: "env", to: "build" },
        { from: "build", to: "env" },
      ],
    });
    const cycle = result.violations.find((v) => v.rule === "no-cycle");
    expect(cycle).toBeDefined();
  });

  it("detectGraphCycle 单独可用", () => {
    expect(
      detectGraphCycle({
        stages: ["a" as never, "b" as never],
        edges: [],
      }),
    ).toBeNull();
  });
});
