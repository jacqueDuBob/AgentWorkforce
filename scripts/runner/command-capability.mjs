import { execFile } from "node:child_process";
import { promisify } from "node:util";

export class CommandCapability {
  constructor(execute = promisify(execFile)) {
    this.execute = execute;
  }

  async run(workingDirectory, executable, args) {
    const result = await this.execute(executable, args, { cwd: workingDirectory });
    return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
  }
}
