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
  return permissionProfileForJobType(jobType) === "repository_read" ? profiles.repository_read : profiles.repository_write;
}

export function codexSandboxMode(job) {
  return job.permissions.repositoryAccess;
}

export { profiles as permissionProfiles };
import { permissionProfileForJobType } from "../../shared/job-contract.mjs";
