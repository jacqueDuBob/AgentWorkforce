import { NextResponse } from "next/server";
import type { RefinedTicketContent, RefinementAnswer, RefinementProposal } from "@/lib/refinement-types";
import { renderPromptTemplate } from "@/lib/prompt-template";
import { authenticatedUser } from "@/lib/server-auth";
import { loadRefinementPromptContext, serializeRepositories } from "@/lib/server-prompt-context";

interface RefinementRequest {
  action?: "questions" | "rewrite";
  ticketId: string;
  repositoryId?: string;
  answers?: RefinementAnswer[];
}

interface ResponsesApiResult {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
}

const readOutputText = (result: ResponsesApiResult) => result.output_text || result.output
  ?.flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text")
  .map((item) => item.text).join("") || "";

const questionSchema = {
  type: "object", additionalProperties: false, required: ["repositoryId", "repositoryReason", "questions"],
  properties: {
    repositoryId: { type: "string" }, repositoryReason: { type: "string" },
    questions: { type: "array", minItems: 2, maxItems: 5, items: { type: "object", additionalProperties: false,
      required: ["id", "question", "suggestions"], properties: { id: { type: "string" }, question: { type: "string" },
        suggestions: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } } } } },
  },
};

const rewriteSchema = {
  type: "object", additionalProperties: false,
  required: ["title", "description", "acceptanceCriteria", "priority", "tags", "epicRecommendation"],
  properties: {
    title: { type: "string" }, description: { type: "string" }, acceptanceCriteria: { type: "string" },
    priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] },
    tags: { type: "array", maxItems: 3, items: { type: "string" } },
    epicRecommendation: { type: "object", additionalProperties: false, required: ["recommended", "reason"],
      properties: { recommended: { type: "boolean" }, reason: { type: "string" } } },
  },
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });
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
    const prompt = `${renderPromptTemplate(template, {
      ticket, repository: selectedRepository, workspaceInstructions: context.masterInstructions,
      refinementAnswers: body.answers, agentName: context.agent.name,
    })}\n\nThe repository was selected by the user. Use repositoryId ${selectedRepository.id} and do not classify or substitute another repository.`;
    const modelName = context.agent.model_name;
    if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(modelName)) throw new Error("The refinement agent model is invalid.");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName, input: prompt,
        text: { format: { type: "json_schema", name: rewriting ? "refined_ticket" : "refinement_proposal", strict: true,
          schema: rewriting ? rewriteSchema : questionSchema } } }),
    });
    const result = await response.json() as ResponsesApiResult;
    const outputText = readOutputText(result);
    if (!response.ok || !outputText) return NextResponse.json({ error: result.error?.message || "The refinement agent did not return a result." }, { status: 502 });
    if (rewriting) return NextResponse.json(JSON.parse(outputText) as RefinedTicketContent);
    const proposal = JSON.parse(outputText) as RefinementProposal;
    proposal.repositoryId = selectedRepository.id;
    return NextResponse.json(proposal);
  } catch (cause) {
    const message = cause instanceof SyntaxError ? "The refinement result could not be read."
      : cause instanceof Error ? cause.message : "The refinement agent failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
