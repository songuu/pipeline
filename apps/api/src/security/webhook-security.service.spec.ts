import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deliveryIdFromHeaders,
  triggerFromWebhookPayload,
  verifyWebhookSignature,
} from "./webhook-security.service";

describe("webhook security helpers", () => {
  it("verifies GitHub HMAC signatures from the raw body", () => {
    const rawBody = Buffer.from(JSON.stringify({ ref: "refs/heads/main" }));
    const secret = "test-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;

    expect(() => verifyWebhookSignature("github", { "x-hub-signature-256": signature }, rawBody, secret)).not.toThrow();
  });

  it("rejects invalid GitLab tokens", () => {
    expect(() => verifyWebhookSignature("gitlab", { "x-gitlab-token": "bad" }, Buffer.from("{}"), "good")).toThrow(
      /GitLab webhook token/,
    );
  });

  it("extracts branch, commit, and actor from push payloads", () => {
    const trigger = triggerFromWebhookPayload("github", {
      ref: "refs/heads/release/main",
      after: "c0ffee1234567890",
      sender: { login: "octo" },
    });

    expect(trigger).toMatchObject({
      refType: "branch",
      refName: "release/main",
      commitSha: "c0ffee1234567890",
      actor: "octo",
    });
  });

  it("falls back to a deterministic delivery id when provider headers are missing", () => {
    const rawBody = Buffer.from("{\"ref\":\"refs/heads/main\"}");

    expect(deliveryIdFromHeaders("generic", {}, rawBody)).toMatch(/^generic-[a-f0-9]{32}$/);
  });
});
