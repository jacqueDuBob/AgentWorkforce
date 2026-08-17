import { NextResponse } from "next/server";
import { authenticateWorker } from "@/lib/worker-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const worker = await authenticateWorker(request);
    if (!worker) return NextResponse.json({ error: "Invalid worker token." }, { status: 401 });
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { attemptId?: string; progress?: unknown };
    if (!body.attemptId || typeof body.attemptId !== "string") return NextResponse.json({ error: "attemptId is required." }, { status: 400 });
    const progress = body.progress && typeof body.progress === "object" && !Array.isArray(body.progress) ? body.progress : null;
    const { data, error } = await getSupabaseAdmin().rpc("heartbeat_agent_run_attempt", {
      requested_worker_id: worker.id, requested_run_id: id, requested_attempt_id: body.attemptId,
      requested_progress: progress, requested_lease_seconds: 90,
    });
    if (error) throw error;
    if (!data?.id) return NextResponse.json({ error: "Attempt is stale or no longer owned by this worker." }, { status: 409 });
    return NextResponse.json({ ok: true, leaseUntil: data.lease_until });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Could not heartbeat the run." }, { status: 500 });
  }
}
