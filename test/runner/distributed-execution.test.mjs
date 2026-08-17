import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildJobSpecV1 } from "../../shared/job-contract.mjs";
import { classifyFailure } from "../../scripts/runner/failures.mjs";
import { FlowboardJobSource } from "../../scripts/runner/flowboard-job-source.mjs";
import { FileRepositoryExecutionLock } from "../../scripts/runner/local-checkout-workspace.mjs";
import { createWorkerCapabilities, parseWorkerCapabilities, workerCanExecute } from "../../scripts/runner/worker-capabilities.mjs";

const job = (overrides = {}) => buildJobSpecV1({
  id: "run-1", type: "testing", ticket: { id: "ticket-1", title: "Test" },
  repository: { id: "repo-1", owner: "acme", name: "app", defaultBranch: "main" }, prompt: "Inspect tests.",
  agent: { provider: "codex", name: "Tester" }, verificationPlan: { version: 1, checks: [], trustedPackageScripts: {} }, ...overrides,
});

test("worker capabilities are provider-neutral and reject unsupported jobs", () => {
  const caps = createWorkerCapabilities({ "acme/app": "/checkout" });
  assert.equal(workerCanExecute(caps, job()), true);
  assert.equal(workerCanExecute({ ...caps, agentAdapters: ["gemini"] }, job()), false);
  assert.equal(workerCanExecute({ ...caps, repositories: [] }, job()), false);
  assert.throws(() => parseWorkerCapabilities({ jobSpecVersions: [1] }), /jobTypes/);
});

test("verification jobs require deterministic execution capability", () => {
  const spec = job({ verificationPlan: { version: 1, checks: [{ id: "test", executable: "npm", args: ["test"], timeoutMs: 1000 }], trustedPackageScripts: {} } });
  const caps = createWorkerCapabilities({ "acme/app": "/checkout" });
  assert.equal(workerCanExecute({ ...caps, features: [] }, spec), false);
});

test("failure classes allow retries only for transient execution failures", () => {
  assert.deepEqual(classifyFailure({ failureClass: "provider" }), { failureClass: "provider", retryable: true });
  assert.deepEqual(classifyFailure({ failureClass: "verification" }), { failureClass: "verification", retryable: false });
  assert.deepEqual(classifyFailure({ failureClass: "contract" }), { failureClass: "contract", retryable: false });
  assert.deepEqual(classifyFailure({ name: "AbortError" }), { failureClass: "cancellation", retryable: false });
});

test("completion retries reuse the exact idempotency payload", async () => {
  const bodies = [];
  const source = new FlowboardJobSource({ appUrl: "https://flowboard.test", workerToken: "token", capabilities: {}, fetchImplementation: async (_url, init) => {
    bodies.push(init.body);
    if (bodies.length < 3) throw new Error("connection reset");
    return { status: 200, ok: true, json: async () => ({ ok: true, duplicate: true }) };
  } });
  await source.complete("run-1", { attemptId: "attempt-1", completionId: "completion-1" });
  assert.equal(bodies.length, 3);
  assert.equal(new Set(bodies).size, 1);
});

test("filesystem repository locks exclude independent lock instances and clean up", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "flowboard-lock-"));
  await mkdir(path.join(root, ".git"));
  const first = new FileRepositoryExecutionLock({ retryMs: 5, timeoutMs: 200 });
  const second = new FileRepositoryExecutionLock({ retryMs: 5, timeoutMs: 200 });
  const releaseFirst = await first.acquire("acme/app", root);
  let acquired = false;
  const waiting = second.acquire("acme/app", root).then((release) => { acquired = true; return release; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(acquired, false);
  await releaseFirst();
  const releaseSecond = await waiting;
  assert.equal(acquired, true);
  await releaseSecond();
  await rm(root, { recursive: true, force: true });
});

test("migration introduces atomic claims, leases, attempts, and idempotent outbox", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(new URL("../../supabase/migrations/021_distributed_runner_execution.sql", import.meta.url), "utf8");
  const hardening = await readFile(new URL("../../supabase/migrations/022_runner_completion_hardening.sql", import.meta.url), "utf8");
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /create table public\.agent_run_attempts/i);
  assert.match(sql, /lease_until/);
  assert.match(sql, /completion_payload_hash/);
  assert.match(sql, /unique \(attempt_id, event_type\)/i);
  assert.match(sql, /status='expired'/);
  assert.match(hardening, /quarantine_invalid_job_specs_on_worker_poll/);
  assert.match(hardening, /failure_class,retryable,error/);
  assert.match(hardening, /agent_runs_queue_dedup_key_idx/);
  assert.match(hardening, /agent_run_attempt_completion_effects/);
});
