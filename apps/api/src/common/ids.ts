import { randomBytes } from "node:crypto";

export function createStableId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(6).toString("hex");
  return `${prefix}-${timestamp}-${random}`;
}
