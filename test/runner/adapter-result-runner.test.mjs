import assert from "node:assert/strict";
import test from "node:test";
import { CodexDevelopmentAgentAdapter } from "../../scripts/runner/codex-adapter.mjs";
import { legacyRunToJobSpec } from "../../scripts/runner/contracts.mjs";
import { parseAgentResult, reportsSuccessfulGitPush, toLegacyFinishPayload } from "../../scripts/runner/result.mjs";
import { Runner } from "../../scripts/runner/runner.mjs";

function spec(column = "In Work") {
  return legacyRunToJobSpec({
    run: { id: "run-1", kind: "column", column, agentName: "Agent", modelName: "model", renderedPrompt: "Prompt" },
    ticket: { id: "ticket-1", title: "Ticket", findings: "", baseBranch: "main" },
    repository: { owner: "owner", name: "repo", defaultBranch: "main" },
  });
}

test("Codex adapter propagates provider errors and applies policy", async () => {
  let options;
  const adapter = new CodexDevelopmentAgentAdapter({ startThread(value) {
    options = value;
    return { id: "thread-1", run: async () => { throw new Error("provider unavailable"); } };
  } });
  await assert.rejects(adapter.invoke(spec(), { workingDirectory: "/repo" }), /provider unavailable/);
  assert.equal(options.sandboxMode, "workspace-write");
  assert.equal(options.networkAccessEnabled, false);
  assert.equal(options.approvalPolicy, "never");
});

test("Codex adapter rejects an empty queued prompt inside execution", async () => {
  const adapter = new CodexDevelopmentAgentAdapter({ startThread() { throw new Error("should not start"); } });
  const job = { ...spec(), prompt: " " };
  await assert.rejects(adapter.invoke(job, { workingDirectory: "/repo" }), /prompt snapshot/);
});

test("JobResult parsing preserves the existing structured finish payload", () => {
  const job = spec("In Review");
  const result = parseAgentResult(job, {
    provider: "codex", threadId: "thread-1", structured: true,
    finalResponse: JSON.stringify({ findings: [], summary: "Clean" }),
  }, { gitPushSucceeded: true });
  const payload = toLegacyFinishPayload(result);
  assert.deepEqual({ result: payload.result, threadId: payload.threadId, gitPushSucceeded: payload.gitPushSucceeded }, {
    result: { findings: [], summary: "Clean", gitPushSucceeded: true },
    threadId: "thread-1", gitPushSucceeded: true,
  });
  assert.equal(payload.resultVersion, 1);
  assert.equal(payload.canonicalResult, result);
  assert.deepEqual(result.checks, []);
});

test("canonical checks do not alter the legacy finish payload", () => {
  const job = spec();
  const checks = [{ id: "lint", command: ["npm", "run", "lint"], exitCode: 0, succeeded: true, durationMs: 10, stdout: "", stderr: "", timedOut: false }];
  const result = parseAgentResult(job, {
    provider: "codex", threadId: "thread-1", structured: true,
    finalResponse: JSON.stringify({ summary: "Done", questions: [], proposals: [] }),
  }, { checks });
  assert.deepEqual(result.checks, checks);
  const payload = toLegacyFinishPayload(result);
  assert.deepEqual({ result: payload.result, threadId: payload.threadId, gitPushSucceeded: payload.gitPushSucceeded }, {
    result: { summary: "Done", questions: [], proposals: [] }, threadId: "thread-1", gitPushSucceeded: false,
  });
  assert.deepEqual(payload.canonicalResult.checks, checks);
});

test("JobResult parsing rejects malformed structured output", () => {
  assert.throws(() => parseAgentResult(spec(), {
    provider: "codex", threadId: "thread-1", structured: true, finalResponse: "not json",
  }), SyntaxError);
});

test("legacy git push signal remains compatible", () => {
  assert.equal(reportsSuccessfulGitPush("done\nGIT_PUSH_SUCCEEDED: true\n"), true);
  assert.equal(reportsSuccessfulGitPush("GIT_PUSH_SUCCEEDED: false"), false);
});

test("Runner disposes workspace after success", async () => {
  let disposed = 0;
  const completed = [];
  const runner = new Runner({
    jobSource: { complete: async (...args) => completed.push(args) },
    workspaceProvider: { provision: async () => ({ workingDirectory: "/repo" }), dispose: async () => { disposed += 1; } },
    gitCapability: { prepare: async () => {} },
    agentAdapter: { invoke: async () => ({ provider: "codex", threadId: "thread", structured: true, finalResponse: JSON.stringify({ summary: "Done", questions: [], proposals: [] }) }) },
  });
  await runner.execute(spec("In Review"));
  assert.equal(disposed, 1);
  assert.equal(completed.length, 1);
});

