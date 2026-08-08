import { NextResponse } from "next/server";
import type { ProposedChild, Ticket } from "@/lib/types";

const childSchema = {
  type: "object", additionalProperties: false, required: ["children"], properties: { children: {
    type: "array", minItems: 2, maxItems: 12, items: { type: "object", additionalProperties: false,
      required: ["title", "description", "acceptanceCriteria", "priority", "tags"], properties: {
        title: { type: "string" }, description: { type: "string" }, acceptanceCriteria: { type: "array", items: { type: "string" } },
        priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] }, tags: { type: "array", maxItems: 3, items: { type: "string" } },
      } },
  } },
};

type Body = { epic: Ticket; domain: string; requesterEmail: string; agentName: string; modelName: string; instructions: string };
type ApiResult = { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };
const outputText = (result: ApiResult) => result.output_text || result.output?.flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text).join("") || "";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });
  let body: Body;
  try { body = await request.json() as Body; } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body.epic?.id || body.epic.itemType !== "Epic" || !body.requesterEmail || !/^[a-zA-Z0-9._:-]{1,100}$/.test(body.modelName || "")) return NextResponse.json({ error: "A confirmed Epic, requester, and valid agent model are required." }, { status: 400 });

  const prompt = `You are ${body.agentName}, a specialized Epic breakout agent for ${body.domain}. Decompose the Epic into independently actionable child tickets. Do not repeat the Epic itself or invent unrelated scope. Each child needs testable acceptance criteria. The requesting participant is ${body.requesterEmail}.\n\nAgent instructions:\n${body.instructions || "Decompose the Epic into cohesive deliverable slices."}\n\nEpic:\n${JSON.stringify(body.epic, null, 2)}`;
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: body.modelName, input: prompt, text: { format: { type: "json_schema", name: "epic_children", strict: true, schema: childSchema } } }) });
  const result = await response.json() as ApiResult; const text = outputText(result);
  if (!response.ok || !text) return NextResponse.json({ error: result.error?.message || "The breakout agent did not return proposed children." }, { status: 502 });
  try { return NextResponse.json(JSON.parse(text) as { children: ProposedChild[] }); } catch { return NextResponse.json({ error: "The breakout proposal could not be read." }, { status: 502 }); }
}
