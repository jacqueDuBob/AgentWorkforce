const summaryLimit = 8_000;

function summarize(value) {
  const text = String(value ?? "");
  return text.length <= summaryLimit ? text : `${text.slice(0, summaryLimit)}\n… output truncated`;
}

export class VerificationExecutor {
  constructor(commandCapability) {
    this.commands = commandCapability;
  }

  async execute(plan, workingDirectory) {
    const results = [];
    for (const check of plan.checks) {
      const started = Date.now();
      const command = [check.executable, ...check.args];
      try {
        const execution = await this.commands.run(workingDirectory, check.executable, check.args, {
          timeoutMs: check.timeoutMs,
          rejectOnError: false,
        });
        results.push(Object.freeze({
          id: check.id, command: Object.freeze(command), exitCode: execution.exitCode,
          succeeded: execution.exitCode === 0 && !execution.timedOut,
          durationMs: Date.now() - started, stdout: summarize(execution.stdout), stderr: summarize(execution.stderr),
          timedOut: execution.timedOut,
        }));
      } catch (cause) {
        results.push(Object.freeze({
          id: check.id, command: Object.freeze(command), exitCode: null, succeeded: false,
          durationMs: Date.now() - started, stdout: summarize(cause?.stdout), stderr: summarize(cause?.stderr || cause?.message),
          timedOut: Boolean(cause?.timedOut),
        }));
      }
    }
    return Object.freeze(results);
  }
}

export class VerificationFailedError extends Error {
  constructor(jobResult) {
    const failed = jobResult.checks.filter((check) => !check.succeeded).map((check) => check.id).join(", ");
    super(`Deterministic verification failed: ${failed}.`);
    this.name = "VerificationFailedError";
    this.jobResult = jobResult;
  }
}
