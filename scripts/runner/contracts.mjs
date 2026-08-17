import { mapLegacyJobSubtype, mapLegacyJobType } from "./job-types.mjs";
import { permissionProfileFor } from "./permissions.mjs";
import { parseJobResult } from "../../shared/job-contract.mjs";

export function legacyRunToJobSpec(legacyJob) {
  if (!legacyJob || typeof legacyJob !== "object") throw new Error("The claimed job is invalid.");
  if (!legacyJob.run?.id) throw new Error("The claimed job does not contain a run ID.");
  if (!legacyJob.ticket?.id) throw new Error("The claimed job does not contain a ticket.");
  const type = mapLegacyJobType(legacyJob.run);
  return Object.freeze({
    version: 1,
    id: legacyJob.run.id,
    type,
    subtype: mapLegacyJobSubtype(legacyJob.run),
    legacyKind: legacyJob.run.kind || "column",
    ticket: legacyJob.ticket,
    repository: legacyJob.repository,
    prompt: legacyJob.run.renderedPrompt,
    input: legacyJob.run.input ?? {},
    agent: Object.freeze({
      provider: "codex",
      name: legacyJob.run.agentName,
      model: legacyJob.run.modelName || undefined,
    }),
    permissions: permissionProfileFor(type),
    persisted: false,
    legacy: legacyJob,
  });
}

export function createJobResult(job, values) {
  const checks = Object.freeze([...(values.checks ?? [])]);
  return parseJobResult({
    version: 1,
    jobId: job.id,
    jobType: job.type,
    outcome: values.outcome ?? (checks.every((check) => check.succeeded) ? "succeeded" : "failed"),
    agent: values.agent,
    result: values.result,
    finalResponse: values.finalResponse,
    git: Object.freeze({
      pushSucceeded: Boolean(values.gitPushSucceeded),
      branch: values.repository?.branch ?? "",
      changedFiles: Object.freeze([...(values.repository?.changedFiles ?? [])]),
      candidate: values.candidate,
    }),
    checks,
    error: values.error,
    inputRequest: values.inputRequest,
  });
}

export function createFailedJobResult(job, cause) {
  return createJobResult(job, {
    outcome: "failed", agent: { provider: job.agent.provider }, checks: [], gitPushSucceeded: false,
    error: { code: cause?.name || "ExecutionError", message: cause instanceof Error ? cause.message : "Runner execution failed." },
  });
}
