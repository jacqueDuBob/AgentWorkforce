import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VerificationWorkspaceProvider } from "../../scripts/runner/verification-workspace.mjs";

test("verification workspace isolates generated writes from source and cleans up", async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), "flowboard-source-"));
  await mkdir(path.join(source, "src"));
  await writeFile(path.join(source, "src", "index.js"), "source");
  const provider = new VerificationWorkspaceProvider({
    run: async () => ({ stdout: "src/index.js\0", stderr: "", exitCode: 0, timedOut: false }),
  });
  const workspace = await provider.provision(source);
  await writeFile(path.join(workspace.workingDirectory, "src", "index.js"), "generated");
  assert.equal(await readFile(path.join(source, "src", "index.js"), "utf8"), "source");
  const verificationPath = workspace.workingDirectory;
  await provider.dispose(workspace);
  await assert.rejects(access(verificationPath));
});

test("verification workspace pins trusted package scripts over agent changes", async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), "flowboard-source-"));
  await writeFile(path.join(source, "package.json"), JSON.stringify({ scripts: { test: "agent command" } }));
  const provider = new VerificationWorkspaceProvider({
    run: async () => ({ stdout: "package.json\0", stderr: "", exitCode: 0, timedOut: false }),
  });
  const workspace = await provider.provision(source, { trustedPackageScripts: { test: "trusted command" } });
  const packageJson = JSON.parse(await readFile(path.join(workspace.workingDirectory, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.test, "trusted command");
  assert.equal(JSON.parse(await readFile(path.join(source, "package.json"), "utf8")).scripts.test, "agent command");
  await provider.dispose(workspace);
});
