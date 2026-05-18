import { z } from "zod";

const providerSchema = z.enum(["codeup", "github", "gitlab", "gitcode", "gitea"]);

export const resolveRepositorySchema = z.object({
  url: z.string().trim().min(1).max(2048),
  provider: providerSchema.optional(),
  accessToken: z.string().trim().max(4096).optional(),
});

export const remoteRepositoryRefsSchema = resolveRepositorySchema.extend({
  refType: z.enum(["branch", "tag"]),
  search: z.string().trim().max(120).optional(),
  page: z.number().int().min(1).max(1000).optional(),
  perPage: z.number().int().min(1).max(100).optional(),
});

export type ResolveRepositoryDto = z.infer<typeof resolveRepositorySchema>;
export type RemoteRepositoryRefsDto = z.infer<typeof remoteRepositoryRefsSchema>;
