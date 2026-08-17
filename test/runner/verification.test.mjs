import assert from "node:assert/strict";
import test from "node:test";
import { CommandCapability } from "../../scripts/runner/command-capability.mjs";
import { VerificationExecutor } from "../../scripts/runner/verification-executor.mjs";
import { createVerificationPlan, parseVerificationConfiguration, VerificationPlanProvider } from "../../scripts/runner/verification-plan.mjs";

const developmentJob = { type: "development", repository: { owner: "owner", name: "repo" } };

test("trusted package scripts produce a deterministic verification plan", async () => {
  const provider = new VerificationPlanProvider({}, { commandCapability: { run: async (_cwd, executable, args) => {
    assert.deepEqual([executable, ...args], ["git", "show", "HEAD:package.json"]);
    return { stdout: JSON.stringify({ scripts: { dev: "next dev", lint: "eslint .", test: "node --test", build: "next build", arbitrary: "danger" } }), exitCode: 0 };
  } } });
  const plan = await provider.forJob(developmentJob, "/repo");
  assert.deepEqual(plan.checks.map((check) => [check.id, check.executable, check.args]), [
    ["lint", "npm", ["run", "lint"]], ["test", "npm", ["run", "test"]], ["build", "npm", ["run", "build"]],
  ]);
  assert.equal(plan.trustedPackageScripts.test, "node --test");
});

test("automatic plans ignore mutable working-tree package scripts", async () => {
  const provider = new VerificationPlanProvider({}, { commandCapability: { run: async () => ({
    stdout: JSON.stringify({ scripts: { test: "trusted committed test" } }), exitCode: 0,
  }) } });
  const plan = await provider.forJob(developmentJob, "/repo");
  assert.deepEqual(plan.checks[0].args, ["run", "test"]);
  assert.equal(plan.trustedPackageScripts.test, "trusted committed test");
});

test("application verification configuration rejects invalid commands and duplicate IDs", () => {
  assert.throws(() => createVerificationPlan([{ id: "bad", executable: "npm", args: "test" }]), /array of strings/);
  assert.throws(() => createVerificationPlan([
    { id: "same", executable: "npm", args: ["test"] },
    { id: "same", executable: "npm", args: ["run", "test"] },
  ]), /duplicated/);
  assert.throws(() => parseVerificationConfiguration("not json"), /valid JSON/);
  assert.throws(() => parseVerificationConfiguration(JSON.stringify({ repo: [] })), /repository key/);
});

test("configured checks are filtered by job type", async () => {
  const plans = parseVerificationConfiguration(JSON.stringify({ "owner/repo": { checks: [
    { id: "review", executable: "npm", args: ["test"], jobTypes: ["review"] },
    { id: "development", executable: "npm", args: ["run", "lint"], jobTypes: ["development"] },
  ] } }));
  const plan = await new VerificationPlanProvider(plans).forJob(developmentJob, "/repo");
  assert.deepEqual(plan.checks.map((check) => check.id), ["development"]);
});

test("verification executor captures successful and failed checks in order", async () => {
  const calls = [];
  const executor = new VerificationExecutor({ run: async (_cwd, executable, args) => {
    calls.push([executable, ...args]);
    return args.at(-1) === "lint"
      ? { stdout: "clean", stderr: "", exitCode: 0, timedOut: false }
      : { stdout: "", stderr: "tests failed", exitCode: 2, timedOut: false };
  } });
  const plan = createVerificationPlan([
    { id: "lint", executable: "npm", args: ["run", "lint"] },
    { id: "test", executable: "npm", args: ["run", "test"] },
  ]);
  const results = await executor.execute(plan, "/verification");
  assert.deepEqual(calls, [["npm", "run", "lint"], ["npm", "run", "test"]]);
  assert.equal(results[0].succeeded, true);
  assert.equal(results[0].exitCode, 0);
  assert.equal(results[1].succeeded, false);
  assert.equal(results[1].exitCode, 2);
  assert.equal(results[1].stderr, "tests failed");
});

test("CommandCapability captures timeout without throwing for verification", async () => {
  const timeout = Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM", stdout: "partial", stderr: "timeout" });
  const commands = new CommandCapability(async () => { throw timeout; });
  const result = await commands.run("/repo", "npm", ["test"], { timeoutMs: 100, rejectOnError: false });
  assert.equal(result.exitCode, null);
  assert.equal(result.timedOut, true);
  assert.equal(result.stdout, "partial");
});

test("verification executor records timeout state and duration", async () => {
  const executor = new VerificationExecutor({ run: async () => ({ stdout: "partial", stderr: "timeout", exitCode: null, timedOut: true }) });
  const [result] = await executor.execute(createVerificationPlan([{ id: "test", executable: "npm", args: ["test"], timeoutMs: 100 }]), "/repo");
  assert.equal(result.succeeded, false);
  assert.equal(result.timedOut, true);
  assert.equal(typeof result.durationMs, "number");
});
