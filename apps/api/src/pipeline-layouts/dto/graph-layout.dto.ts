import { z } from "zod";

const STAGE_ID_RE = /^[a-zA-Z0-9._:-]+$/;
const ACTOR_RE = /^[a-zA-Z0-9._@-]+$/;
const PIPELINE_ID_RE = /^[a-zA-Z0-9._-]+$/;

const nodePositionSchema = z
  .object({
    x: z.number().finite().min(-100000).max(100000),
    y: z.number().finite().min(-100000).max(100000),
  })
  .strict();

const nodeEntrySchema = z
  .object({
    id: z.string().min(1).max(128).regex(STAGE_ID_RE),
    position: nodePositionSchema,
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const edgeEntrySchema = z
  .object({
    id: z.string().min(1).max(128),
    source: z.string().min(1).max(128).regex(STAGE_ID_RE),
    target: z.string().min(1).max(128).regex(STAGE_ID_RE),
  })
  .strict();

const viewportSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().min(0.1).max(4),
  })
  .strict();

export const pipelineGraphLayoutPayloadSchema = z
  .object({
    nodes: z.array(nodeEntrySchema).max(500),
    edges: z.array(edgeEntrySchema).max(2000),
    viewport: viewportSchema.optional(),
  })
  .strict();

export const upsertPipelineGraphLayoutSchema = z
  .object({
    actor: z.string().min(1).max(128).regex(ACTOR_RE),
    payload: pipelineGraphLayoutPayloadSchema,
  })
  .strict();

export const pipelineIdParamSchema = z.string().min(1).max(128).regex(PIPELINE_ID_RE);
export const actorQuerySchema = z.string().min(1).max(128).regex(ACTOR_RE);

export type PipelineGraphLayoutPayload = z.infer<typeof pipelineGraphLayoutPayloadSchema>;
export type UpsertPipelineGraphLayoutRequest = z.infer<typeof upsertPipelineGraphLayoutSchema>;

export interface PipelineGraphLayoutRecord {
  id: string;
  pipeline_id: string;
  actor: string;
  payload: PipelineGraphLayoutPayload;
  version: number;
  created_at: string;
  updated_at: string;
}
