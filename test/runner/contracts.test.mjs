import assert from "node:assert/strict";
import test from "node:test";
import { legacyRunToJobSpec } from "../../scripts/runner/contracts.mjs";
import { codexSandboxMode, permissionProfileFor } from "../../scripts/runner/permissions.mjs";

function legacyJob(run = {}) {
  return {
    run: { id: "run-1", kind: "column", column: "In Work", agentName: "Developer", modelName: "model", renderedPrompt: "Do work", ...run },
    ticket: { id: "ticket-1", title: "Ticket", findings: "", baseBranch: "main" },
    repository: { owner: "owner", name: "repo", defaultBranch: "main" },
  };
}

test("maps legacy runs to canonical JobSpec job types", () => {
  assert.equal(legacyRunToJobSpec(legacyJob()).type, "development");
  assert.equal(legacyRunToJobSpec(legacyJob({ column: "In Review" })).type, "review");
  assert.equal(legacyRunToJobSpec(legacyJob({ column: "In Testing" })).type, "testing");
  const refinement = legacyRunToJobSpec(legacyJob({ kind: "refinement_rewrite", column: "In Refinement" }));
  assert.equal(refinement.type, "refinement");
  assert.equal(refinement.subtype, "rewrite");
  assert.equal(refinement.prompt, "Do work");
  assert.equal(refinement.agent.provider, "codex");
});

test("rejects incomplete legacy jobs", () => {
  assert.throws(() => legacyRunToJobSpec({}), /run ID/);
});

test("central permission profiles are explicit and immutable", () => {
  assert.equal(permissionProfileFor("refinement").repositoryAccess, "read-only");
  assert.equal(permissionProfileFor("review").repositoryAccess, "read-only");
  assert.equal(permissionProfileFor("development").repositoryAccess, "workspace-write");
  assert.equal(permissionProfileFor("testing").networkAccess, false);
  assert.equal(Object.isFrozen(permissionProfileFor("review")), true);
});

test("Codex sandbox gives review true read-only access", () => {
  const review = legacyRunToJobSpec(legacyJob({ column: "In Review" }));
  const refinement = legacyRunToJobSpec(legacyJob({ kind: "refinement_questions", column: "In Refinement" }));
  assert.equal(codexSandboxMode(review), "read-only");
  assert.equal(codexSandboxMode(refinement), "read-only");
});
