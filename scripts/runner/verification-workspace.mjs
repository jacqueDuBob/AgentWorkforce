import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export class VerificationWorkspaceProvider {
  constructor(commandCapability, fileSystem = { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile }) {
    this.commands = commandCapability;
    this.fs = fileSystem;
  }

  async provision(sourceDirectory, plan = { trustedPackageScripts: {} }) {
    const root = await this.fs.mkdtemp(path.join(os.tmpdir(), "flowboard-verification-"));
    try {
      const { stdout } = await this.commands.run(sourceDirectory, "git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
      const files = stdout.split("\0").filter(Boolean);
      for (const relativePath of files) {
        if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
          throw new Error(`Git returned an unsafe verification path: ${relativePath}`);
        }
        const source = path.join(sourceDirectory, relativePath);
        const destination = path.join(root, relativePath);
        await this.fs.mkdir(path.dirname(destination), { recursive: true });
        await this.fs.cp(source, destination, { recursive: true, dereference: false });
      }
      await this.linkDependencies(sourceDirectory, root, "node_modules");
      await this.pinTrustedPackageScripts(root, plan.trustedPackageScripts);
      return { workingDirectory: root };
    } catch (cause) {
      await this.fs.rm(root, { recursive: true, force: true });
      throw cause;
    }
  }

  async pinTrustedPackageScripts(verificationDirectory, trustedScripts = {}) {
    if (!Object.keys(trustedScripts).length) return;
    const packagePath = path.join(verificationDirectory, "package.json");
    const packageJson = JSON.parse(await this.fs.readFile(packagePath, "utf8"));
    packageJson.scripts = { ...(packageJson.scripts ?? {}), ...trustedScripts };
    await this.fs.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }

  async linkDependencies(sourceDirectory, verificationDirectory, name) {
    const source = path.join(sourceDirectory, name);
    try { await this.fs.lstat(source); }
    catch (cause) {
      if (cause?.code === "ENOENT") return;
      throw cause;
    }
    await this.fs.symlink(source, path.join(verificationDirectory, name), process.platform === "win32" ? "junction" : "dir");
  }

  async dispose(workspace) {
    if (workspace?.workingDirectory) await this.fs.rm(workspace.workingDirectory, { recursive: true, force: true });
  }
}
