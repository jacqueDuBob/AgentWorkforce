import { access } from "node:fs/promises";
import path from "node:path";

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

export class LocalCheckoutWorkspaceProvider {
  constructor(repositoryMap, { lock = new RepositoryExecutionLock(), accessImplementation = access } = {}) {
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
    const release = await this.lock.acquire(key);
    try {
      const workingDirectory = path.resolve(configuredPath);
      await this.access(path.join(workingDirectory, ".git"));
      return { key, workingDirectory, release };
    } catch (cause) {
      release();
      throw cause;
    }
  }

  async dispose(workspace) {
    workspace?.release?.();
  }
}
