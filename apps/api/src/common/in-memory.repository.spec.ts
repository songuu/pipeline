import { describe, expect, it } from "vitest";
import { deploymentStorageCollections, supabaseStorageTargetForCollection } from "./in-memory.repository";

describe("deployment storage domain table mapping", () => {
  it("maps every repository collection to a dedicated Supabase table", () => {
    const domains = deploymentStorageCollections();
    const collections = domains.map((domain) => domain.collection);
    const tables = domains.map((domain) => domain.tableName);

    expect(collections).toContain("code-repositories");
    expect(collections).toContain("release-events");
    expect(tables).toContain("dm_source_repositories");
    expect(tables).toContain("dm_release_events");
    expect(new Set(collections).size).toBe(collections.length);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it("rejects unmapped Supabase collections instead of writing to a catch-all table", () => {
    expect(() => supabaseStorageTargetForCollection("unknown-collection")).toThrow(
      /not mapped to a domain table/,
    );
  });
});
