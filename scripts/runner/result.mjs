import { createJobResult } from "./contracts.mjs";

export function reportsSuccessfulGitPush(response) {
  return /(?:^|\n)GIT_PUSH_SUCCEEDED\s*:\s*true(?:\n|$)/i.test(response || "");
}

export function parseAgentResult(job, invocation, { gitPushSucceeded = false, checks = [], repository } = {}) {
  if (invocation.structured) {
    const result = JSON.parse(invocation.finalResponse);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("The development agent returned an invalid structured result.");
    }
    if (job.type === "review") result.gitPushSucceeded = gitPushSucceeded;
    return createJobResult(job, {
      agent: { provider: invocation.provider, threadId: invocation.threadId }, result, gitPushSucceeded, checks, repository,
    });
  }
  return createJobResult(job, {
    agent: { provider: invocation.provider, threadId: invocation.threadId },
    finalResponse: invocation.finalResponse,
    gitPushSucceeded: reportsSuccessfulGitPush(invocation.finalResponse),
    checks, repository,
  });
}

export function toLegacyFinishPayload(jobResult) {
  const threadId = jobResult.agent?.threadId;
  const canonical = { canonicalResult: jobResult, resultVersion: jobResult.version };
  return jobResult.result
    ? { ...canonical, result: jobResult.result, threadId, gitPushSucceeded: jobResult.git.pushSucceeded }
    : { ...canonical, finalResponse: jobResult.finalResponse, threadId, gitPushSucceeded: jobResult.git.pushSucceeded };
}
