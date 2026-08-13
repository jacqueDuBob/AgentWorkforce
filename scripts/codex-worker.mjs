import { Codex } from "@openai/codex-sdk";
import { access } from "node:fs/promises";
import path from "node:path";

const appUrl = (process.env.FLOWBOARD_URL || "").replace(/\/$/, "");
const workerToken = process.env.FLOWBOARD_WORKER_TOKEN || "";
const pollInterval = Number(process.env.FLOWBOARD_POLL_INTERVAL_MS || 5000);

function repositoryMap() {
  try { return JSON.parse(process.env.FLOWBOARD_REPOSITORIES || "{}"); }
  catch { throw new Error("FLOWBOARD_REPOSITORIES must map owner/name to a local path."); }
}

if (!appUrl || !workerToken) {
  console.error("Set FLOWBOARD_URL and FLOWBOARD_WORKER_TOKEN before starting the worker.");
  process.exit(1);
}

const repositories = repositoryMap();
const codex = new Codex();
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  type: "object", additionalProperties: false, required: ["findings", "gitPushSucceeded", "summary"],
  properties: {
    findings: { type: "array", items: { type: "string" } },
    gitPushSucceeded: { type: "boolean" },
    summary: { type: "string" },
  },
};

async function request(endpoint, init = {}) {
  const response = await fetch(`${appUrl}${endpoint}`, {
    ...init,
    headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json", ...init.headers },
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body.error === "string"
      ? body.error
      : body.error ? JSON.stringify(body.error) : `Flowboard returned HTTP ${response.status}.`;
    throw new Error(detail);
  }
  return body;
}

async function finish(runId, result) {
  await request(`/api/worker/runs/${runId}/finish`, { method: "POST", body: JSON.stringify(result) });
}

function reportsSuccessfulGitPush(response) {
  return /(?:^|\\n)GIT_PUSH_SUCCEEDED\\s*:\s*true(?:\\n|$)/i.test(response || "");
}

async function execute(job) {
  const repositoryKey = job.repository ? `${job.repository.owner}/${job.repository.name}` : "";
  const configuredPath = repositoryKey ? repositories[repositoryKey] : "";
  if (!configuredPath) throw new Error(`No local path configured for repository ${repositoryKey || "(none)"}.`);
  const workingDirectory = path.resolve(configuredPath);
  await access(path.join(workingDirectory, ".git"));
  const thread = codex.startThread({
    model: job.run.modelName || undefined,
    workingDirectory,
    sandboxMode: job.run.kind.startsWith("refinement_") || job.run.kind === "epic_breakout" ? "read-only" : "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: false,
  });
  if (!job.run.renderedPrompt?.trim()) throw new Error("The queued run does not contain a rendered prompt snapshot.");
  const schema = job.run.kind === "refinement_questions" ? questionSchema
    : job.run.kind === "refinement_rewrite" ? rewriteSchema
    : job.run.kind === "epic_breakout" ? breakoutSchema
    : job.run.column === "In Review" ? reviewSchema : undefined;
  const turn = await thread.run(job.run.renderedPrompt, schema ? { outputSchema: schema } : undefined);
  if (schema) {
    const result = JSON.parse(turn.finalResponse);
    await finish(job.run.id, { result, threadId: thread.id, gitPushSucceeded: job.run.column === "In Review" && result.gitPushSucceeded === true });
  }
  else await finish(job.run.id, { finalResponse: turn.finalResponse, threadId: thread.id, gitPushSucceeded: reportsSuccessfulGitPush(turn.finalResponse) });
  console.log(`[finished] ${job.ticket.title}`);
}

console.log(`Flowboard Codex worker polling ${appUrl}`);
for (;;) {
  try {
    const job = await request("/api/worker/runs/claim", { method: "POST" });
    if (!job) await delay(pollInterval);
    else {
      console.log(`[claimed] ${job.ticket.title}`);
      try { await execute(job); }
      catch (cause) {
        const message = cause instanceof Error ? cause.message : "Local Codex run failed.";
        await finish(job.run.id, { error: message }).catch(() => {});
        console.error(`[failed] ${job.ticket.title}: ${message}`);
      }
    }
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : cause);
    await delay(Math.max(pollInterval, 5000));
  }
}