test("Runner disposes workspace after execution failure", async () => {
  let disposed = 0;
  const runner = new Runner({
    jobSource: { complete: async () => {} },
    workspaceProvider: { provision: async () => ({ workingDirectory: "/repo" }), dispose: async () => { disposed += 1; } },
    gitCapability: { prepare: async () => {} },
    agentAdapter: { invoke: async () => { throw new Error("failed"); } },
  });
  await assert.rejects(runner.execute(spec()), /failed/);
  assert.equal(disposed, 1);
});

test("Runner cleans verification and repository workspaces after check failure", async () => {
  const disposed = [];
  const runner = new Runner({
    jobSource: { complete: async () => {} },
    workspaceProvider: { provision: async () => ({ workingDirectory: "/repo" }), dispose: async () => disposed.push("repository") },
    gitCapability: { prepare: async () => {} },
    agentAdapter: { invoke: async () => ({ provider: "codex", threadId: "thread", structured: true, finalResponse: JSON.stringify({ summary: "Done", questions: [], proposals: [] }) }) },
    verificationPlanProvider: { forJob: async () => ({ checks: [{ id: "test" }] }) },
    verificationWorkspaceProvider: { provision: async () => ({ workingDirectory: "/verification" }), dispose: async () => disposed.push("verification") },
    verificationExecutor: { execute: async () => [{ id: "test", command: ["npm", "test"], exitCode: 1, succeeded: false, durationMs: 1, stdout: "", stderr: "failed", timedOut: false }] },
  });
  await assert.rejects(runner.execute(spec()), (error) => {
    assert.equal(error.name, "VerificationFailedError");
    assert.equal(error.jobResult.outcome, "failed");
    return true;
  });
  assert.deepEqual(disposed, ["verification", "repository"]);
});

test("Runner releases the repository even when verification cleanup fails", async () => {
  let repositoryDisposed = false;
  const runner = new Runner({
    jobSource: { complete: async () => {} },
    workspaceProvider: { provision: async () => ({ workingDirectory: "/repo" }), dispose: async () => { repositoryDisposed = true; } },
    gitCapability: { prepare: async () => {} },
    agentAdapter: { invoke: async () => ({ provider: "codex", threadId: "thread", structured: true, finalResponse: JSON.stringify({ summary: "Done", questions: [], proposals: [] }) }) },
    verificationPlanProvider: { forJob: async () => ({ checks: [{ id: "test" }] }) },
    verificationWorkspaceProvider: { provision: async () => ({ workingDirectory: "/verification" }), dispose: async () => { throw new Error("cleanup failed"); } },
    verificationExecutor: { execute: async () => [{ id: "test", succeeded: true }] },
  });
  await assert.rejects(runner.execute(spec()), /cleanup failed/);
  assert.equal(repositoryDisposed, true);
});

test("Runner executes the persisted verification snapshot instead of mutable discovery", async () => {
  let discovered = false;
  let executedPlan;
  const persistedJob = {
    ...spec("In Testing"), persisted: true,
    execution: { git: { mode: "prepare_ticket_branch" }, verificationPlan: { version: 1, checks: [{ id: "persisted" }], trustedPackageScripts: {} } },
  };
  const runner = new Runner({
    jobSource: { complete: async () => {} },
    workspaceProvider: { provision: async () => ({ workingDirectory: "/repo" }), dispose: async () => {} },
    gitCapability: { prepare: async () => {}, describe: async () => ({ branch: "branch", changedFiles: [] }) },
    agentAdapter: { invoke: async () => ({ provider: "codex", threadId: "thread", structured: true, finalResponse: JSON.stringify({ summary: "Done", questions: [], proposals: [] }) }) },
    verificationPlanProvider: { forJob: async () => { discovered = true; return { checks: [] }; } },
    verificationWorkspaceProvider: { provision: async () => ({ workingDirectory: "/verification" }), dispose: async () => {} },
    verificationExecutor: { execute: async (plan) => { executedPlan = plan; return [{ id: "persisted", command: ["npm", "test"], exitCode: 0, succeeded: true, durationMs: 1, stdout: "", stderr: "", timedOut: false }]; } },
  });
  await runner.execute(persistedJob);
  assert.equal(discovered, false);
  assert.equal(executedPlan.checks[0].id, "persisted");
});
