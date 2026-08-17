export const JOB_SPEC_VERSION = 1;
export const JOB_RESULT_VERSION = 1;
export const HUMAN_INPUT_REQUEST_VERSION = 1;
export const JOB_TYPES = Object.freeze(["refinement", "development", "review", "testing", "epic_breakout", "deployment", "column"]);
export const PERMISSION_PROFILES = Object.freeze(["repository_read", "repository_write"]);
export const GIT_MODES = Object.freeze(["none", "prepare_ticket_branch", "require_ticket_branch"]);

const isObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const requiredString = (value, name) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value;
};
const assertOnlyKeys = (value, allowed, name) => {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`${name} contains unsupported fields: ${unexpected.join(", ")}.`);
};
const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

export function jobTypeForColumn(column) {
  if (column === "In Work") return "development";
  if (column === "In Review") return "review";
  if (column === "In Testing") return "testing";
  if (column === "In Deployment") return "deployment";
  return "column";
}

export function permissionProfileForJobType(type) {
  return type === "refinement" || type === "epic_breakout" || type === "review"
    ? "repository_read" : "repository_write";
}

export function gitModeForJobType(type) {
  return type === "development" ? "prepare_ticket_branch"
    : type === "review" ? "require_ticket_branch" : "none";
}

export function assertRepositoryAuthorization(access, repositoryId, allowedRepositoryIds = []) {
  if (!repositoryId) return;
  if (access === "all") return;
  if (access !== "selected" || !allowedRepositoryIds.includes(repositoryId)) throw new Error("The selected agent is not authorized for this repository.");
}

export function validateCheckDefinition(value) {
  if (!isObject(value)) throw new Error("Verification checks must be objects.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value.id ?? "")) throw new Error("Verification check IDs must be 1-80 safe characters.");
  requiredString(value.executable, `Verification check ${value.id} executable`);
  if (!Array.isArray(value.args) || !value.args.every((argument) => typeof argument === "string")) throw new Error(`Verification check ${value.id} args must be an array of strings.`);
  if (!Number.isInteger(value.timeoutMs) || value.timeoutMs < 100 || value.timeoutMs > 3_600_000) throw new Error(`Verification check ${value.id} timeoutMs must be between 100 and 3600000.`);
  return { id: value.id, executable: value.executable, args: [...value.args], timeoutMs: value.timeoutMs };
}

export function validateVerificationPlan(value) {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.checks)) throw new Error("VerificationPlan V1 is malformed.");
  const checks = value.checks.map(validateCheckDefinition);
  const ids = new Set();
  for (const check of checks) {
    if (ids.has(check.id)) throw new Error(`Verification check ID ${check.id} is duplicated.`);
    ids.add(check.id);
  }
  const trustedPackageScripts = isObject(value.trustedPackageScripts) ? Object.fromEntries(Object.entries(value.trustedPackageScripts).map(([key, script]) => {
    if (typeof script !== "string") throw new Error(`Trusted package script ${key} must be a string.`);
    return [key, script];
  })) : {};
  return { version: 1, checks, trustedPackageScripts };
}

