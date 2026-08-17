import { NextResponse } from "next/server";
import { authenticateWorker } from "@/lib/worker-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { parseRepositoryCandidate } from "@/shared/job-contract.mjs";

export const runtime = "nodejs";
const candidateEnvelope = (row: Record<string, unknown>) => ({
  id: String(row.id), version: Number(row.candidate_version), repositoryId: String(row.repository_id), branch: String(row.branch),
  baseRef: String(row.base_ref), baseSha: String(row.base_sha), candidateSha: String(row.candidate_sha),
  changedFiles: Array.isArray(row.changed_files) ? row.changed_files : [], published: Boolean(row.published),
  remoteRef: row.remote_ref ? String(row.remote_ref) : undefined, sourceJobId: String(row.source_job_id),
  sourceAttemptId: String(row.source_attempt_id), predecessorCandidateId: row.predecessor_candidate_id ? String(row.predecessor_candidate_id) : null,
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const worker = await authenticateWorker(request);
    if (!worker) return NextResponse.json({ error: "Invalid worker token." }, { status: 401 });
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { attemptId?: string; candidate?: unknown };
    if (!body.attemptId) return NextResponse.json({ error: "attemptId is required." }, { status: 400 });
    const candidate = parseRepositoryCandidate(body.candidate);
    const { data, error } = await getSupabaseAdmin().rpc("publish_repository_candidate", {
      requested_worker_id: worker.id, requested_run_id: id, requested_attempt_id: body.attemptId, requested_candidate: candidate,
    });
    if (error) {
      const stale = /stale|current candidate|head changed|already published/i.test(error.message);
      return NextResponse.json({ error: error.message }, { status: stale ? 409 : 400 });
    }
    return NextResponse.json({ candidate: candidateEnvelope(data as Record<string, unknown>) });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Candidate publication failed." }, { status: 400 });
  }
}
