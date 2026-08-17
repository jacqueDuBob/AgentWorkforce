import { parseAgentResult, toLegacyFinishPayload } from "./result.mjs";

export class Runner {
  constructor({ jobSource, workspaceProvider, gitCapability, agentAdapter }) {
    this.jobSource = jobSource;
    this.workspaceProvider = workspaceProvider;
    this.git = gitCapability;
    this.agent = agentAdapter;
  }

  async execute(job) {
    let workspace;
    try {
      workspace = await this.workspaceProvider.provision(job);
      await this.git.prepare(job, workspace.workingDirectory);
      const invocation = await this.agent.invoke(job, workspace);
      let gitPushSucceeded = false;
      if (job.type === "review" && invocation.structured) {
        const preview = JSON.parse(invocation.finalResponse);
        if (Array.isArray(preview.findings) && preview.findings.length === 0) {
          await this.git.commitAndPushReview(job, workspace.workingDirectory);
          gitPushSucceeded = true;
        }
      }
      const result = parseAgentResult(job, invocation, { gitPushSucceeded });
      await this.jobSource.complete(job.id, toLegacyFinishPayload(result));
      return result;
    } finally {
      if (workspace) await this.workspaceProvider.dispose(workspace);
    }
  }
}
