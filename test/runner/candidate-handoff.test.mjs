import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GitCapability } from "../../scripts/runner/git-capability.mjs";
import { Runner } from "../../scripts/runner/runner.mjs";
import { FlowboardJobSource } from "../../scripts/runner/flowboard-job-source.mjs";
import { parseRepositoryCandidate } from "../../shared/job-contract.mjs";

const predecessor = {
  id: "candidate-a", version: 1, repositoryId: "repo-1", branch: "flowboard/ticket-1", baseRef: "main",
  baseSha: "a".repeat(40), candidateSha: "b".repeat(40), changedFiles: ["src/a.ts"], published: true,
  remoteRef: "refs/heads/flowboard/ticket-1", sourceJobId: "job-a", sourceAttemptId: "attempt-a",
};
const job = {
  id: "job-b", type: "development", ticket: { id: "ticket-1", title: "Correct implementation", baseBranch: "main" },
  repository: { id: "repo-1", owner: "acme", name: "app", defaultBranch: "main" }, repositoryCandidate: predecessor,
  attempt: { id: "attempt-b" }, prompt: "Correct the findings.", agent: { provider: "codex" }, persisted: false,
  permissions: { approvalPolicy: "never", networkAccess: false, repositoryAccess: "workspace-write" },
};

test("RepositoryCandidate validates authoritative Git handoff evidence", () => {
  assert.equal(parseRepositoryCandidate(predecessor).candidateSha, "b".repeat(40));
  assert.throws(() => parseRepositoryCandidate({ ...predecessor, changedFiles: "src/a.ts" }), /changedFiles/);
});

test("Development publication commits and pushes a correction from its predecessor", async () => {
  const calls = [];
  const candidateSha = "c".repeat(40);
  const outputs = {
    "log -1 --format=%B": "previous candidate", "diff --cached --name-only": "src/a.ts\n",
    "rev-parse HEAD": candidateSha, [`diff --name-only ${predecessor.baseSha}..${candidateSha}`]: "src/a.ts\n",
  };
  const git = new GitCapability({ run: async (_cwd, _exe, args) => { calls.push(args); return { stdout: outputs[args.join(" ")] ?? "" }; } });
  const candidate = await git.publishDevelopmentCandidate(job, {
    workingDirectory: "/attempt-b", baseRef: "main", baseSha: predecessor.baseSha, branch: predecessor.branch,
  });
  assert.equal(candidate.candidateSha, candidateSha);
  assert.equal(candidate.predecessorCandidateId, predecessor.id);
  assert.deepEqual(calls.at(-1), ["push", "origin", `${candidateSha}:refs/heads/${predecessor.branch}`]);
  assert.equal(calls.some((args) => args[0] === "commit" && args.at(-1).includes("Flowboard-Attempt: attempt-b")), true);
});

test("duplicate publication retry reuses the attempt commit", async () => {
  const calls = []; const candidateSha = "c".repeat(40);
  const outputs = { "log -1 --format=%B": "Flowboard-Attempt: attempt-b", "rev-parse HEAD": candidateSha, [`diff --name-only ${predecessor.baseSha}..${candidateSha}`]: "src/a.ts" };
  const git = new GitCapability({ run: async (_cwd, _exe, args) => { calls.push(args); return { stdout: outputs[args.join(" ")] ?? "" }; } });
  await git.publishDevelopmentCandidate(job, { workingDirectory: "/attempt-b", baseRef: "main", baseSha: predecessor.baseSha, branch: predecessor.branch });
  assert.equal(calls.some((args) => args[0] === "commit"), false);
  assert.equal(calls.filter((args) => args[0] === "push").length, 1);
});

