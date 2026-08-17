const profiles = Object.freeze({
  repository_read: Object.freeze({
    id: "repository_read", repositoryAccess: "read-only", gitMutation: "runner-only",
    networkAccess: false, approvalPolicy: "never",
  }),
  repository_write: Object.freeze({
    id: "repository_write", repositoryAccess: "workspace-write", gitMutation: "runner-only",
    networkAccess: false, approvalPolicy: "never",
  }),
});

export function permissionProfileFor(jobType) {
  return jobType === "refinement" || jobType === "epic_breakout" || jobType === "review"
    ? profiles.repository_read
    : profiles.repository_write;
}

// Review historically ran Codex in workspace-write so it could execute verification
// commands that create build output. Keep that compatibility until checks are runner-owned.
export function codexSandboxMode(job) {
  return job.type === "review" ? "workspace-write" : job.permissions.repositoryAccess;
}

export { profiles as permissionProfiles };
