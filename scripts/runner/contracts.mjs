import { mapLegacyJobSubtype, mapLegacyJobType } from "./job-types.mjs";
import { permissionProfileFor } from "./permissions.mjs";

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
    legacy: legacyJob,
  });
}

export function createJobResult(job, values) {
  return Object.freeze({
    version: 1,
    jobId: job.id,
    jobType: job.type,
    outcome: "succeeded",
    agent: values.agent,
    result: values.result,
    finalResponse: values.finalResponse,
    git: Object.freeze({ pushSucceeded: Boolean(values.gitPushSucceeded) }),
  });
}
