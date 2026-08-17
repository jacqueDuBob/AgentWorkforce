import { Codex } from "@openai/codex-sdk";
import { codexSandboxMode } from "./permissions.mjs";

const questionSchema = {
  type: "object", additionalProperties: false, required: ["repositoryId", "repositoryReason", "questions"],
  properties: {
    repositoryId: { type: "string" }, repositoryReason: { type: "string" },
    questions: { type: "array", minItems: 5, maxItems: 10, items: { type: "object", additionalProperties: false,
      required: ["id", "question", "suggestions"], properties: { id: { type: "string" }, question: { type: "string" },
        suggestions: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } } } } },
  },
};

const rewriteSchema = {
  type: "object", additionalProperties: false,
  required: ["title", "description", "acceptanceCriteria", "priority", "tags", "technicalDesign", "epicRecommendation"],
  properties: {
    title: { type: "string" }, description: { type: "string" }, acceptanceCriteria: { type: "string" },
    priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] },
    tags: { type: "array", maxItems: 3, items: { type: "string" } }, technicalDesign: { type: "string" },
    epicRecommendation: { type: "object", additionalProperties: false, required: ["recommended", "reason"],
      properties: { recommended: { type: "boolean" }, reason: { type: "string" } } },
  },
};

const breakoutSchema = {
  type: "object", additionalProperties: false, required: ["children"], properties: { children: {
    type: "array", minItems: 2, maxItems: 12, items: { type: "object", additionalProperties: false,
      required: ["title", "description", "acceptanceCriteria", "priority", "tags"], properties: {
        title: { type: "string" }, description: { type: "string" }, acceptanceCriteria: { type: "array", items: { type: "string" } },
        priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] }, tags: { type: "array", maxItems: 3, items: { type: "string" } },
      } },
  } },
};

const reviewSchema = {
  type: "object", additionalProperties: false, required: ["findings", "summary"],
  properties: { findings: { type: "array", items: { type: "string" } }, summary: { type: "string" } },
};

const workflowSchema = {
  type: "object", additionalProperties: false, required: ["summary", "questions", "proposals"],
  properties: {
    summary: { type: "string" }, questions: { type: "array", items: { type: "string" } },
    proposals: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "description", "changes"], properties: {
      title: { type: "string" }, description: { type: "string" },
      changes: { type: "object", additionalProperties: false,
        required: ["title", "description", "priority", "tags", "assignee"], properties: {
          title: { type: ["string", "null"] }, description: { type: ["string", "null"] },
          priority: { type: ["string", "null"], enum: ["Low", "Medium", "High", "Urgent", null] },
          tags: { anyOf: [{ type: "array", maxItems: 3, items: { type: "string" } }, { type: "null" }] },
          assignee: { type: ["string", "null"] },
        } },
    } } },
  },
};

export function outputSchemaFor(job) {
  if (job.type === "refinement" && job.subtype === "questions") return questionSchema;
  if (job.type === "refinement" && job.subtype === "rewrite") return rewriteSchema;
  if (job.type === "epic_breakout") return breakoutSchema;
  if (job.type === "review") return reviewSchema;
  if (job.type === "development") return workflowSchema;
  return undefined;
}

export class CodexDevelopmentAgentAdapter {
  constructor(codex = new Codex()) {
    this.codex = codex;
    this.id = "codex";
  }

  async invoke(job, workspace) {
    if (!job.prompt?.trim()) throw new Error("The queued run does not contain a rendered prompt snapshot.");
    const thread = this.codex.startThread({
      model: job.agent.model,
      workingDirectory: workspace.workingDirectory,
      sandboxMode: codexSandboxMode(job),
      approvalPolicy: job.permissions.approvalPolicy,
      networkAccessEnabled: job.permissions.networkAccess,
    });
    const schema = outputSchemaFor(job);
    const turn = await thread.run(job.prompt, schema ? { outputSchema: schema } : undefined);
    return { provider: this.id, threadId: thread.id, finalResponse: turn.finalResponse, structured: Boolean(schema) };
  }
}
