import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { verifyGitHubWebhookSignature } from "@/lib/providers/github/webhooks";

describe("verifyGitHubWebhookSignature", () => {
  test("accepts valid signature", () => {
    const payload = JSON.stringify({ event: "workflow_run" });
    const secret = "top-secret";
    const sig = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

    expect(verifyGitHubWebhookSignature(payload, sig, secret)).toBe(true);
  });

  test("rejects invalid signature", () => {
    const payload = JSON.stringify({ event: "workflow_run" });
    expect(verifyGitHubWebhookSignature(payload, "sha256=invalid", "top-secret")).toBe(false);
  });

  test("rejects missing header", () => {
    const payload = JSON.stringify({ event: "workflow_run" });
    expect(verifyGitHubWebhookSignature(payload, null, "top-secret")).toBe(false);
  });
});
