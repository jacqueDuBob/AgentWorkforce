import { execFile } from "node:child_process";
import { promisify } from "node:util";

export class CommandCapability {
  constructor(execute = promisify(execFile)) {
    this.execute = execute;
  }

  async run(workingDirectory, executable, args, { timeoutMs, rejectOnError = true } = {}) {
    try {
      const result = await this.execute(executable, args, { cwd: workingDirectory, timeout: timeoutMs });
      return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? ""), exitCode: 0, timedOut: false };
    } catch (cause) {
      const timedOut = Boolean(cause?.killed && cause?.signal === "SIGTERM");
      if (rejectOnError) throw cause;
      return {
        stdout: String(cause?.stdout ?? ""), stderr: String(cause?.stderr ?? cause?.message ?? ""),
        exitCode: Number.isInteger(cause?.code) ? cause.code : null, timedOut,
      };
    }
  }
}
