import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const releaseCommon = readFileSync(resolve(__dirname, "../../../scripts/lib/release-common.sh"), "utf8");

describe("release-common pm2 activation", () => {
  it("re-registers dm-api and dm-web against current instead of startOrReloading stale process metadata", () => {
    expect(releaseCommon).toContain("pm2 delete dm-api dm-web");
    expect(releaseCommon).toContain('pm2 start "$ecosystem" --only dm-api,dm-web --update-env');
    expect(releaseCommon).not.toContain('pm2 startOrReload "$ecosystem" --update-env');
  });

  it("does not start dm-tekton-bridge during local-docker current realignment", () => {
    const pm2StartLines = releaseCommon
      .split("\n")
      .filter((line) => line.includes("pm2 start "));

    expect(pm2StartLines.join("\n")).toContain("--only dm-api,dm-web");
    expect(pm2StartLines.join("\n")).not.toContain("dm-tekton-bridge");
  });
});
