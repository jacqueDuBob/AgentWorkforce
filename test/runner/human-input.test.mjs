import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CodexDevelopmentAgentAdapter } from "../../scripts/runner/codex-adapter.mjs";
import { continuationForAdapter } from "../../scripts/runner/continuation.mjs";
import { createJobResult } from "../../scripts/runner/contracts.mjs";
import { parseHumanInputRequest, parseJobResult } from "../../shared/job-contract.mjs";
import { Runner } from "../../scripts/runner/runner.mjs";

const request = {
  version: 1, requestId: "request-1", jobId: "job-1", attemptId: "attempt-1", createdAt: "2026-08-17T12:00:00Z",
  questions: [{ id: "scope", type: "single_choice", prompt: "Which scope?", options: ["API", "UI"] }],
};
const job = {
  id: "job-1", type: "development", prompt: "Implement the feature.", agent: { provider: "codex", model: "model" },
  permissions: { approvalPolicy: "never", networkAccess: false, repositoryAccess: "workspace-write" },
  continuation: { version: 1, request: request, answers: [{ questionId: "scope", answer: "API" }], providerSession: { provider: "codex", sessionId: "thread-1" } },
};

test("HumanInputRequest V1 validates stable structured questions", () => {
  assert.equal(parseHumanInputRequest(request).questions[0].id, "scope");
  assert.throws(() => parseHumanInputRequest({ ...request, questions: [{ id: "scope", type: "single_choice", prompt: "Scope", options: [] }] }), /requires choices/);
});

test("canonical result preserves needs_input separately from logical completion", () => {
  const result = createJobResult(job, { outcome: "needs_input", inputRequest: request, agent: { provider: "codex", threadId: "thread-1" }, checks: [], repository: {} });
  assert.equal(parseJobResult(result).outcome, "needs_input");
  assert.equal(result.inputRequest.attemptId, "attempt-1");
});

test("deterministic continuation contains answers without changing the base prompt or policy", () => {
  const continuation = continuationForAdapter(job);
  assert.match(continuation.prompt, /^Implement the feature\./);
  assert.match(continuation.prompt, /"answer": "API"/);
  assert.equal(job.permissions.repositoryAccess, "workspace-write");
  assert.deepEqual(continuation.providerSession, { provider: "codex", sessionId: "thread-1" });
});

test("Codex adapter resumes a provider session when available", async () => {
  const calls = [];
  const adapter = new CodexDevelopmentAgentAdapter({
    resumeThread: (id) => ({ id, run: async (prompt) => { calls.push(["resume", id, prompt]); return { finalResponse: '{"summary":"done","questions":[],"proposals":[]}' }; } }),
    startThread: () => ({ id: "new", run: async () => { throw new Error("should not start"); } }),
  });
  const result = await adapter.invoke(job, { workingDirectory: "/repo" });
  assert.equal(result.threadId, "thread-1");
  assert.equal(calls[0][0], "resume");
});

test("provider-session failure falls back to deterministic continuation", async () => {
  const prompts = [];
  const adapter = new CodexDevelopmentAgentAdapter({
    resumeThread: () => ({ id: "old", run: async () => { throw new Error("session expired"); } }),
    startThread: () => ({ id: "new", run: async (prompt) => { prompts.push(prompt); return { finalResponse: '{"summary":"done","questions":[],"proposals":[]}' }; } }),
  });
  const result = await adapter.invoke(job, { workingDirectory: "/repo" });
  assert.equal(result.threadId, "new");
  assert.match(prompts[0], /"answer": "API"/);
});

test("a question round suspends before deterministic verification and cleans up", async () => {
  let verified = false; let disposed = false; let completion;
  const runner = new Runner({
    jobSource: { complete: async (_id, payload) => { completion = payload; } },
    workspaceProvider: { provision: async () => ({ workingDirectory: "/repo" }), dispose: async () => { disposed = true; } },
    gitCapability: { prepare: async () => {}, describe: async () => ({ branch: "flowboard/ticket", changedFiles: [] }) },
    agentAdapter: { invoke: async () => ({ provider: "codex", threadId: "thread", structured: true, finalResponse: JSON.stringify({ summary: "Need scope", questions: ["Which scope?"], proposals: [] }) }) },
    verificationPlanProvider: { forJob: async () => ({ checks: [{ id: "test" }] }) },
    verificationWorkspaceProvider: { provision: async () => ({ workingDirectory: "/verify" }), dispose: async () => {} },
    verificationExecutor: { execute: async () => { verified = true; return []; } },
  });
  const result = await runner.execute({ ...job, attempt: { id: "attempt-1" }, ticket: { id: "ticket", title: "Ticket" }, persisted: false });
  assert.equal(result.outcome, "needs_input");
  assert.equal(completion.canonicalResult.inputRequest.questions.length, 1);
  assert.equal(verified, false);
  assert.equal(disposed, true);
});

test("migration models multiple rounds, immutable answers, idempotency, authorization, and blocked state", async () => {
  const sql = await readFile(new URL("../../supabase/migrations/023_human_input_lifecycle.sql", import.meta.url), "utf8");
  assert.match(sql, /create table public\.human_input_requests/);
  assert.match(sql, /create table public\.human_input_answer_events/);
  assert.match(sql, /unique\(request_id,submission_key\)/);
  assert.match(sql, /answered_by uuid not null/);
  assert.match(sql, /public\.can_access_ticket/);
  assert.match(sql, /max_interaction_rounds/);
  assert.match(sql, /status='resumable'/);
  assert.doesNotMatch(sql, /update public\.agent_runs set job_spec/);
});

test("dedicated outbox endpoint is independent of worker claim traffic", async () => {
  const route = await readFile(new URL("../../app/api/internal/runner-outbox/route.ts", import.meta.url), "utf8");
  assert.match(route, /FLOWBOARD_OUTBOX_SECRET/);
  assert.match(route, /dispatchRunnerOutbox/);
});
