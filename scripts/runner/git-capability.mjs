export class GitCapability {
  constructor(commandCapability) {
    this.commands = commandCapability;
  }

  async git(workingDirectory, args) {
    const { stdout } = await this.commands.run(workingDirectory, "git", args);
    return stdout.trim();
  }

  async prepare(job, workingDirectory, workspace = {}) {
    const gitMode = job.persisted ? job.execution.git.mode
      : job.legacyKind === "column" ? (job.type === "development" ? "prepare_ticket_branch" : job.type === "review" ? "require_ticket_branch" : "none") : "none";
    if (gitMode === "none") return;
    if (workspace.isolated) {
      const actual = await this.git(workingDirectory, ["rev-parse", "HEAD"]);
      if (job.repositoryCandidate?.candidateSha && actual !== job.repositoryCandidate.candidateSha) throw new Error("The isolated workspace did not check out the assigned candidate SHA.");
      return;
    }
    const currentBranch = await this.git(workingDirectory, ["branch", "--show-current"]);
    const baseBranch = job.ticket.baseBranch || job.repository?.defaultBranch;
    if (!baseBranch) throw new Error("The ticket does not specify a base branch.");

    if (gitMode === "prepare_ticket_branch" && !job.ticket.findings?.trim()) {
      const status = await this.git(workingDirectory, ["status", "--porcelain"]);
      if (status) throw new Error("The repository has uncommitted changes; refusing to start a new ticket branch.");
      const ticketBranch = `flowboard/${job.ticket.id}`;
      const existingBranch = await this.git(workingDirectory, ["branch", "--list", ticketBranch]);
      await this.git(workingDirectory, ["switch", baseBranch]);
      await this.git(workingDirectory, existingBranch ? ["switch", ticketBranch] : ["switch", "-c", ticketBranch]);
      return;
    }

    if ((gitMode === "prepare_ticket_branch" || gitMode === "require_ticket_branch") && (!currentBranch || currentBranch === baseBranch)) {
      const label = job.persisted ? job.type : job.legacy.run.column;
      throw new Error(`The ${label} run requires an existing non-base ticket branch.`);
    }
  }

  async publishDevelopmentCandidate(job, workspace) {
    const workingDirectory = workspace.workingDirectory;
    const branch = workspace.branch || job.repositoryCandidate?.branch || `flowboard/${job.ticket.id}`;
    const marker = `Flowboard-Attempt: ${job.attempt.id}`;
    const currentMessage = await this.git(workingDirectory, ["log", "-1", "--format=%B"]);
    let candidateSha;
    if (currentMessage.includes(marker)) candidateSha = await this.git(workingDirectory, ["rev-parse", "HEAD"]);
    else {
      await this.git(workingDirectory, ["add", "--all"]);
      const staged = await this.git(workingDirectory, ["diff", "--cached", "--name-only"]);
      if (!staged) {
        if (job.repositoryCandidate?.sourceJobId === job.id) candidateSha = job.repositoryCandidate.candidateSha;
        else throw new Error("Development produced no changes for a durable candidate.");
      } else {
        await this.git(workingDirectory, ["commit", "-m", `${job.ticket.title}\n\nFlowboard-Job: ${job.id}\n${marker}`]);
        candidateSha = await this.git(workingDirectory, ["rev-parse", "HEAD"]);
      }
    }
    const changed = await this.git(workingDirectory, ["diff", "--name-only", `${workspace.baseSha}..${candidateSha}`]);
    const remoteRef = `refs/heads/${branch}`;
    await this.git(workingDirectory, ["push", "origin", `${candidateSha}:${remoteRef}`]);
    return {
      repositoryId: job.repository.id, branch, baseRef: workspace.baseRef, baseSha: workspace.baseSha, candidateSha,
      changedFiles: changed.split(/\r?\n/).filter(Boolean), published: true, remoteRef,
      sourceJobId: job.id, sourceAttemptId: job.attempt.id, predecessorCandidateId: job.repositoryCandidate?.id ?? null,
    };
  }

  async commitAndPushReview(job, workingDirectory) {
    const baseBranch = job.ticket.baseBranch || job.repository?.defaultBranch;
    const currentBranch = await this.git(workingDirectory, ["branch", "--show-current"]);
    if (!currentBranch || currentBranch === baseBranch) throw new Error("Refusing to commit or push the configured base branch.");
    const marker = `Flowboard-Job: ${job.id}`;
    const existing = await this.git(workingDirectory, ["log", "-n", "50", "--format=%H%x00%B%x00"]);
    const entries = existing.split("\0");
    for (let index = 0; index < entries.length - 1; index += 2) {
      if (entries[index + 1].includes(marker)) {
        await this.git(workingDirectory, ["push", "--set-upstream", "origin", "HEAD"]);
        return { commitSha: entries[index], reused: true };
      }
    }
    await this.git(workingDirectory, ["add", "--all"]);
    const stagedFiles = await this.git(workingDirectory, ["diff", "--cached", "--name-only"]);
    if (!stagedFiles) throw new Error("The clean review has no changes to commit.");
    await this.git(workingDirectory, ["commit", "-m", `${job.ticket.title}\n\n${marker}`]);
    await this.git(workingDirectory, ["push", "--set-upstream", "origin", "HEAD"]);
    return { commitSha: await this.git(workingDirectory, ["rev-parse", "HEAD"]), reused: false };
  }

  async describe(workingDirectory) {
    const [branch, status] = await Promise.all([
      this.git(workingDirectory, ["branch", "--show-current"]),
      this.git(workingDirectory, ["status", "--porcelain"]),
    ]);
    const changedFiles = status.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).split(" -> ").at(-1));
    return { branch, changedFiles };
  }
}
