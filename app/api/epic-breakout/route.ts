import { NextResponse } from "next/server";
import type { ProposedChild } from "@/lib/types";
import { renderPromptTemplate } from "@/lib/prompt-template";
import { authenticatedUser } from "@/lib/server-auth";
import { loadRefinementPromptContext } from "@/lib/server-prompt-context";

const childSchema = {
  type: "object", additionalProperties: false, required: ["children"], properties: { children: {
    type: "array", minItems: 2, maxItems: 12, items: { type: "object", additionalProperties: false,
      required: ["title", "description", "acceptanceCriteria", "priority", "tags"], properties: {
        title: { type: "string" }, description: { type: "string" }, acceptanceCriteria: { type: "array", items: { type: "string" } },
        priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] }, tags: { type: "array", maxItems: 3, items: { type: "string" } },
      } },
  } },
};

type Body = { epicId: string; domain: string };
type ApiResult = { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };
const outputText = (result: ApiResult) => result.output_text || result.output?.flatMap((item) => item.content ?? [])
  .filter((item) => item.type === "output_text").map((item) => item.text).join("") || "";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });
  const user = await authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Body;
  if (!body.epicId) return NextResponse.json({ error: "A confirmed Epic is required." }, { status: 400 });

  try {
    const context = await loadRefinementPromptContext(user.id);
    const { data: epic, error: epicError } = await context.admin.from("tickets").select("*")
      .eq("id", body.epicId).eq("user_id", user.id).eq("item_type", "Epic").single();
    if (epicError) throw epicError;
    const prompt = renderPromptTemplate(context.agent.epic_breakout_prompt, {
      ticket: epic, domain: body.domain, requesterEmail: user.email ?? "Requesting user",
      agentName: context.agent.name, workspaceInstructions: context.masterInstructions,
    });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: context.agent.model_name, input: prompt,
        text: { format: { type: "json_schema", name: "epic_children", strict: true, schema: childSchema } } }),
    });
    const result = await response.json() as ApiResult;
    const text = outputText(result);
    if (!response.ok || !text) return NextResponse.json({ error: result.error?.message || "The breakout agent did not return proposed children." }, { status: 502 });
    return NextResponse.json(JSON.parse(text) as { children: ProposedChild[] });
  } catch (cause) {
    const message = cause instanceof SyntaxError ? "The breakout proposal could not be read."
      : cause instanceof Error ? cause.message : "The breakout agent failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
