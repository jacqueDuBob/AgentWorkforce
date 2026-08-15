import { NextResponse } from "next/server";
import { authenticateWorker } from "@/lib/worker-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const worker = await authenticateWorker(request);
    if (!worker) return NextResponse.json({ error: "Invalid worker token." }, { status: 401 });
    const admin = getSupabaseAdmin();
    const { data: run, error: claimError } = await admin
      .rpc("claim_next_agent_run_for_worker", { requested_worker_id: worker.id });
    if (claimError) throw claimError;
    if (!run?.id) return new NextResponse(null, { status: 204 });

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

    const resumeContext = Array.isArray(run.resume_context) ? run.resume_context : [];
    const renderedPrompt = resumeContext.length
      ? `${run.rendered_prompt}\n\nResolved agent questions (use these answers to continue the work):\n${JSON.stringify(resumeContext)}`
      : run.rendered_prompt;
    return NextResponse.json({
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
