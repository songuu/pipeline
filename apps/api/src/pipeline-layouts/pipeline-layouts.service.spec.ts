import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServiceUnavailableException, NotFoundException } from "@nestjs/common";
import { PipelineLayoutsRepository } from "./pipeline-layouts.repository";
import { PipelineLayoutsService } from "./pipeline-layouts.service";
import {
  pipelineGraphLayoutPayloadSchema,
  pipelineIdParamSchema,
  actorQuerySchema,
} from "./dto/graph-layout.dto";

describe("PipelineLayoutsService", () => {
  let originalStorage: string | undefined;
  let originalDataDir: string | undefined;
  let tempDir: string;
  let repository: PipelineLayoutsRepository;
  let service: PipelineLayoutsService;

  beforeEach(() => {
    originalStorage = process.env.DEPLOYMENT_STORAGE;
    originalDataDir = process.env.DEPLOYMENT_DATA_DIR;
    // Each test gets its own data dir so JsonRepositoryStore writes don't bleed.
    tempDir = mkdtempSync(join(tmpdir(), "pl-layouts-spec-"));
    process.env.DEPLOYMENT_DATA_DIR = tempDir;
    delete process.env.DEPLOYMENT_STORAGE;
    repository = new PipelineLayoutsRepository();
    service = new PipelineLayoutsService(repository);
  });

  afterEach(() => {
    if (originalStorage === undefined) delete process.env.DEPLOYMENT_STORAGE;
    else process.env.DEPLOYMENT_STORAGE = originalStorage;
    if (originalDataDir === undefined) delete process.env.DEPLOYMENT_DATA_DIR;
    else process.env.DEPLOYMENT_DATA_DIR = originalDataDir;
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("opt-in 关闭时所有方法 503", async () => {
    delete process.env.DEPLOYMENT_STORAGE;
    await expect(service.getLayout("pl-1", "alice")).rejects.toThrow(ServiceUnavailableException);
    await expect(
      service.upsertLayout("pl-1", "alice", { nodes: [], edges: [] }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it("opt-in 开启 + 无记录 → 404", async () => {
    process.env.DEPLOYMENT_STORAGE = "supabase";
    await expect(service.getLayout("pl-x", "bob")).rejects.toThrow(NotFoundException);
  });

  it("opt-in 开启 + upsert 创建 → get 返回", async () => {
    process.env.DEPLOYMENT_STORAGE = "supabase";
    const created = await service.upsertLayout("pl-1", "alice", { nodes: [], edges: [] });
    expect(created.pipeline_id).toBe("pl-1");
    expect(created.actor).toBe("alice");
    expect(created.version).toBe(1);
    const fetched = await service.getLayout("pl-1", "alice");
    expect(fetched.id).toBe(created.id);
  });

  it("upsert 已存在 → version 递增", async () => {
    process.env.DEPLOYMENT_STORAGE = "supabase";
    await service.upsertLayout("pl-1", "alice", { nodes: [], edges: [] });
    const second = await service.upsertLayout("pl-1", "alice", {
      nodes: [{ id: "stage:source", position: { x: 0, y: 0 } }],
      edges: [],
    });
    expect(second.version).toBe(2);
    expect(second.payload.nodes).toHaveLength(1);
  });
});

describe("pipeline-layouts zod schema", () => {
  it("拒绝超过 500 个节点", () => {
    const nodes = Array.from({ length: 501 }, (_, i) => ({
      id: `stage:n${i}`,
      position: { x: i, y: 0 },
    }));
    const result = pipelineGraphLayoutPayloadSchema.safeParse({ nodes, edges: [] });
    expect(result.success).toBe(false);
  });

  it("拒绝超过 2000 条边", () => {
    const edges = Array.from({ length: 2001 }, (_, i) => ({
      id: `e${i}`,
      source: `stage:a`,
      target: `stage:b`,
    }));
    const result = pipelineGraphLayoutPayloadSchema.safeParse({ nodes: [], edges });
    expect(result.success).toBe(false);
  });

  it("拒绝包含未知字段 (strict)", () => {
    const result = pipelineGraphLayoutPayloadSchema.safeParse({
      nodes: [],
      edges: [],
      maliciousField: "should not pass",
    } as never);
    expect(result.success).toBe(false);
  });

  it("拒绝畸形 pipeline_id", () => {
    expect(pipelineIdParamSchema.safeParse("ok-name_1.2").success).toBe(true);
    expect(pipelineIdParamSchema.safeParse("../../etc/passwd").success).toBe(false);
    expect(pipelineIdParamSchema.safeParse("' OR '1'='1").success).toBe(false);
  });

  it("拒绝畸形 actor", () => {
    expect(actorQuerySchema.safeParse("alice@example.com").success).toBe(true);
    expect(actorQuerySchema.safeParse("<script>").success).toBe(false);
  });

  it("zoom 在 [0.1, 4] 之外被拒绝", () => {
    const ok = pipelineGraphLayoutPayloadSchema.safeParse({
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1.5 },
    });
    expect(ok.success).toBe(true);
    const bad = pipelineGraphLayoutPayloadSchema.safeParse({
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 10 },
    });
    expect(bad.success).toBe(false);
  });
});