export function parseJobSpec(value) {
  if (!isObject(value)) throw new Error("Persisted JobSpec must be an object.");
  assertOnlyKeys(value, ["version", "id", "type", "subtype", "ticket", "repository", "prompt", "agent", "permissions", "execution", "input"], "JobSpec V1");
  if (value.version !== JOB_SPEC_VERSION) throw new Error(`Unsupported JobSpec version: ${String(value.version)}.`);
  requiredString(value.id, "JobSpec id");
  if (!JOB_TYPES.includes(value.type)) throw new Error(`Unknown JobSpec job type: ${String(value.type)}.`);
  if (!isObject(value.ticket)) throw new Error("JobSpec ticket snapshot is required.");
  requiredString(value.ticket.id, "JobSpec ticket id");
  requiredString(value.ticket.title, "JobSpec ticket title");
  if (value.repository !== null && value.repository !== undefined) {
    if (!isObject(value.repository)) throw new Error("JobSpec repository must be an object or null.");
    assertOnlyKeys(value.repository, ["id", "owner", "name", "defaultBranch"], "JobSpec repository");
    requiredString(value.repository.id, "JobSpec repository id");
    requiredString(value.repository.owner, "JobSpec repository owner");
    requiredString(value.repository.name, "JobSpec repository name");
  }
  requiredString(value.prompt, "JobSpec prompt");
  if (!isObject(value.agent) || value.agent.provider !== "codex") throw new Error("JobSpec agent provider is invalid.");
  assertOnlyKeys(value.agent, ["provider", "name", "model"], "JobSpec agent");
  requiredString(value.agent.name, "JobSpec agent name");
  if (!isObject(value.permissions) || !PERMISSION_PROFILES.includes(value.permissions.profile)) throw new Error("JobSpec permission profile is invalid.");
  assertOnlyKeys(value.permissions, ["profile", "repositoryAccess", "gitMutation", "networkAccess", "approvalPolicy"], "JobSpec permissions");
  const expectedPermission = permissionProfileForJobType(value.type);
  if (value.permissions.profile !== expectedPermission) throw new Error(`JobSpec permission profile does not match ${value.type}.`);
  const expectedAccess = expectedPermission === "repository_read" ? "read-only" : "workspace-write";
  if (value.permissions.repositoryAccess !== expectedAccess || value.permissions.gitMutation !== "runner-only"
    || value.permissions.networkAccess !== false || value.permissions.approvalPolicy !== "never") throw new Error("JobSpec permission policy contains unsupported privileges.");
  if (!isObject(value.execution) || !isObject(value.execution.git) || !GIT_MODES.includes(value.execution.git.mode)) throw new Error("JobSpec Git execution policy is invalid.");
  assertOnlyKeys(value.execution, ["git", "verificationPlan"], "JobSpec execution policy");
  assertOnlyKeys(value.execution.git, ["mode"], "JobSpec Git policy");
  if (value.execution.git.mode !== gitModeForJobType(value.type)) throw new Error(`JobSpec Git policy does not match ${value.type}.`);
  const verificationPlan = validateVerificationPlan(value.execution.verificationPlan);
  return deepFreeze({
    ...value,
    ticket: { ...value.ticket },
    repository: value.repository ? { ...value.repository } : null,
    agent: { ...value.agent },
    permissions: { ...value.permissions },
    execution: { git: { ...value.execution.git }, verificationPlan },
  });
}

export function serializeJobSpec(value) {
  return JSON.parse(JSON.stringify(parseJobSpec(value)));
}

export function buildJobSpecV1(value) {
  if (!isObject(value)) throw new Error("JobSpec construction input must be an object.");
  const profile = permissionProfileForJobType(value.type);
  return parseJobSpec({
    version: 1,
    id: value.id,
    type: value.type,
    subtype: value.subtype,
    ticket: value.ticket,
    repository: value.repository ?? null,
    prompt: value.prompt,
    agent: value.agent,
    permissions: {
      profile,
      repositoryAccess: profile === "repository_read" ? "read-only" : "workspace-write",
      gitMutation: "runner-only",
      networkAccess: false,
      approvalPolicy: "never",
    },
    execution: {
      git: { mode: gitModeForJobType(value.type) },
      verificationPlan: value.verificationPlan,
    },
    input: value.input ?? {},
  });
}

