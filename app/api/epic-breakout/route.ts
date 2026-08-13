import { NextResponse } from "next/server";
import { renderPromptTemplate } from "@/lib/prompt-template";
import { authenticatedUser } from "@/lib/server-auth";
import { loadRefinementPromptContext, serializeRepositories } from "@/lib/server-prompt-context";

type Body = { epicId: string; domain: string };

export async function POST(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Body;
  if (!body.epicId) return NextResponse.json({ error: "A confirmed Epic is required." }, { status: 400 });

  try {
    const context = await loadRefinementPromptContext(user.id);
    const { data: epic, error: epicError } = await context.admin.from("tickets").select("*")
      .eq("id", body.epicId).eq("user_id", user.id).eq("item_type", "Epic").single();
    if (epicError) throw epicError;
    const repository = serializeRepositories(context.repositories).find((item) => item.id === epic.repository_id);
    if (!repository) return NextResponse.json({ error: "The Epic must use a repository available to the refinement agent." }, { status: 400 });
    const prompt = renderPromptTemplate(context.agent.epic_breakout_prompt, {
      ticket: epic, domain: body.domain, requesterEmail: user.email ?? "Requesting user",
      agentName: context.agent.name, workspaceInstructions: context.masterInstructions, repository,
    });
    const { data: run, error } = await context.admin.from("agent_runs").insert({
      user_id: user.id, ticket_id: epic.id, column_name: "In Refinement",
      agent_name: context.agent.name, model_name: context.agent.model_name,
      rendered_prompt: prompt, trigger_type: "manual", status: "queued",
      run_kind: "epic_breakout", queue_class: "interactive",
      run_input: { repositoryId: repository.id, domain: body.domain },
    }).select("id").single();
    if (error) throw error;
    return NextResponse.json({ runId: run.id }, { status: 202 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The breakout run could not be queued.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
