import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationMessage } from "@deploy-management/shared";
import { SecretResolverService } from "../../security/secret-resolver.service";
import { hmacHex, signDingtalk } from "../signing";
import { DingtalkNotifier } from "./dingtalk.notifier";
import { WebhookNotifier } from "./webhook.notifier";
import { WecomNotifier } from "./wecom.notifier";

const ENV_KEYS = [
  "DINGTALK_NOTIFY_WEBHOOK",
  "DINGTALK_NOTIFY_SECRET",
  "WECOM_NOTIFY_WEBHOOK",
  "WEBHOOK_NOTIFY_URL",
  "WEBHOOK_NOTIFY_SECRET",
];

const message: NotificationMessage = {
  event: "deploy_failed",
  title: "上线失败",
  text: "制品上线失败：构建超时",
  link: "https://songuu.top/runs/run-1",
  context: { applicationName: "demo", environment: "prod", actor: "RO" },
};

const okJson = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload }) as unknown as Response;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("signing", () => {
  it("signDingtalk 与独立 HMAC-SHA256 对拍，timestamp 固定可复现", () => {
    const secret = "SEC_test";
    const ts = 1_700_000_000_000;
    const expected = encodeURIComponent(createHmac("sha256", secret).update(`${ts}\n${secret}`, "utf8").digest("base64"));
    expect(signDingtalk(secret, ts)).toEqual({ timestamp: ts, sign: expected });
  });

  it("hmacHex 与独立计算一致", () => {
    expect(hmacHex("k", "payload")).toBe(createHmac("sha256", "k").update("payload", "utf8").digest("hex"));
  });
});

describe("DingtalkNotifier", () => {
  it("未配置 webhook → skipped，不发请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const notifier = new DingtalkNotifier(new SecretResolverService());
    expect(notifier.isConfigured()).toBe(false);
    expect(await notifier.send(message)).toMatchObject({ channel: "dingtalk", status: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("配置后发 markdown，errcode=0 → sent；无 secret 不带 sign", async () => {
    process.env.DINGTALK_NOTIFY_WEBHOOK = "https://oapi.dingtalk.com/robot/send?access_token=tok";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okJson({ errcode: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new DingtalkNotifier(new SecretResolverService()).send(message);
    expect(result).toMatchObject({ channel: "dingtalk", status: "sent" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).not.toContain("sign=");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.msgtype).toBe("markdown");
    expect(body.markdown.title).toBe("上线失败");
  });

  it("有 secret → URL 带 timestamp+sign", async () => {
    process.env.DINGTALK_NOTIFY_WEBHOOK = "https://oapi.dingtalk.com/robot/send?access_token=tok";
    process.env.DINGTALK_NOTIFY_SECRET = "SEC_test";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okJson({ errcode: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    await new DingtalkNotifier(new SecretResolverService()).send(message);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("timestamp=");
    expect(url).toContain("sign=");
  });

  it("errcode≠0 → failed", async () => {
    process.env.DINGTALK_NOTIFY_WEBHOOK = "https://oapi.dingtalk.com/robot/send?access_token=tok";
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ errcode: 310000, errmsg: "keywords not in content" })));
    const result = await new DingtalkNotifier(new SecretResolverService()).send(message);
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("310000");
  });

  it("fetch 抛错 → failed（不抛出）", async () => {
    process.env.DINGTALK_NOTIFY_WEBHOOK = "https://oapi.dingtalk.com/robot/send?access_token=tok";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ETIMEDOUT"); }));
    const result = await new DingtalkNotifier(new SecretResolverService()).send(message);
    expect(result).toMatchObject({ channel: "dingtalk", status: "failed" });
    expect(result.detail).toContain("ETIMEDOUT");
  });
});

describe("WecomNotifier", () => {
  it("errcode=0 → sent，body 为 markdown content", async () => {
    process.env.WECOM_NOTIFY_WEBHOOK = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okJson({ errcode: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new WecomNotifier(new SecretResolverService()).send(message);
    expect(result.status).toBe("sent");
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.msgtype).toBe("markdown");
    expect(body.markdown.content).toContain("上线失败");
  });
});

describe("WebhookNotifier", () => {
  it("2xx → sent；有 secret 时带 X-Signature", async () => {
    process.env.WEBHOOK_NOTIFY_URL = "https://example.com/hook";
    process.env.WEBHOOK_NOTIFY_SECRET = "shh";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200 }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const result = await new WebhookNotifier(new SecretResolverService()).send(message);
    expect(result.status).toBe("sent");
    const init = fetchMock.mock.calls[0]![1];
    const sig = (init.headers as Record<string, string>)["X-Signature"];
    expect(sig).toBe(`sha256=${hmacHex("shh", init.body as string)}`);
  });

  it("非 2xx → failed", async () => {
    process.env.WEBHOOK_NOTIFY_URL = "https://example.com/hook";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response));
    const result = await new WebhookNotifier(new SecretResolverService()).send(message);
    expect(result).toMatchObject({ status: "failed", detail: "http=500" });
  });
});
