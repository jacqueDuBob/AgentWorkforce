import { NextResponse } from "next/server";
import { authenticateWorker } from "@/lib/worker-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { renderPromptTemplate } from "@/lib/prompt-template";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const worker = await authenticateWorker(request);
    if (!worker) return NextResponse.json({ error: "Invalid worker token." }, { status: 401 });
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as {
      finalResponse?: string; result?: Record<string, unknown>; threadId?: string; error?: string; gitPushSucceeded?: boolean;
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

    if (!body.error && body.gitPushSucceeded) {
      const { data: sourceRun, error: sourceRunError } = await admin.from("agent_runs")
        .select("ticket_id,column_name,user_id").eq("id", id).eq("user_id", worker.user_id).single();
      if (sourceRunError) throw sourceRunError;
      if (sourceRun.column_name === "In Work") {
        const [{ data: ticket, error: ticketError }, { data: agent, error: agentError }, { data: settings }] = await Promise.all([
          admin.from("tickets").select("*").eq("id", sourceRun.ticket_id).eq("user_id", worker.user_id).single(),
          admin.from("column_agents").select("*").eq("column_name", "In Deployment").maybeSingle(),
          admin.from("workspace_settings").select("master_instructions").eq("user_id", worker.user_id).maybeSingle(),
        ]);
        if (ticketError) throw ticketError;
        if (agentError) throw agentError;
        if (agent?.enabled && agent.start_mode === "automatic") {
          let repository = null;
          if (ticket.repository_id) {
            const { data, error: repositoryError } = await admin.from("github_repositories").select("id,owner,name,default_branch")
              .eq("id", ticket.repository_id).eq("user_id", worker.user_id).single();
            if (repositoryError) throw repositoryError;
            repository = data;
          }
          const renderedPrompt = renderPromptTemplate(agent.instructions, {
            ticket, repository, workspaceInstructions: settings?.master_instructions ?? "",
            runContext: { trigger: "post_push", queuedColumn: "In Deployment" },
          });
          const { error: queueError } = await admin.from("agent_runs").insert({
            user_id: worker.user_id, ticket_id: ticket.id, column_name: "In Deployment",
            agent_name: agent.name, model_name: agent.model_name, rendered_prompt: renderedPrompt,
            trigger_type: "automatic", status: "queued", run_kind: "column", queue_class: "background",
            run_input: { trigger: "post_push" },
          });
          if (queueError) throw queueError;
        }
      }
    }
    return NextResponse.json({ ok: true });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not finish the run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
