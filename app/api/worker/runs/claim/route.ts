import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { authenticateWorker } from "@/lib/worker-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { parseJobSpec } from "@/shared/job-contract.mjs";
import { parseWorkerCapabilities } from "@/scripts/runner/worker-capabilities.mjs";
import { dispatchRunnerOutbox } from "@/lib/server-job-queue";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const worker = await authenticateWorker(request);
    if (!worker) return NextResponse.json({ error: "Invalid worker token." }, { status: 401 });
    const admin = getSupabaseAdmin();
    await dispatchRunnerOutbox();
    const body = await request.json().catch(() => ({})) as { capabilities?: unknown };
    if (body.capabilities === undefined) return NextResponse.json({ error: "This worker is too old for leased execution; upgrade the Runner worker." }, { status: 426 });
    const capabilities = parseWorkerCapabilities(body.capabilities);
    const { data: claimed, error: claimError } = await admin
      .rpc("claim_next_agent_run_for_worker", { requested_worker_id: worker.id, advertised_capabilities: capabilities, requested_lease_seconds: 90 });
    if (claimError) throw claimError;
    const run = claimed?.run;
    const attempt = claimed?.attempt;
    if (!run?.id) return new NextResponse(null, { status: 204 });

    const { data: continuationRow, error: continuationError } = await admin.from("agent_run_continuations").select("id,context")
      .eq("job_id", run.id).is("claimed_attempt_id", null).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (continuationError && !["42P01", "PGRST205"].includes(continuationError.code ?? "")) throw continuationError;
    const continuation = continuationRow?.context ?? null;
    if (continuationRow) {
      const { error } = await admin.from("agent_run_continuations").update({ claimed_attempt_id: attempt.id }).eq("id", continuationRow.id).is("claimed_attempt_id", null);
      if (error) throw error;
    }
    let repositoryCandidate = null;
    const { data: candidateRow, error: candidateError } = await admin.rpc("assign_repository_candidate_to_attempt", {
      requested_worker_id: worker.id, requested_run_id: run.id, requested_attempt_id: attempt.id,
    });
    if (candidateError && !["42883", "PGRST202"].includes(candidateError.code ?? "")) throw candidateError;
    if (candidateRow?.id) repositoryCandidate = {
      id: candidateRow.id, version: candidateRow.candidate_version, repositoryId: candidateRow.repository_id,
      branch: candidateRow.branch, baseRef: candidateRow.base_ref, baseSha: candidateRow.base_sha, candidateSha: candidateRow.candidate_sha,
      changedFiles: candidateRow.changed_files, published: candidateRow.published, remoteRef: candidateRow.remote_ref,
      sourceJobId: candidateRow.source_job_id, sourceAttemptId: candidateRow.source_attempt_id, predecessorCandidateId: candidateRow.predecessor_candidate_id,
    };
    const runType = run.job_type ?? (run.column_name === "In Review" ? "review" : run.column_name === "In Testing" ? "testing" : run.column_name === "In Work" ? "development" : "column");
    if (["review","testing"].includes(runType) && !repositoryCandidate) {
      const completionId = randomUUID(); const message = `The ${runType} job has no durable repository candidate.`;
      const { error } = await admin.rpc("finalize_agent_run_attempt", {
        requested_worker_id: worker.id, requested_run_id: run.id, requested_attempt_id: attempt.id, requested_completion_id: completionId,
        requested_payload_hash: createHash("sha256").update(message).digest("hex"), requested_output: null, requested_error: message,
        requested_result_version: null, requested_canonical_result: null, requested_failure_class: "configuration", requested_retryable: false,
        requested_questions: [], requested_proposals: [], requested_findings: null, requested_queue_deployment: false,
      });
      if (error) throw error;
      return NextResponse.json({ error: message }, { status: 422 });
    }
    if (run.job_spec) {
      let spec;
      try { spec = parseJobSpec(run.job_spec); }
      catch (cause) {
        const completionId = randomUUID();
        const message = cause instanceof Error ? cause.message : "Persisted JobSpec is invalid.";
        const payloadHash = createHash("sha256").update(JSON.stringify({ completionId, message })).digest("hex");
        const { error: finalizeError } = await admin.rpc("finalize_agent_run_attempt", {
          requested_worker_id: worker.id, requested_run_id: run.id, requested_attempt_id: attempt.id,
          requested_completion_id: completionId, requested_payload_hash: payloadHash, requested_output: null,
          requested_error: message, requested_result_version: null, requested_canonical_result: null,
          requested_failure_class: "contract", requested_retryable: false, requested_questions: [], requested_proposals: [],
          requested_findings: null, requested_queue_deployment: false,
        });
        if (finalizeError) throw finalizeError;
        return NextResponse.json({ error: `Queued JobSpec contract failure: ${message}` }, { status: 422 });
      }
      return NextResponse.json({
        jobSpec: spec,
        attempt: { id: attempt.id, number: attempt.attempt_number, leaseUntil: attempt.lease_until },
        continuation, repositoryCandidate,
        run: { id: spec.id, modelName: spec.agent.model, column: run.column_name, agentName: spec.agent.name, kind: run.run_kind || "column", input: spec.input, renderedPrompt: spec.prompt },
        ticket: spec.ticket,
        repository: spec.repository,
      });
    }

    const { data: ticket, error: ticketError } = await admin.from("tickets").select("*")
      .eq("id", run.ticket_id).eq("user_id", worker.user_id).single();
    if (ticketError) throw ticketError;

    let repository = null;
    const repositoryId = run.run_input?.repositoryId || ticket.repository_id;
    if (repositoryId) {
      const { data, error } = await admin.from("github_repositories").select("*")
        .eq("id", repositoryId).eq("user_id", worker.user_id).single();
      if (error) throw error;
      repository = data;
    }

    const renderedPrompt = run.rendered_prompt;
    return NextResponse.json({
      jobSpec: null,
      attempt: { id: attempt.id, number: attempt.attempt_number, leaseUntil: attempt.lease_until },
      continuation, repositoryCandidate,
      run: { id: run.id, modelName: run.model_name, column: run.column_name, agentName: run.agent_name, kind: run.run_kind || "column", input: run.run_input, renderedPrompt },
      ticket: {
        id: ticket.id, title: ticket.title, description: ticket.description, findings: ticket.findings ?? "",
        acceptanceCriteria: ticket.acceptance_criteria_items, priority: ticket.priority,
        tags: ticket.tags, status: ticket.status, baseBranch: ticket.base_branch,
      },
      repository: repository && { owner: repository.owner, name: repository.name, defaultBranch: repository.default_branch },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not claim a run.";
    const status = /capabilit|JobSpec|unsupported|invalid/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
