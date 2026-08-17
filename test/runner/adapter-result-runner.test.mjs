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
  assert.deepEqual(toLegacyFinishPayload(result), {
    result: { findings: [], summary: "Clean", gitPushSucceeded: true },
    threadId: "thread-1", gitPushSucceeded: true,
  });
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
  await runner.execute(spec());
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
