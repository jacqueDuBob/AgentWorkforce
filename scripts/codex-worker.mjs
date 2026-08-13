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

async function request(endpoint, init = {}) {
  const response = await fetch(`${appUrl}${endpoint}`, {
    ...init,
    headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json", ...init.headers },
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Flowboard returned HTTP ${response.status}.`);
  return body;
}

async function finish(runId, result) {
  await request(`/api/worker/runs/${runId}/finish`, { method: "POST", body: JSON.stringify(result) });
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
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: false,
  });
  if (!job.run.renderedPrompt?.trim()) throw new Error("The queued run does not contain a rendered prompt snapshot.");
  const turn = await thread.run(job.run.renderedPrompt);
  await finish(job.run.id, { finalResponse: turn.finalResponse, threadId: thread.id });
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
