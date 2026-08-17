import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
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
