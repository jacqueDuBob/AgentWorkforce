import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalCheckoutWorkspaceProvider, RepositoryExecutionLock } from "../../scripts/runner/local-checkout-workspace.mjs";

const job = { repository: { owner: "owner", name: "repo" } };

test("local workspace resolves only explicitly allowlisted repositories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "flowboard-workspace-"));
  await mkdir(path.join(root, ".git"));
  const provider = new LocalCheckoutWorkspaceProvider({ "owner/repo": root });
  const workspace = await provider.provision(job);
  assert.equal(workspace.workingDirectory, path.resolve(root));
  await provider.dispose(workspace);
  await assert.rejects(
    new LocalCheckoutWorkspaceProvider({}).provision(job),
    /No local path configured/,
  );
});

test("workspace releases its repository lock when validation fails", async () => {
  const lock = new RepositoryExecutionLock();
  const provider = new LocalCheckoutWorkspaceProvider({ "owner/repo": "/missing" }, {
    lock,
    accessImplementation: async () => { throw new Error("missing checkout"); },
  });
  await assert.rejects(provider.provision(job), /missing checkout/);
  const release = await lock.acquire("owner/repo");
  release();
});

test("repository execution lock serializes the same repository", async () => {
  const lock = new RepositoryExecutionLock();
  const firstRelease = await lock.acquire("owner/repo");
  let secondAcquired = false;
  const second = lock.acquire("owner/repo").then((release) => { secondAcquired = true; return release; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondAcquired, false);
  firstRelease();
  const secondRelease = await second;
  assert.equal(secondAcquired, true);
  secondRelease();
});

test("repository execution lock permits different repositories concurrently", async () => {
  const lock = new RepositoryExecutionLock();
  const firstRelease = await lock.acquire("owner/one");
  const secondRelease = await lock.acquire("owner/two");
  firstRelease();
  secondRelease();
});

test("read-only refinement attempts receive isolated disposable worktrees", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "flowboard-workspace-"));
  await mkdir(path.join(root, ".git"));
  const calls = [];
  const provider = new LocalCheckoutWorkspaceProvider({ "owner/repo": root }, { commandCapability: { run: async (_cwd, _git, args) => {
    calls.push(args); if (args[1] === "add") await writeFile(path.join(args[3], "README.md"), "snapshot"); return { stdout: "", stderr: "" };
  } } });
  const workspace = await provider.provision({ ...job, id: "job-1", type: "refinement", attempt: { id: "attempt-1" } });
  assert.equal(workspace.isolated, true);
  assert.notEqual(workspace.workingDirectory, root);
  await provider.dispose(workspace);
  await assert.rejects(access(workspace.workingDirectory));
  assert.deepEqual(calls.filter((args) => args[0] === "worktree").map((args) => args.slice(0, 2)), [["worktree","add"],["worktree","remove"]]);
});

test("Review provisions a fresh workspace at the exact assigned candidate SHA", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "flowboard-review-")); await mkdir(path.join(root, ".git"));
  const calls = []; const candidateSha = "c".repeat(40);
  const provider = new LocalCheckoutWorkspaceProvider({ "owner/repo": root }, { commandCapability: { run: async (_cwd, _git, args) => { calls.push(args); return { stdout: "" }; } } });
  const workspace = await provider.provision({
    ...job, id: "review", type: "review", ticket: { id: "ticket", baseBranch: "main" }, attempt: { id: "review-attempt" },
    repositoryCandidate: { candidateSha, baseSha: "a".repeat(40), baseRef: "main", branch: "flowboard/ticket" },
  });
  assert.equal(workspace.startRef, candidateSha);
  assert.equal(workspace.baseSha, "a".repeat(40));
  assert.equal(calls.find((args) => args[0] === "worktree" && args[1] === "add").at(-1), candidateSha);
  await provider.dispose(workspace);
});