export function parseJobResult(value) {
  if (!isObject(value)) throw new Error("Canonical JobResult must be an object.");
  if (value.version !== JOB_RESULT_VERSION) throw new Error(`Unsupported JobResult version: ${String(value.version)}.`);
  requiredString(value.jobId, "JobResult jobId");
  if (!JOB_TYPES.includes(value.jobType)) throw new Error("JobResult jobType is invalid.");
  if (!["succeeded", "failed", "needs_input"].includes(value.outcome)) throw new Error("JobResult outcome is invalid.");
  if (!Array.isArray(value.checks)) throw new Error("JobResult checks must be an array.");
  for (const check of value.checks) {
    if (!isObject(check) || typeof check.id !== "string" || !Array.isArray(check.command)
      || !(Number.isInteger(check.exitCode) || check.exitCode === null) || typeof check.succeeded !== "boolean"
      || typeof check.durationMs !== "number" || typeof check.stdout !== "string" || typeof check.stderr !== "string"
      || typeof check.timedOut !== "boolean") throw new Error("JobResult contains a malformed check result.");
  }
  if (!isObject(value.agent) || typeof value.agent.provider !== "string") throw new Error("JobResult agent metadata is invalid.");
  if (!isObject(value.git) || typeof value.git.pushSucceeded !== "boolean" || typeof value.git.branch !== "string"
    || !Array.isArray(value.git.changedFiles) || !value.git.changedFiles.every((file) => typeof file === "string")) throw new Error("JobResult Git metadata is invalid.");
  const candidate = value.git.candidate === undefined ? undefined : parseRepositoryCandidate(value.git.candidate);
  const inputRequest = value.outcome === "needs_input" ? parseHumanInputRequest(value.inputRequest) : value.inputRequest;
  return Object.freeze({ ...value, inputRequest, git: Object.freeze({ ...value.git, candidate }), checks: Object.freeze(value.checks.map((check) => Object.freeze({ ...check, command: Object.freeze([...check.command]) }))) });
}

export function parseRepositoryCandidate(value) {
  if (!isObject(value)) throw new Error("RepositoryCandidate is malformed.");
  for (const field of ["repositoryId","branch","baseRef","baseSha","candidateSha","sourceJobId","sourceAttemptId"]) requiredString(value[field], `RepositoryCandidate ${field}`);
  if (!Array.isArray(value.changedFiles) || !value.changedFiles.every((file) => typeof file === "string" && file.trim())) throw new Error("RepositoryCandidate changedFiles are invalid.");
  if (typeof value.published !== "boolean") throw new Error("RepositoryCandidate published must be boolean.");
  if (value.remoteRef !== undefined && typeof value.remoteRef !== "string") throw new Error("RepositoryCandidate remoteRef is invalid.");
  return Object.freeze({ ...value, changedFiles: Object.freeze([...value.changedFiles]) });
}

export function parseHumanInputRequest(value) {
  if (!isObject(value) || value.version !== HUMAN_INPUT_REQUEST_VERSION) throw new Error("HumanInputRequest V1 is malformed.");
  requiredString(value.requestId, "Human input requestId"); requiredString(value.jobId, "Human input jobId"); requiredString(value.attemptId, "Human input attemptId");
  if (!Array.isArray(value.questions) || !value.questions.length || value.questions.length > 10) throw new Error("Human input questions must contain 1-10 questions.");
  const ids = new Set();
  const questions = value.questions.map((question) => {
    if (!isObject(question) || !["text","yes_no","single_choice"].includes(question.type)) throw new Error("Human question type is invalid.");
    requiredString(question.id, "Human question id"); requiredString(question.prompt, "Human question prompt");
    if (ids.has(question.id)) throw new Error(`Human question ID ${question.id} is duplicated.`); ids.add(question.id);
    const options = question.options === undefined ? [] : question.options;
    if (!Array.isArray(options) || !options.every((option) => typeof option === "string" && option.trim())) throw new Error(`Human question ${question.id} options are invalid.`);
    if (question.type === "single_choice" && options.length < 2) throw new Error(`Human question ${question.id} requires choices.`);
    return Object.freeze({ id: question.id, type: question.type, prompt: question.prompt, options: Object.freeze([...options]) });
  });
  return Object.freeze({ version: 1, requestId: value.requestId, jobId: value.jobId, attemptId: value.attemptId, createdAt: requiredString(value.createdAt, "Human input createdAt"), questions: Object.freeze(questions) });
}

export function serializeJobResult(value) {
  return JSON.parse(JSON.stringify(parseJobResult(value)));
}
