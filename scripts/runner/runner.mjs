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
      await this.git.prepare(job, workspace.workingDirectory);
      const verificationPlan = job.persisted
        ? job.execution.verificationPlan
        : await this.verificationPlans.forJob(job, workspace.workingDirectory);
      const invocation = await this.agent.invoke(job, workspace);
      let checks = [];
      if (verificationPlan.checks.length) {
        verificationWorkspace = await this.verificationWorkspaces.provision(workspace.workingDirectory, verificationPlan);
        checks = await this.verification.execute(verificationPlan, verificationWorkspace.workingDirectory);
      }
      const repository = this.git.describe ? await this.git.describe(workspace.workingDirectory) : undefined;
      let gitPushSucceeded = false;
      if (job.type === "review" && invocation.structured && checks.every((check) => check.succeeded)) {
        const preview = JSON.parse(invocation.finalResponse);
        if (Array.isArray(preview.findings) && preview.findings.length === 0) {
          await this.git.commitAndPushReview(job, workspace.workingDirectory);
          gitPushSucceeded = true;
        }
      }
      const result = parseAgentResult(job, invocation, { gitPushSucceeded, checks, repository });
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
