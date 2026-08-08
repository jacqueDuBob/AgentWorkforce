import { NextResponse } from "next/server";
import { getEnv } from "@/lib/server/env";
import { verifyGitHubWebhookSignature } from "@/lib/providers/github/webhooks";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const env = getEnv();
  const payload = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!env.GITHUB_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Webhook secret not configured." }, { status: 503 });
  }

  if (!verifyGitHubWebhookSignature(payload, signature, env.GITHUB_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
