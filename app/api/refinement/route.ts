import { NextResponse } from "next/server";
import type { RefinementAnswer } from "@/lib/refinement-types";
import { authenticatedUser } from "@/lib/server-auth";
import { queueRefinementJob } from "@/lib/server-job-queue";

interface RefinementRequest {
  action?: "questions" | "rewrite";
  ticketId: string;
  repositoryId?: string;
  answers?: RefinementAnswer[];
  proposal?: Record<string, unknown>;
}

export async function POST(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  let body: RefinementRequest;
  try { body = await request.json() as RefinementRequest; }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body.ticketId) return NextResponse.json({ error: "A ticket is required." }, { status: 400 });

  const rewriting = body.action === "rewrite";
  if (rewriting && (!Array.isArray(body.answers) || body.answers.some((answer) => !answer.answer?.trim()))) {
    return NextResponse.json({ error: "Complete refinement answers are required." }, { status: 400 });
  }

  try {
    const runId = await queueRefinementJob(user.id, {
      ticketId: body.ticketId, repositoryId: body.repositoryId,
      action: rewriting ? "rewrite" : "questions", answers: body.answers, proposal: body.proposal,
    });
    return NextResponse.json({ runId }, { status: 202 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The refinement run could not be queued.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
