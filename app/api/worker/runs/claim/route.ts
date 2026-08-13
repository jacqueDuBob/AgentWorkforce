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

    const [{ data: ticket, error: ticketError }, { data: agent, error: agentError }, { data: settings }] = await Promise.all([
      admin.from("tickets").select("*").eq("id", run.ticket_id).eq("user_id", worker.user_id).single(),
      admin.from("column_agents").select("*").eq("user_id", worker.user_id).eq("column_name", run.column_name).single(),
      admin.from("workspace_settings").select("master_instructions").eq("user_id", worker.user_id).maybeSingle(),
    ]);
    if (ticketError || agentError) throw ticketError ?? agentError;

    let repository = null;
    if (ticket.repository_id) {
      const { data, error } = await admin.from("github_repositories").select("*")
        .eq("id", ticket.repository_id).eq("user_id", worker.user_id).single();
      if (error) throw error;
      repository = data;
    }

    return NextResponse.json({
      run: { id: run.id, modelName: run.model_name, column: run.column_name, agentName: run.agent_name, input: run.output },
      ticket: {
        id: ticket.id, title: ticket.title, description: ticket.description,
        acceptanceCriteria: ticket.acceptance_criteria_items, priority: ticket.priority,
        tags: ticket.tags, status: ticket.status, baseBranch: ticket.base_branch,
      },
      agent: { instructions: agent.instructions },
      repository: repository && { owner: repository.owner, name: repository.name, defaultBranch: repository.default_branch },
      masterInstructions: settings?.master_instructions ?? "",
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not claim a run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
