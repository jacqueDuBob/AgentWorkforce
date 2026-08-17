import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertRepositoryAuthorization, buildJobSpecV1, parseJobResult, parseJobSpec,
  serializeJobResult, serializeJobSpec,
} from "../../shared/job-contract.mjs";
import { FlowboardJobSource } from "../../scripts/runner/flowboard-job-source.mjs";

function specInput(overrides = {}) {
  return {
    id: "run-1", type: "review",
    ticket: { id: "ticket-1", title: "Review work", findings: "", baseBranch: "main", status: "Renamed UI label" },
    repository: { id: "repo-1", owner: "owner", name: "repo", defaultBranch: "main" },
    prompt: "Review the immutable snapshot.", agent: { provider: "codex", name: "Reviewer", model: "model" },
    verificationPlan: { version: 1, checks: [{ id: "test", executable: "npm", args: ["run", "test"], timeoutMs: 600000 }], trustedPackageScripts: { test: "node --test" } },
    input: { source: "server" }, ...overrides,
  };
}

test("JobSpec V1 serializes and deserializes without changing its snapshot", () => {
  const input = specInput();
  const spec = buildJobSpecV1(input);
  const serialized = serializeJobSpec(spec);
  input.ticket.title = "Mutable ticket changed";
  input.verificationPlan.checks[0].executable = "malicious";
  const parsed = parseJobSpec(serialized);
  assert.equal(parsed.ticket.title, "Review work");
  assert.equal(parsed.execution.verificationPlan.checks[0].executable, "npm");
  assert.equal(parsed.type, "review");
  assert.equal(parsed.permissions.profile, "repository_read");
});

test("unknown and malformed persisted JobSpecs are rejected", () => {
  assert.throws(() => parseJobSpec({ version: 2 }), /Unsupported JobSpec version/);
  assert.throws(() => parseJobSpec({ ...buildJobSpecV1(specInput()), prompt: "" }), /prompt/);
  assert.throws(() => parseJobSpec({ ...buildJobSpecV1(specInput()), permissions: { profile: "repository_write" } }), /does not match review/);
});

test("server builder ignores attempted permission and backend escalation", () => {
  const spec = buildJobSpecV1(specInput({
    permissions: { profile: "repository_write", networkAccess: true },
    execution: { backend: "privileged-host" },
  }));
  assert.equal(spec.permissions.profile, "repository_read");
  assert.equal(spec.permissions.networkAccess, false);
  assert.equal(spec.execution.git.mode, "require_ticket_branch");
  assert.equal("backend" in spec.execution, false);
});

test("repository authorization enforces selected access", () => {
  assert.doesNotThrow(() => assertRepositoryAuthorization("all", "repo-2", []));
  assert.doesNotThrow(() => assertRepositoryAuthorization("selected", "repo-1", ["repo-1"]));
  assert.throws(() => assertRepositoryAuthorization("selected", "repo-2", ["repo-1"]), /not authorized/);
});

test("persisted JobSpec takes precedence over legacy column inference", async () => {
  const jobSpec = serializeJobSpec(buildJobSpecV1(specInput()));
  const source = new FlowboardJobSource({
    appUrl: "https://flowboard.test", workerToken: "token",
    fetchImplementation: async () => ({ status: 200, ok: true, json: async () => ({
      jobSpec, resumeContext: [],
      run: { id: "run-1", kind: "column", column: "In Work", renderedPrompt: "mutable legacy prompt" },
      ticket: { id: "ticket-1", title: "Mutable legacy ticket" },
    }) }),
  });
  const job = await source.claim();
  assert.equal(job.persisted, true);
  assert.equal(job.type, "review");
  assert.equal(job.prompt, "Review the immutable snapshot.");
  assert.equal(job.ticket.title, "Review work");
});

test("legacy queued rows still use the compatibility mapper", async () => {
  const source = new FlowboardJobSource({
    appUrl: "https://flowboard.test", workerToken: "token",
    fetchImplementation: async () => ({ status: 200, ok: true, json: async () => ({
      jobSpec: null,
      run: { id: "run-1", kind: "column", column: "In Work", agentName: "Developer", renderedPrompt: "Legacy prompt" },
      ticket: { id: "ticket-1", title: "Legacy ticket" }, repository: { owner: "owner", name: "repo", defaultBranch: "main" },
    }) }),
  });
  const job = await source.claim();
  assert.equal(job.persisted, false);
  assert.equal(job.type, "development");
});

test("canonical JobResult persists deterministic evidence", () => {
  const result = serializeJobResult({
    version: 1, jobId: "run-1", jobType: "review", outcome: "succeeded",
    agent: { provider: "codex", threadId: "thread-1" }, result: { findings: [], summary: "Clean" },
    git: { pushSucceeded: true, branch: "flowboard/ticket-1", changedFiles: ["src/index.ts"] },
    checks: [{ id: "test", command: ["npm", "run", "test"], exitCode: 0, succeeded: true, durationMs: 42, stdout: "passed", stderr: "", timedOut: false }],
  });
  const parsed = parseJobResult(result);
  assert.equal(parsed.checks[0].exitCode, 0);
  assert.equal(parsed.git.branch, "flowboard/ticket-1");
  assert.deepEqual(parsed.git.changedFiles, ["src/index.ts"]);
});

test("migration updates only future Review and Testing prompt templates", async () => {
  const migration = await readFile(new URL("../../supabase/migrations/020_persisted_job_contracts.sql", import.meta.url), "utf8");
  assert.match(migration, /Do not modify files or run build, lint, type-check, or test commands/);
  assert.match(migration, /Runner is authoritative for deterministic verification results/);
  assert.doesNotMatch(migration, /update public\.agent_runs\s+set job_spec/);
});

test("application job creation is centralized in the server queue service", async () => {
  const [store, queue, refinement, breakout] = await Promise.all([
    readFile(new URL("../../lib/agent-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/server-job-queue.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/refinement/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/epic-breakout/route.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(store, /from\("agent_runs"\)\.insert/);
  assert.match(queue, /from\("agent_runs"\)\.insert/);
  assert.match(refinement, /queueRefinementJob/);
  assert.match(breakout, /queueEpicBreakoutJob/);
});
