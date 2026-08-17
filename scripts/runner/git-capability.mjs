export class GitCapability {
  constructor(commandCapability) {
    this.commands = commandCapability;
  }

  async git(workingDirectory, args) {
    const { stdout } = await this.commands.run(workingDirectory, "git", args);
    return stdout.trim();
  }

  async prepare(job, workingDirectory) {
    const gitMode = job.persisted ? job.execution.git.mode
      : job.legacyKind === "column" ? (job.type === "development" ? "prepare_ticket_branch" : job.type === "review" ? "require_ticket_branch" : "none") : "none";
    if (gitMode === "none") return;
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
