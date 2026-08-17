import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";

export class RepositoryExecutionLock {
  constructor() {
    this.tails = new Map();
  }

  async acquire(key) {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let releaseCurrent;
    const current = new Promise((resolve) => { releaseCurrent = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseCurrent();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    };
  }
}

export class FileRepositoryExecutionLock {
  constructor({ retryMs = 100, timeoutMs = 30_000, processId = process.pid } = {}) {
    this.retryMs = retryMs;
    this.timeoutMs = timeoutMs;
    this.processId = processId;
  }

  async acquire(key, workingDirectory) {
    const dotGit = path.join(workingDirectory, ".git");
    let gitPath = dotGit;
    try {
      const pointer = await readFile(dotGit, "utf8");
      const match = /^gitdir:\s*(.+)\s*$/i.exec(pointer);
      if (match) gitPath = path.resolve(workingDirectory, match[1]);
    } catch (cause) {
      if (cause?.code !== "EISDIR") throw cause;
    }
    const lockRoot = path.join(gitPath, "flowboard-locks");
    const lockPath = path.join(lockRoot, createHash("sha256").update(key).digest("hex"));
    await mkdir(lockRoot, { recursive: true });
    const started = Date.now();
    for (;;) {
      try {
        await mkdir(lockPath);
        await writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ pid: this.processId, createdAt: new Date().toISOString() }), { flag: "wx" });
        let released = false;
        return async () => {
          if (released) return;
          released = true;
          await rm(lockPath, { recursive: true, force: true });
        };
      } catch (cause) {
        if (cause?.code !== "EEXIST") throw cause;
        const stale = await this.isStale(lockPath);
        if (stale) { await rm(lockPath, { recursive: true, force: true }); continue; }
        if (Date.now() - started >= this.timeoutMs) throw new Error(`Timed out waiting for repository execution lock ${key}.`);
        await new Promise((resolve) => setTimeout(resolve, this.retryMs));
      }
    }
  }

  async isStale(lockPath) {
    try {
      const owner = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
      if (!Number.isInteger(owner.pid)) return true;
      try { process.kill(owner.pid, 0); return false; } catch (cause) { return cause?.code === "ESRCH"; }
    } catch { return true; }
  }
}

export class LocalCheckoutWorkspaceProvider {
  constructor(repositoryMap, { lock = new FileRepositoryExecutionLock(), accessImplementation = access, commandCapability } = {}) {
    if (!repositoryMap || typeof repositoryMap !== "object" || Array.isArray(repositoryMap)) {
      throw new Error("FLOWBOARD_REPOSITORIES must map owner/name to a local path.");
    }
    this.repositories = repositoryMap;
    this.lock = lock;
    this.access = accessImplementation;
    this.commands = commandCapability;
  }

  async provision(job) {
    const key = job.repository ? `${job.repository.owner}/${job.repository.name}` : "";
    const configuredPath = key ? this.repositories[key] : "";
    if (typeof configuredPath !== "string" || !configuredPath) {
      throw new Error(`No local path configured for repository ${key || "(none)"}.`);
    }
    const workingDirectory = path.resolve(configuredPath);
    const release = await this.lock.acquire(key, workingDirectory);
    try {
      await this.access(path.join(workingDirectory, ".git"));
      if (["refinement", "epic_breakout", "development", "review", "testing"].includes(job.type) && this.commands) {
        const isolatedDirectory = await mkdtemp(path.join(os.tmpdir(), `flowboard-attempt-${job.attempt?.id ?? job.id}-`));
        try {
          const baseRef = job.repositoryCandidate?.baseRef || job.ticket?.baseBranch || job.repository?.defaultBranch || "HEAD";
          const startRef = job.repositoryCandidate?.candidateSha || baseRef;
          const baseSha = job.repositoryCandidate?.baseSha || (await this.commands.run(workingDirectory, "git", ["rev-parse", baseRef])).stdout.trim();
          if (job.repositoryCandidate?.remoteRef) {
            await this.commands.run(workingDirectory, "git", ["fetch", "origin", job.repositoryCandidate.remoteRef]);
          }
          await this.commands.run(workingDirectory, "git", ["worktree", "add", "--detach", isolatedDirectory, startRef]);
          await release();
          return {
            key, workingDirectory: isolatedDirectory, sourceWorkingDirectory: workingDirectory, isolated: true,
            baseRef, baseSha, startRef, branch: job.repositoryCandidate?.branch || `flowboard/${job.ticket?.id ?? job.id}`,
          };
        } catch (cause) {
          await rm(isolatedDirectory, { recursive: true, force: true });
          throw cause;
        }
      }
      return { key, workingDirectory, release };
    } catch (cause) {
      release();
      throw cause;
    }
  }

  async dispose(workspace) {
    if (workspace?.isolated) {
      try { await this.commands.run(workspace.sourceWorkingDirectory, "git", ["worktree", "remove", "--force", workspace.workingDirectory]); }
      finally { await rm(workspace.workingDirectory, { recursive: true, force: true }); }
      return;
    }
    await workspace?.release?.();
  }
}
