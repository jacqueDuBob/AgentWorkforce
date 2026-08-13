import { NextResponse } from "next/server";
import type { RefinementAnswer } from "@/lib/refinement-types";
import { renderPromptTemplate } from "@/lib/prompt-template";
import { authenticatedUser } from "@/lib/server-auth";
import { loadRefinementPromptContext, serializeRepositories } from "@/lib/server-prompt-context";

interface RefinementRequest {
  action?: "questions" | "rewrite";
  ticketId: string;
  repositoryId?: string;
  answers?: RefinementAnswer[];
  proposal?: Record<string, unknown>;
}

export async function POST(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  let body: RefinementRequest;
  try { body = await request.json() as RefinementRequest; }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body.ticketId) return NextResponse.json({ error: "A ticket is required." }, { status: 400 });

  const rewriting = body.action === "rewrite";
  if (rewriting && (!Array.isArray(body.answers) || body.answers.some((answer) => !answer.answer?.trim()))) {
    return NextResponse.json({ error: "Complete refinement answers are required." }, { status: 400 });
  }

  try {
    const context = await loadRefinementPromptContext(user.id);
    const { data: ticket, error: ticketError } = await context.admin.from("tickets").select("*")
      .eq("id", body.ticketId).eq("user_id", user.id).single();
    if (ticketError) throw ticketError;

    const repositories = serializeRepositories(context.repositories);
    const selectedRepository = repositories.find((repository) => repository.id === body.repositoryId);
    if (!selectedRepository) return NextResponse.json({ error: "Select a repository available to the refinement agent." }, { status: 400 });

    const template = rewriting ? context.agent.refinement_rewrite_prompt : context.agent.refinement_questions_prompt;
    const prompt = renderPromptTemplate(template, {
      ticket, repository: selectedRepository, workspaceInstructions: context.masterInstructions,
      refinementAnswers: body.answers, agentName: context.agent.name,
    });
    const runKind = rewriting ? "refinement_rewrite" : "refinement_questions";
    const { data: run, error } = await context.admin.from("agent_runs").insert({
      user_id: user.id, ticket_id: body.ticketId, column_name: "In Refinement",
      agent_name: context.agent.name, model_name: context.agent.model_name,
      rendered_prompt: prompt, trigger_type: "manual", status: "queued",
      run_kind: runKind, queue_class: "interactive",
      run_input: { repositoryId: selectedRepository.id, proposal: body.proposal ?? null, answers: body.answers ?? null },
    }).select("id").single();
    if (error) throw error;
    return NextResponse.json({ runId: run.id }, { status: 202 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The refinement run could not be queued.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
