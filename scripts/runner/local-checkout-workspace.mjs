import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

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
    const gitPath = path.join(workingDirectory, ".git");
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
  constructor(repositoryMap, { lock = new FileRepositoryExecutionLock(), accessImplementation = access } = {}) {
    if (!repositoryMap || typeof repositoryMap !== "object" || Array.isArray(repositoryMap)) {
      throw new Error("FLOWBOARD_REPOSITORIES must map owner/name to a local path.");
    }
    this.repositories = repositoryMap;
    this.lock = lock;
    this.access = accessImplementation;
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
      return { key, workingDirectory, release };
    } catch (cause) {
      release();
      throw cause;
    }
  }

  async dispose(workspace) {
    await workspace?.release?.();
  }
}
