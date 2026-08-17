import { NextResponse } from "next/server";
import { authenticatedUser } from "@/lib/server-auth";
import { queueColumnJob } from "@/lib/server-job-queue";

export async function POST(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { ticketId?: string; trigger?: string };
  if (!body.ticketId || !["manual", "automatic"].includes(body.trigger ?? "")) return NextResponse.json({ error: "A ticket and valid trigger are required." }, { status: 400 });
  try {
    const runId = await queueColumnJob(user.id, body.ticketId, body.trigger as "manual" | "automatic");
    return NextResponse.json({ runId }, { status: 202 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The agent run could not be queued.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
