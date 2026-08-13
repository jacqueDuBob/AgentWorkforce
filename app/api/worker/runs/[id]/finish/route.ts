import { NextResponse } from "next/server";
import { authenticateWorker } from "@/lib/worker-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const worker = await authenticateWorker(request);
    if (!worker) return NextResponse.json({ error: "Invalid worker token." }, { status: 401 });
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as {
      finalResponse?: string; result?: Record<string, unknown>; threadId?: string; error?: string;
    };
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("agent_runs").update({
      status: "finished", finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      codex_thread_id: body.threadId || null,
      output: body.result ? { result: body.result, threadId: body.threadId || null }
        : body.finalResponse ? { finalResponse: body.finalResponse, threadId: body.threadId || null } : undefined,
      error: body.error || null,
    }).eq("id", id).eq("user_id", worker.user_id).eq("worker_id", worker.id).eq("status", "in_progress").select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Active run not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not finish the run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
