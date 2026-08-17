import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticateWorker } from "@/lib/worker-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { dispatchRunnerOutbox } from "@/lib/server-job-queue";
import { parseJobResult, type JobResultV1 } from "@/shared/job-contract.mjs";

export const runtime = "nodejs";
const failureClasses = new Set(["contract","configuration","permission","provider","verification","infrastructure","timeout","cancellation"]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const worker = await authenticateWorker(request);
    if (!worker) return NextResponse.json({ error: "Invalid worker token." }, { status: 401 });
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as {
      attemptId?: string; completionId?: string; finalResponse?: string; result?: Record<string, unknown>; threadId?: string; error?: string;
      gitPushSucceeded?: boolean; resultVersion?: number; canonicalResult?: unknown; failureClass?: string; retryable?: boolean;
    };
    if (!body.attemptId || !body.completionId) return NextResponse.json({ error: "attemptId and completionId are required." }, { status: 400 });
    if (body.error && !failureClasses.has(body.failureClass ?? "")) return NextResponse.json({ error: "A structured failureClass is required." }, { status: 400 });
    const admin = getSupabaseAdmin();
    const { data: sourceRun, error: sourceError } = await admin.from("agent_runs").select("ticket_id,column_name,user_id,job_type,job_spec")
      .eq("id", id).eq("user_id", worker.user_id).maybeSingle();
    if (sourceError) throw sourceError;
    if (!sourceRun) return NextResponse.json({ error: "Run not found." }, { status: 404 });

    let canonicalResult: JobResultV1 | undefined;
    if (body.canonicalResult !== undefined) canonicalResult = parseJobResult(body.canonicalResult) as JobResultV1;
    if (canonicalResult && body.resultVersion !== undefined && body.resultVersion !== canonicalResult.version) return NextResponse.json({ error: "Canonical result version does not match its envelope." }, { status: 400 });
    if (canonicalResult && (canonicalResult.jobId !== id || sourceRun.job_type && canonicalResult.jobType !== sourceRun.job_type)) return NextResponse.json({ error: "Canonical result does not match the job." }, { status: 400 });
    if (canonicalResult?.outcome === "succeeded" && ["development","review","testing"].includes(canonicalResult.jobType)) {
      const { data: attempt, error: attemptError } = await admin.from("agent_run_attempts").select("repository_candidate_id").eq("id", body.attemptId).eq("run_id", id).single();
      if (attemptError) throw attemptError;
      const candidate = canonicalResult.git && typeof canonicalResult.git === "object" ? (canonicalResult.git as { candidate?: { id?: string; candidateSha?: string } }).candidate : undefined;
      if (!attempt.repository_candidate_id || candidate?.id !== attempt.repository_candidate_id) return NextResponse.json({ error: "Canonical result does not match the attempt's durable repository candidate." }, { status: 400 });
    }
    const result = canonicalResult?.result as Record<string, unknown> | undefined ?? body.result;
    const threadId = typeof canonicalResult?.agent === "object" ? String((canonicalResult.agent as { threadId?: unknown }).threadId ?? "") || body.threadId : body.threadId;
    const pushed = canonicalResult?.git ? Boolean((canonicalResult.git as { pushSucceeded?: unknown }).pushSucceeded) : Boolean(body.gitPushSucceeded);
    const isReview = sourceRun.job_type ? sourceRun.job_type === "review" : sourceRun.column_name === "In Review";
    const findings = !body.error && isReview && Array.isArray(result?.findings)
      ? result.findings.filter((x): x is string => typeof x === "string" && Boolean(x.trim())).map((x) => x.trim()) : isReview && !body.error ? null : undefined;
    if (findings === null) return NextResponse.json({ error: "The review result did not include a findings array." }, { status: 400 });
    if (findings && !findings.length && !pushed) return NextResponse.json({ error: "A clean review requires a published repository candidate." }, { status: 400 });
    const questions = canonicalResult?.outcome === "needs_input" ? canonicalResult.inputRequest : [];
    const proposals = !body.error && Array.isArray(result?.proposals) ? result.proposals.filter((item): item is { title: string; description: string; changes: Record<string, unknown> } => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const value = item as Record<string, unknown>;
      return typeof value.title === "string" && Boolean(value.title.trim()) && value.title.trim().length <= 200
        && typeof value.description === "string" && Boolean(value.changes && typeof value.changes === "object" && !Array.isArray(value.changes));
    }).map((proposal) => ({
      title: proposal.title.trim(), description: proposal.description.trim(),
      changes: Object.fromEntries(Object.entries(proposal.changes).filter(([key, value]) => ["title","description","priority","tags","assignee"].includes(key) && value !== null)),
    })).slice(0,10) : [];
    const output = result ? { result, threadId: threadId || null } : body.finalResponse ? { finalResponse: body.finalResponse, threadId: threadId || null } : null;
    const payloadHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const { data: finalized, error } = await admin.rpc("finalize_agent_run_attempt", {
      requested_worker_id: worker.id, requested_run_id: id, requested_attempt_id: body.attemptId,
      requested_completion_id: body.completionId, requested_payload_hash: payloadHash, requested_output: output,
      requested_error: body.error || null, requested_result_version: canonicalResult?.version ?? null,
      requested_canonical_result: canonicalResult ?? null, requested_failure_class: body.failureClass ?? null,
      requested_retryable: Boolean(body.retryable), requested_questions: questions, requested_proposals: proposals,
      requested_findings: findings ?? null, requested_queue_deployment: Boolean(!body.error && pushed && isReview && findings?.length === 0),
    });
    if (error) throw error;
    if (finalized?.state === "stale") return NextResponse.json({ error: "Attempt is stale or no longer owned by this worker." }, { status: 409 });
    if (finalized?.state === "conflict") return NextResponse.json({ error: "Attempt was completed with a different completion payload." }, { status: 409 });

    await dispatchRunnerOutbox();
    return NextResponse.json({ ok: true, duplicate: finalized?.state === "duplicate", retrying: Boolean(finalized?.retrying) });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Could not finish the run." }, { status: 500 });
  }
}
