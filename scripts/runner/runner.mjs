import { parseAgentResult, toLegacyFinishPayload } from "./result.mjs";
import { VerificationFailedError } from "./verification-executor.mjs";
import { randomUUID } from "node:crypto";

export class Runner {
  constructor({ jobSource, workspaceProvider, gitCapability, agentAdapter, verificationPlanProvider, verificationWorkspaceProvider, verificationExecutor }) {
    this.jobSource = jobSource;
    this.workspaceProvider = workspaceProvider;
    this.git = gitCapability;
    this.agent = agentAdapter;
    this.verificationPlans = verificationPlanProvider ?? { forJob: async () => ({ checks: [] }) };
    this.verificationWorkspaces = verificationWorkspaceProvider;
    this.verification = verificationExecutor;
  }

  async execute(job) {
    let workspace;
    let verificationWorkspace;
    try {
      workspace = await this.workspaceProvider.provision(job);
      await this.git.prepare(job, workspace.workingDirectory, workspace);
      const verificationPlan = job.persisted
        ? job.execution.verificationPlan
        : await this.verificationPlans.forJob(job, workspace.workingDirectory);
      const invocation = await this.agent.invoke(job, workspace);
      if (invocation.structured) {
        const preview = JSON.parse(invocation.finalResponse);
        if (job.type === "development" && Array.isArray(preview?.questions) && preview.questions.some((question) => typeof question === "string" && question.trim())) {
          const repository = this.git.describe ? await this.git.describe(workspace.workingDirectory) : undefined;
          const result = parseAgentResult(job, invocation, { checks: [], repository });
          await this.jobSource.complete(job.id, { ...toLegacyFinishPayload(result), attemptId: job.attempt?.id, completionId: randomUUID() });
          return result;
        }
      }
      let checks = [];
      if (verificationPlan.checks.length) {
        verificationWorkspace = await this.verificationWorkspaces.provision(workspace.workingDirectory, verificationPlan);
        checks = await this.verification.execute(verificationPlan, verificationWorkspace.workingDirectory);
      }
      const repository = this.git.describe ? await this.git.describe(workspace.workingDirectory) : undefined;
      if (repository && !repository.branch && workspace.branch) repository.branch = workspace.branch;
      let candidate = job.repositoryCandidate ?? undefined;
      let gitPushSucceeded = Boolean(candidate?.published);
      if (job.type === "development" && checks.every((check) => check.succeeded)) {
        candidate = await this.git.publishDevelopmentCandidate(job, workspace);
        candidate = await this.jobSource.publishCandidate(job.id, job.attempt.id, candidate);
        gitPushSucceeded = candidate.published;
      }
      const result = parseAgentResult(job, invocation, { gitPushSucceeded, checks, repository, candidate });
      if (result.outcome === "failed") throw new VerificationFailedError(result);
      await this.jobSource.complete(job.id, { ...toLegacyFinishPayload(result), attemptId: job.attempt?.id, completionId: randomUUID() });
      return result;
    } finally {
      try {
        if (verificationWorkspace) await this.verificationWorkspaces.dispose(verificationWorkspace);
      } finally {
        if (workspace) await this.workspaceProvider.dispose(workspace);
      }
    }
  }
}
