import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("../../../globals.css", import.meta.url), "utf8");
const flowCanvasSource = readFileSync(new URL("../../graph/pipeline-flow-canvas.tsx", import.meta.url), "utf8");

describe("TektonTaskRunPanel layout styles", () => {
  it("keeps step rows, result rows, and log lines inside the right run panel", () => {
    expect(stylesheet).toMatch(/\.run-log-panel\s*{[^}]*min-width:\s*0;[^}]*overflow:\s*visible;/s);
    expect(stylesheet).toMatch(/\.codeup-shell \.run-log-panel\s*{[^}]*border-color:\s*rgba\(125,\s*197,\s*255,\s*0\.22\);/s);
    expect(stylesheet).toMatch(
      /\.step-line\s*{[^}]*min-width:\s*0;[^}]*grid-template-columns:\s*minmax\(0,\s*0\.8fr\) minmax\(0,\s*1fr\) max-content;/s,
    );
    expect(stylesheet).toMatch(/\.step-line > \*\s*{[^}]*min-width:\s*0;/s);
    expect(stylesheet).toMatch(/\.log-lines code\s*{[^}]*overflow-wrap:\s*anywhere;/s);
    expect(stylesheet).toMatch(/\.task-result-lines span\s*{[^}]*min-width:\s*0;[^}]*width:\s*100%;/s);
    expect(stylesheet).toMatch(/\.task-result-lines span > \*\s*{[^}]*min-width:\s*0;/s);
  });

  it("keeps the DAG canvas themed in the Codeup shell instead of falling back to a light board", () => {
    expect(stylesheet).toMatch(/\.codeup-shell \.pipeline-flow-shell\s*{[^}]*--pipeline-flow-background:/s);
    expect(stylesheet).toMatch(/\.codeup-shell \.pipeline-flow-shell\s*{[^}]*--pipeline-flow-border:/s);
    expect(stylesheet).toMatch(/\.codeup-shell \.pipeline-flow-shell\s*{[^}]*--pipeline-flow-dot:/s);
    expect(flowCanvasSource).toContain("var(--pipeline-flow-background");
    expect(flowCanvasSource).toContain("var(--pipeline-flow-border");
    expect(flowCanvasSource).toContain("var(--pipeline-flow-dot");
  });

  it("prevents the execution process panel from collapsing into a single header strip", () => {
    expect(stylesheet).toMatch(/\.execution-process-panel\s*{[^}]*min-height:\s*180px;/s);
    expect(stylesheet).toMatch(/\.execution-process-panel\s*{[^}]*max-height:\s*340px;/s);
    expect(stylesheet).toMatch(
      /\.execution-process-panel\s*{[^}]*grid-template-rows:\s*auto minmax\(86px,\s*auto\) minmax\(0,\s*1fr\);/s,
    );
    expect(stylesheet).toMatch(/\.execution-process-panel\s*{[^}]*overflow:\s*hidden;/s);
    expect(stylesheet).toMatch(/\.execution-script-card\s*{[^}]*min-height:\s*96px;/s);
    expect(stylesheet).toMatch(/\.execution-script-card pre\s*{[^}]*min-height:\s*48px;/s);
    expect(stylesheet).toMatch(/\.execution-script-card pre\s*{[^}]*max-height:\s*96px;/s);
    expect(stylesheet).toMatch(/\.execution-command-list\s*{[^}]*max-height:\s*160px;[^}]*overflow:\s*auto;/s);
  });
});
