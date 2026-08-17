import { NextResponse } from "next/server";
import { authenticateWorker } from "@/lib/worker-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { parseJobSpec } from "@/shared/job-contract.mjs";
import { parseWorkerCapabilities } from "@/scripts/runner/worker-capabilities.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const worker = await authenticateWorker(request);
    if (!worker) return NextResponse.json({ error: "Invalid worker token." }, { status: 401 });
    const admin = getSupabaseAdmin();
    const body = await request.json().catch(() => ({})) as { capabilities?: unknown };
    const capabilities = body.capabilities === undefined
      ? { jobSpecVersions: [], jobTypes: [], agentAdapters: [], workspaceProviders: [], repositories: [], features: ["legacy_jobs"] }
      : parseWorkerCapabilities(body.capabilities);
    const { data: claimed, error: claimError } = await admin
      .rpc("claim_next_agent_run_for_worker", { requested_worker_id: worker.id, advertised_capabilities: capabilities, requested_lease_seconds: 90 });
    if (claimError) throw claimError;
    const run = claimed?.run;
    const attempt = claimed?.attempt;
    if (!run?.id) return new NextResponse(null, { status: 204 });

    const resumeContext = Array.isArray(run.resume_context) ? run.resume_context : [];
    if (run.job_spec) {
      const spec = parseJobSpec(run.job_spec);
      return NextResponse.json({
        jobSpec: spec,
        attempt: { id: attempt.id, number: attempt.attempt_number, leaseUntil: attempt.lease_until },
        resumeContext,
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

    const renderedPrompt = resumeContext.length
      ? `${run.rendered_prompt}\n\nResolved agent questions (use these answers to continue the work):\n${JSON.stringify(resumeContext)}`
      : run.rendered_prompt;
    return NextResponse.json({
      jobSpec: null,
      attempt: { id: attempt.id, number: attempt.attempt_number, leaseUntil: attempt.lease_until },
      resumeContext,
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
