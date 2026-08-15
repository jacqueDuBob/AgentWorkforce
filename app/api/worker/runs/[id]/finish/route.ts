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
    const { data: sourceRun, error: sourceRunError } = await admin.from("agent_runs")
      .select("ticket_id,column_name,user_id").eq("id", id).eq("user_id", worker.user_id).eq("worker_id", worker.id).eq("status", "in_progress").maybeSingle();
    if (sourceRunError) throw sourceRunError;
    if (!sourceRun) return NextResponse.json({ error: "Active run not found." }, { status: 404 });

    const reviewFindings = !body.error && sourceRun.column_name === "In Review"
      ? Array.isArray(body.result?.findings)
        ? body.result.findings.filter((finding): finding is string => typeof finding === "string" && Boolean(finding.trim())).map((finding) => finding.trim())
        : null
      : undefined;
    if (reviewFindings === null) return NextResponse.json({ error: "The review result did not include a findings array." }, { status: 400 });
    if (reviewFindings?.length && body.gitPushSucceeded) return NextResponse.json({ error: "A review with findings cannot report a successful git push." }, { status: 400 });
    if (reviewFindings && !reviewFindings.length && !body.gitPushSucceeded) return NextResponse.json({ error: "A clean review must commit and push before it can finish successfully." }, { status: 400 });

    const questions = !body.error && Array.isArray(body.result?.questions)
      ? body.result.questions.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim()).filter((item) => item.length <= 2000).slice(0, 10)
      : [];
    const proposals = !body.error && Array.isArray(body.result?.proposals)
      ? body.result.proposals.filter((item): item is { title: string; description: string; changes: Record<string, unknown> } => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).title === "string" && Boolean(((item as Record<string, unknown>).title as string).trim()) && typeof (item as Record<string, unknown>).description === "string" && (item as Record<string, unknown>).changes && typeof (item as Record<string, unknown>).changes === "object" && !Array.isArray((item as Record<string, unknown>).changes))).slice(0, 10) : [];
    const waiting = questions.length > 0;

    // Persist collaboration records before releasing the run. If the run update
    // fails, remove these records so a retry cannot leave an unowned question or
    // proposal behind.
    let insertedProposals = false;
    try {
      if (waiting) {
        const { error: questionError } = await admin.from("agent_questions").insert(questions.map((question) => ({ ticket_id: sourceRun.ticket_id, run_id: id, question })));
        if (questionError) throw questionError;
      }
      if (proposals.length) {
        const supportedChanges = new Set(["title", "description", "priority", "tags", "assignee"]);
        const { error: proposalError } = await admin.from("ticket_proposals").insert(proposals.map((proposal) => ({
          ticket_id: sourceRun.ticket_id, run_id: id, title: proposal.title.trim(), description: proposal.description.trim(),
          changes: Object.fromEntries(Object.entries(proposal.changes).filter(([key, value]) => supportedChanges.has(key) && value !== null)),
        })));
        if (proposalError) throw proposalError;
        insertedProposals = true;
      }
    } catch (cause) {
      await admin.from("agent_questions").delete().eq("run_id", id);
      await admin.from("ticket_proposals").delete().eq("run_id", id);
      throw cause;
    }

    const { data, error } = await admin.from("agent_runs").update({
      status: waiting ? "waiting_for_answer" : "finished", finished_at: waiting ? null : new Date().toISOString(), updated_at: new Date().toISOString(),
      codex_thread_id: body.threadId || null,
      output: body.result ? { result: body.result, threadId: body.threadId || null }
        : body.finalResponse ? { finalResponse: body.finalResponse, threadId: body.threadId || null } : undefined,
      error: body.error || null,
    }).eq("id", id).eq("user_id", worker.user_id).eq("worker_id", worker.id).eq("status", "in_progress").select("id").maybeSingle();
    if (error || !data) {
      await admin.from("agent_questions").delete().eq("run_id", id);
      await admin.from("ticket_proposals").delete().eq("run_id", id);
      if (error) throw error;
      return NextResponse.json({ error: "Active run not found." }, { status: 404 });
    }

    if (waiting) {
      await admin.rpc("notify_ticket_participants", { candidate_ticket_id: sourceRun.ticket_id, notification_kind: "question", notification_title: "Agent question needs an answer", notification_body: questions[0] });
    }
    if (insertedProposals) {
      await admin.rpc("notify_ticket_participants", { candidate_ticket_id: sourceRun.ticket_id, notification_kind: "proposal", notification_title: "Approval needed for a proposed update", notification_body: proposals[0].title });
    }
    if (!waiting) {
      await admin.rpc("notify_ticket_participants", { candidate_ticket_id: sourceRun.ticket_id, notification_kind: "execution", notification_title: body.error ? "Agent run failed" : "Agent run completed", notification_body: body.error || "The agent finished processing this ticket." });
    }

    if (reviewFindings) {
      const { error: findingsError } = await admin.from("tickets").update({
        findings: reviewFindings.map((finding) => `- ${finding}`).join("\n"), updated_at: new Date().toISOString(),
      }).eq("id", sourceRun.ticket_id).eq("user_id", worker.user_id);
      if (findingsError) throw findingsError;
    }

    if (!body.error && body.gitPushSucceeded) {
      if (sourceRun.column_name === "In Review") {
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
