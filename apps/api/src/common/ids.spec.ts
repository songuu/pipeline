import { describe, expect, it } from "vitest";
import { createStableId } from "./ids";

describe("createStableId", () => {
  it("attaches the provided prefix verbatim", () => {
    const id = createStableId("run");
    expect(id.startsWith("run-")).toBe(true);
  });

  it("preserves arbitrary prefixes including hyphens", () => {
    const id = createStableId("artifact-image");
    expect(id.startsWith("artifact-image-")).toBe(true);
  });

  it("yields unique ids across rapid sequential calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5_000; i += 1) {
      ids.add(createStableId("run"));
    }
    expect(ids.size).toBe(5_000);
  });

  it("encodes a base36 timestamp as the first segment after the prefix", () => {
    const id = createStableId("run");
    const segments = id.split("-");
    expect(segments[0]).toBe("run");
    const timestampSegment = segments[1];
    const decoded = Number.parseInt(timestampSegment, 36);
    expect(Number.isFinite(decoded)).toBe(true);
    expect(decoded).toBeGreaterThan(Date.now() - 5_000);
    expect(decoded).toBeLessThanOrEqual(Date.now() + 1_000);
  });

  it("appends a 12-char hex random suffix as the last segment", () => {
    const id = createStableId("run");
    const last = id.split("-").pop() ?? "";
    expect(last).toMatch(/^[0-9a-f]{12}$/);
  });

  it("ids generated within the same millisecond still differ via the random suffix", () => {
    const a = createStableId("run");
    const b = createStableId("run");
    expect(a).not.toBe(b);
  });
});
