import { NextResponse } from "next/server";
import type { GitHubRepository, Ticket } from "@/lib/types";
import type { RefinementProposal } from "@/lib/refinement-types";

interface RefinementRequest {
  ticket: Pick<Ticket, "title" | "description" | "acceptanceCriteria" | "priority" | "tags">;
  repositories: GitHubRepository[];
  instructions: string;
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["repositoryId", "repositoryReason", "questions"],
  properties: {
    repositoryId: { type: "string" },
    repositoryReason: { type: "string" },
    questions: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "question", "suggestions"],
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          suggestions: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
        },
      },
    },
  },
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });

  let body: RefinementRequest;
  try { body = await request.json() as RefinementRequest; }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  if (!body.ticket?.title || !Array.isArray(body.repositories)) {
    return NextResponse.json({ error: "A ticket and repository list are required." }, { status: 400 });
  }

  const repositoryList = body.repositories.length
    ? body.repositories.map((repository) => `- id=${repository.id}; name=${repository.owner}/${repository.name}; default_branch=${repository.defaultBranch}`).join("\n")
    : "No repositories are connected.";
  const prompt = `You are a product refinement agent. Classify which connected repository best fits the ticket, using only an exact repository id from the list. If none fit or none exist, return an empty repositoryId. Then ask 2-5 concise questions that resolve the most important ambiguities. Each question must have exactly three short, realistic, mutually exclusive suggested answers. Do not include an \"Other\" suggestion because the UI supplies a free-text answer.\n\nAgent instructions:\n${body.instructions}\n\nRepositories:\n${repositoryList}\n\nTicket:\n${JSON.stringify(body.ticket, null, 2)}`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_REFINEMENT_MODEL || "gpt-5.6-luna",
      input: prompt,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "refinement_proposal", strict: true, schema } },
    }),
  });
  const result = await response.json() as { output_text?: string; error?: { message?: string } };
  if (!response.ok || !result.output_text) {
    return NextResponse.json({ error: result.error?.message || "The refinement agent did not return a result." }, { status: 502 });
  }

  try {
    const proposal = JSON.parse(result.output_text) as RefinementProposal;
    const repositoryIds = new Set(body.repositories.map((repository) => repository.id));
    if (proposal.repositoryId && !repositoryIds.has(proposal.repositoryId)) proposal.repositoryId = "";
    return NextResponse.json(proposal);
  } catch {
    return NextResponse.json({ error: "The refinement result could not be read." }, { status: 502 });
  }
}
