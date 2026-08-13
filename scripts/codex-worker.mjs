import { Codex } from "@openai/codex-sdk";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

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
const execFileAsync = promisify(execFile);
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
  type: "object", additionalProperties: false, required: ["findings", "summary"],
  properties: {
    findings: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
};

const workflowSchema = {
  type: "object", additionalProperties: false, required: ["summary", "questions", "proposals"],
  properties: {
    summary: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
    proposals: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "description", "changes"], properties: {
      title: { type: "string" }, description: { type: "string" },
      changes: { type: "object", additionalProperties: false,
        required: ["title", "description", "priority", "tags", "assignee"], properties: {
          title: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
          priority: { type: ["string", "null"], enum: ["Low", "Medium", "High", "Urgent", null] },
          tags: { anyOf: [{ type: "array", maxItems: 3, items: { type: "string" } }, { type: "null" }] },
          assignee: { type: ["string", "null"] },
        } },
    } } },
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

async function git(workingDirectory, args) {
  const { stdout } = await execFileAsync("git", args, { cwd: workingDirectory });
  return stdout.trim();
}

async function prepareGitWorkspace(job, workingDirectory) {
  if (job.run.kind !== "column") return;
  const currentBranch = await git(workingDirectory, ["branch", "--show-current"]);
  const baseBranch = job.ticket.baseBranch || job.repository.defaultBranch;
  if (!baseBranch) throw new Error("The ticket does not specify a base branch.");

  if (job.run.column === "In Work" && !job.ticket.findings?.trim()) {
    const status = await git(workingDirectory, ["status", "--porcelain"]);
    if (status) throw new Error("The repository has uncommitted changes; refusing to start a new ticket branch.");
    const ticketBranch = `flowboard/${job.ticket.id}`;
    const existingBranch = await git(workingDirectory, ["branch", "--list", ticketBranch]);
    await git(workingDirectory, ["switch", baseBranch]);
    await git(workingDirectory, existingBranch ? ["switch", ticketBranch] : ["switch", "-c", ticketBranch]);
    return;
  }

  if ((job.run.column === "In Work" || job.run.column === "In Review") && (!currentBranch || currentBranch === baseBranch)) {
    throw new Error(`The ${job.run.column} run requires an existing non-base ticket branch.`);
  }
}

async function commitAndPushReview(job, workingDirectory) {
  const baseBranch = job.ticket.baseBranch || job.repository.defaultBranch;
  const currentBranch = await git(workingDirectory, ["branch", "--show-current"]);
  if (!currentBranch || currentBranch === baseBranch) throw new Error("Refusing to commit or push the configured base branch.");
  await git(workingDirectory, ["add", "--all"]);
  const stagedFiles = await git(workingDirectory, ["diff", "--cached", "--name-only"]);
  if (!stagedFiles) throw new Error("The clean review has no changes to commit.");
  await git(workingDirectory, ["commit", "-m", job.ticket.title]);
  await git(workingDirectory, ["push", "--set-upstream", "origin", "HEAD"]);
}

async function execute(job) {
  const repositoryKey = job.repository ? `${job.repository.owner}/${job.repository.name}` : "";
  const configuredPath = repositoryKey ? repositories[repositoryKey] : "";
  if (!configuredPath) throw new Error(`No local path configured for repository ${repositoryKey || "(none)"}.`);
  const workingDirectory = path.resolve(configuredPath);
  await access(path.join(workingDirectory, ".git"));
  await prepareGitWorkspace(job, workingDirectory);
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
    : job.run.column === "In Review" ? reviewSchema : job.run.column === "In Work" ? workflowSchema : undefined;
  const turn = await thread.run(job.run.renderedPrompt, schema ? { outputSchema: schema } : undefined);
  if (schema) {
    const result = JSON.parse(turn.finalResponse);
    let gitPushSucceeded = false;
    if (job.run.column === "In Review" && Array.isArray(result.findings) && result.findings.length === 0) {
      await commitAndPushReview(job, workingDirectory);
      gitPushSucceeded = true;
    }
    if (job.run.column === "In Review") result.gitPushSucceeded = gitPushSucceeded;
    await finish(job.run.id, { result, threadId: thread.id, gitPushSucceeded });
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
