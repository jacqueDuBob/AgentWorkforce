const supportedJobTypes = new Set(["development", "review", "testing"]);
const recognizedPackageScripts = ["lint", "typecheck", "type-check", "test", "build"];

export function validateCheckDefinition(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Verification checks must be objects.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value.id ?? "")) throw new Error("Verification check IDs must be 1-80 safe characters.");
  if (typeof value.executable !== "string" || !value.executable.trim() || value.executable.length > 200) {
    throw new Error(`Verification check ${value.id} requires an executable.`);
  }
  if (!Array.isArray(value.args) || !value.args.every((argument) => typeof argument === "string")) {
    throw new Error(`Verification check ${value.id} args must be an array of strings.`);
  }
  const timeoutMs = value.timeoutMs ?? 600_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 3_600_000) {
    throw new Error(`Verification check ${value.id} timeoutMs must be between 100 and 3600000.`);
  }
  const jobTypes = value.jobTypes ?? [...supportedJobTypes];
  if (!Array.isArray(jobTypes) || !jobTypes.length || !jobTypes.every((type) => supportedJobTypes.has(type))) {
    throw new Error(`Verification check ${value.id} has invalid jobTypes.`);
  }
  return Object.freeze({
    id: value.id,
    executable: value.executable,
    args: Object.freeze([...value.args]),
    timeoutMs,
    jobTypes: Object.freeze([...jobTypes]),
  });
}

export function createVerificationPlan(checks = [], { trustedPackageScripts = {} } = {}) {
  if (!Array.isArray(checks)) throw new Error("A verification plan must contain a checks array.");
  const validated = checks.map(validateCheckDefinition);
  const ids = new Set();
  for (const check of validated) {
    if (ids.has(check.id)) throw new Error(`Verification check ID ${check.id} is duplicated.`);
    ids.add(check.id);
  }
  return Object.freeze({
    version: 1,
    checks: Object.freeze(validated),
    trustedPackageScripts: Object.freeze({ ...trustedPackageScripts }),
  });
}

export function parseVerificationConfiguration(serialized) {
  if (!serialized?.trim()) return Object.freeze({});
  let parsed;
  try { parsed = JSON.parse(serialized); }
  catch { throw new Error("FLOWBOARD_VERIFICATION_PLANS must be valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("FLOWBOARD_VERIFICATION_PLANS must map owner/name to a verification plan.");
  }
  return Object.freeze(Object.fromEntries(Object.entries(parsed).map(([repository, plan]) => {
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) throw new Error(`Invalid verification repository key: ${repository}.`);
    const checks = Array.isArray(plan) ? plan : plan?.checks;
    return [repository, createVerificationPlan(checks)];
  })));
}

export class VerificationPlanProvider {
  constructor(configuredPlans = {}, { commandCapability } = {}) {
    this.configuredPlans = configuredPlans;
    this.commands = commandCapability;
  }

  async forJob(job, workingDirectory) {
    if (!supportedJobTypes.has(job.type)) return createVerificationPlan();
    const key = job.repository ? `${job.repository.owner}/${job.repository.name}` : "";
    const configured = this.configuredPlans[key];
    const plan = configured ?? await this.fromPackageJson(workingDirectory);
    return createVerificationPlan(plan.checks.filter((check) => check.jobTypes.includes(job.type)), {
      trustedPackageScripts: plan.trustedPackageScripts,
    });
  }

  async fromPackageJson(workingDirectory) {
    if (!this.commands) return createVerificationPlan();
    const committed = await this.commands.run(workingDirectory, "git", ["show", "HEAD:package.json"], { rejectOnError: false });
    if (committed.exitCode !== 0) return createVerificationPlan();
    let packageJson;
    try { packageJson = JSON.parse(committed.stdout); }
    catch (cause) { throw new Error("Could not parse trusted HEAD:package.json verification configuration.", { cause }); }
    const scripts = packageJson?.scripts;
    if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return createVerificationPlan();
    const selectedNames = recognizedPackageScripts.filter((name) => typeof scripts[name] === "string");
    return createVerificationPlan(selectedNames.map((name) => ({
      id: name === "type-check" ? "typecheck" : name,
      executable: "npm",
      args: ["run", name],
      timeoutMs: 600_000,
      jobTypes: [...supportedJobTypes],
    })), { trustedPackageScripts: Object.fromEntries(selectedNames.map((name) => [name, scripts[name]])) });
  }
}
