export class GitCapability {
  constructor(commandCapability) {
    this.commands = commandCapability;
  }

  async git(workingDirectory, args) {
    const { stdout } = await this.commands.run(workingDirectory, "git", args);
    return stdout.trim();
  }

  async prepare(job, workingDirectory) {
    if (job.legacyKind !== "column") return;
    const currentBranch = await this.git(workingDirectory, ["branch", "--show-current"]);
    const baseBranch = job.ticket.baseBranch || job.repository?.defaultBranch;
    if (!baseBranch) throw new Error("The ticket does not specify a base branch.");

    if (job.type === "development" && !job.ticket.findings?.trim()) {
      const status = await this.git(workingDirectory, ["status", "--porcelain"]);
      if (status) throw new Error("The repository has uncommitted changes; refusing to start a new ticket branch.");
      const ticketBranch = `flowboard/${job.ticket.id}`;
      const existingBranch = await this.git(workingDirectory, ["branch", "--list", ticketBranch]);
      await this.git(workingDirectory, ["switch", baseBranch]);
      await this.git(workingDirectory, existingBranch ? ["switch", ticketBranch] : ["switch", "-c", ticketBranch]);
      return;
    }

    if ((job.type === "development" || job.type === "review") && (!currentBranch || currentBranch === baseBranch)) {
      throw new Error(`The ${job.legacy.run.column} run requires an existing non-base ticket branch.`);
    }
  }

  async commitAndPushReview(job, workingDirectory) {
    const baseBranch = job.ticket.baseBranch || job.repository?.defaultBranch;
    const currentBranch = await this.git(workingDirectory, ["branch", "--show-current"]);
    if (!currentBranch || currentBranch === baseBranch) throw new Error("Refusing to commit or push the configured base branch.");
    await this.git(workingDirectory, ["add", "--all"]);
    const stagedFiles = await this.git(workingDirectory, ["diff", "--cached", "--name-only"]);
    if (!stagedFiles) throw new Error("The clean review has no changes to commit.");
    await this.git(workingDirectory, ["commit", "-m", job.ticket.title]);
    await this.git(workingDirectory, ["push", "--set-upstream", "origin", "HEAD"]);
  }
}