test("Runner persists Development candidate before reporting completion and cleans workspace", async () => {
  const order = []; let completed;
  const published = { ...predecessor, id: "candidate-b", candidateSha: "c".repeat(40), sourceJobId: job.id, sourceAttemptId: job.attempt.id, predecessorCandidateId: predecessor.id };
  const runner = new Runner({
    jobSource: { publishCandidate: async () => { order.push("persist"); return published; }, complete: async (_id, payload) => { order.push("complete"); completed = payload; } },
    workspaceProvider: { provision: async () => ({ workingDirectory: "/attempt", branch: predecessor.branch, baseRef: "main", baseSha: predecessor.baseSha }), dispose: async () => order.push("dispose") },
    gitCapability: { prepare: async () => {}, describe: async () => ({ branch: predecessor.branch, changedFiles: ["src/a.ts"] }), publishDevelopmentCandidate: async () => ({ ...published, id: undefined }) },
    agentAdapter: { invoke: async () => ({ provider: "codex", threadId: "thread", structured: true, finalResponse: '{"summary":"done","questions":[],"proposals":[]}' }) },
  });
  await runner.execute(job);
  assert.deepEqual(order, ["persist","complete","dispose"]);
  assert.equal(completed.canonicalResult.git.candidate.id, "candidate-b");
});

test("Review consumes its bound candidate without invoking Git publication", async () => {
  let published = false; let completed;
  const runner = new Runner({
    jobSource: { complete: async (_id, payload) => { completed = payload; } },
    workspaceProvider: { provision: async () => ({ workingDirectory: "/fresh-review", branch: predecessor.branch }), dispose: async () => {} },
    gitCapability: { prepare: async () => {}, describe: async () => ({ branch: predecessor.branch, changedFiles: [] }), publishDevelopmentCandidate: async () => { published = true; } },
    agentAdapter: { invoke: async () => ({ provider: "codex", threadId: "review", structured: true, finalResponse: '{"findings":["Fix edge case"],"summary":"Changes requested"}' }) },
  });
  await runner.execute({ ...job, id: "review-job", type: "review", repositoryCandidate: predecessor, permissions: { ...job.permissions, repositoryAccess: "read-only" } });
  assert.equal(published, false);
  assert.equal(completed.canonicalResult.git.candidate.candidateSha, predecessor.candidateSha);
  assert.deepEqual(completed.result.findings, ["Fix edge case"]);
});

test("lost candidate publication response retries identical evidence", async () => {
  const bodies = [];
  const source = new FlowboardJobSource({ appUrl: "https://flowboard.test", workerToken: "token", capabilities: {}, fetchImplementation: async (_url, init) => {
    bodies.push(init.body); if (bodies.length === 1) throw new Error("response lost");
    return { status: 200, ok: true, json: async () => ({ candidate: { ...predecessor, id: "candidate-b" } }) };
  } });
  const result = await source.publishCandidate("job-b", "attempt-b", predecessor);
  assert.equal(result.id, "candidate-b");
  assert.equal(new Set(bodies).size, 1);
});

test("multiple correction cycles form an auditable predecessor chain", () => {
  const candidateB = { ...predecessor, id: "candidate-b", candidateSha: "c".repeat(40), predecessorCandidateId: predecessor.id };
  const candidateC = { ...candidateB, id: "candidate-c", candidateSha: "d".repeat(40), predecessorCandidateId: candidateB.id };
  assert.deepEqual([candidateB.predecessorCandidateId, candidateC.predecessorCandidateId], ["candidate-a", "candidate-b"]);
});

test("migration guards candidate head with attempt ownership and predecessor comparison", async () => {
  const sql = await readFile(new URL("../../supabase/migrations/024_repository_candidate_handoff.sql", import.meta.url), "utf8");
  assert.match(sql, /create table public\.repository_candidates/);
  assert.match(sql, /repository_candidate_id uuid/);
  assert.match(sql, /lease_until>now\(\)/);
  assert.match(sql, /head\.candidate_id is distinct from predecessor/);
  assert.match(sql, /Attempt was not based on the current candidate/);
  assert.match(sql, /unique\(source_attempt_id\)/);
});
