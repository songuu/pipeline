import { createHmac } from "node:crypto";

/**
 * 钉钉群机器人加签：stringToSign = `${timestamp}\n${secret}`，
 * HMAC-SHA256 → base64 → urlencode。返回拼接用的 { timestamp, sign }。
 * 纯函数（timestamp 由调用方注入），便于单测对拍。
 */
export function signDingtalk(secret: string, timestamp: number): { timestamp: number; sign: string } {
  const stringToSign = `${timestamp}\n${secret}`;
  const digest = createHmac("sha256", secret).update(stringToSign, "utf8").digest("base64");
  return { timestamp, sign: encodeURIComponent(digest) };
}

/** 通用 webhook 签名：HMAC-SHA256(payload) 的 hex，用于 X-Signature: sha256=<hex>。 */
export function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}
