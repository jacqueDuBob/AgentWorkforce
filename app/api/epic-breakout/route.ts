import { NextResponse } from "next/server";
import { authenticatedUser } from "@/lib/server-auth";
import { queueEpicBreakoutJob } from "@/lib/server-job-queue";

type Body = { epicId: string; domain: string };

export async function POST(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Body;
  if (!body.epicId) return NextResponse.json({ error: "A confirmed Epic is required." }, { status: 400 });

  try {
    const runId = await queueEpicBreakoutJob(user.id, body.epicId, body.domain, user.email ?? "Requesting user");
    return NextResponse.json({ runId }, { status: 202 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The breakout run could not be queued.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
