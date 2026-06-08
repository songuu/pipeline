import { z } from "zod";

/**
 * DORA 查询边界校验（zod 放 apps/api 边界层，业务类型在 shared）。
 * query 参数都是字符串，window 用 coerce 转正整数。
 */
export const doraQuerySchema = z.object({
  window: z.coerce.number().int().min(1).max(365).default(7),
  environment: z.enum(["dev", "test", "staging", "prod"]).optional(),
  applicationId: z.string().trim().min(1).max(120).optional(),
});

export type DoraQueryDto = z.infer<typeof doraQuerySchema>;
