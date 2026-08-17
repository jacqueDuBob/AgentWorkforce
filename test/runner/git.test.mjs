import assert from "node:assert/strict";
import test from "node:test";
import { GitCapability } from "../../scripts/runner/git-capability.mjs";

function job(overrides = {}) {
  return {
    type: "development", legacyKind: "column",
    ticket: { id: "ticket-1", title: "Implement feature", findings: "", baseBranch: "main" },
    repository: { defaultBranch: "main" }, legacy: { run: { column: "In Work" } }, ...overrides,
  };
}

function fakeGit(outputs) {
  const calls = [];
  const capability = new GitCapability({ run: async (_cwd, executable, args) => {
    calls.push([executable, ...args]);
    const key = args.join(" ");
    return { stdout: outputs[key] ?? "", stderr: "" };
  } });
  return { capability, calls };
}

test("development refuses to branch from a dirty checkout", async () => {
  const { capability, calls } = fakeGit({ "branch --show-current": "main\n", "status --porcelain": " M file.ts\n" });
  await assert.rejects(capability.prepare(job(), "/repo"), /uncommitted changes/);
  assert.deepEqual(calls.at(-1), ["git", "status", "--porcelain"]);
});

test("development prepares the deterministic ticket branch", async () => {
  const { capability, calls } = fakeGit({ "branch --show-current": "main\n" });
  await capability.prepare(job(), "/repo");
  assert.deepEqual(calls.slice(-2), [
    ["git", "switch", "main"],
    ["git", "switch", "-c", "flowboard/ticket-1"],
  ]);
});

test("review refuses deterministic Git mutation on the base branch", async () => {
  const { capability } = fakeGit({ "branch --show-current": "main\n" });
  await assert.rejects(
    capability.commitAndPushReview(job({ type: "review", legacy: { run: { column: "In Review" } } }), "/repo"),
    /Refusing to commit or push/,
  );
});

test("clean review requires staged changes before commit and push", async () => {
  const { capability } = fakeGit({ "branch --show-current": "flowboard/ticket-1\n" });
  await assert.rejects(
    capability.commitAndPushReview(job({ type: "review", legacy: { run: { column: "In Review" } } }), "/repo"),
    /no changes to commit/,
  );
});
