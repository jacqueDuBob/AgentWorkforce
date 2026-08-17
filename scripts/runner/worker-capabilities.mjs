import { JOB_SPEC_VERSION, JOB_TYPES } from "../../shared/job-contract.mjs";

export const RUNNER_FEATURES = Object.freeze(["deterministic_verification", "execution_leases", "idempotent_completion"]);

const strings = (value, name) => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) throw new Error(`${name} must be an array of non-empty strings.`);
  return [...new Set(value)];
};

export function createWorkerCapabilities(repositories, overrides = {}) {
  return Object.freeze({
    jobSpecVersions: [JOB_SPEC_VERSION],
    jobTypes: [...JOB_TYPES],
    agentAdapters: ["codex"],
    workspaceProviders: ["local_checkout"],
    repositories: Object.keys(repositories ?? {}),
    features: [...RUNNER_FEATURES, "legacy_jobs"],
    ...overrides,
  });
}

export function parseWorkerCapabilities(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Worker capabilities must be an object.");
  const versions = value.jobSpecVersions;
  if (!Array.isArray(versions) || !versions.every((version) => Number.isInteger(version) && version > 0)) throw new Error("jobSpecVersions must contain positive integers.");
  return Object.freeze({
    jobSpecVersions: [...new Set(versions)],
    jobTypes: strings(value.jobTypes, "jobTypes"),
    agentAdapters: strings(value.agentAdapters, "agentAdapters"),
    workspaceProviders: strings(value.workspaceProviders, "workspaceProviders"),
    repositories: strings(value.repositories, "repositories"),
    features: strings(value.features, "features"),
  });
}

export function workerCanExecute(capabilities, jobSpec) {
  const repository = jobSpec.repository ? `${jobSpec.repository.owner}/${jobSpec.repository.name}` : null;
  return capabilities.jobSpecVersions.includes(jobSpec.version)
    && capabilities.jobTypes.includes(jobSpec.type)
    && capabilities.agentAdapters.includes(jobSpec.agent.provider)
    && capabilities.workspaceProviders.includes("local_checkout")
    && (!repository || capabilities.repositories.includes(repository))
    && (!jobSpec.execution.verificationPlan.checks.length || capabilities.features.includes("deterministic_verification"));
}
