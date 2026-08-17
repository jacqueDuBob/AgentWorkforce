import { createJobResult } from "./contracts.mjs";
import { randomUUID } from "node:crypto";

export function reportsSuccessfulGitPush(response) {
  return /(?:^|\n)GIT_PUSH_SUCCEEDED\s*:\s*true(?:\n|$)/i.test(response || "");
}

export function parseAgentResult(job, invocation, { gitPushSucceeded = false, checks = [], repository, candidate } = {}) {
  if (invocation.structured) {
    const result = JSON.parse(invocation.finalResponse);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("The development agent returned an invalid structured result.");
    }
    if (job.type === "review") result.gitPushSucceeded = gitPushSucceeded;
    const questions = job.type === "development" && Array.isArray(result.questions) ? result.questions.filter((question) => typeof question === "string" && question.trim()) : [];
    const inputRequest = questions.length ? {
      version: 1, requestId: randomUUID(), jobId: job.id, attemptId: job.attempt?.id ?? "legacy-attempt",
      createdAt: new Date().toISOString(), questions: questions.slice(0, 10).map((prompt) => ({ id: randomUUID(), type: "text", prompt: prompt.trim(), options: [] })),
    } : undefined;
    return createJobResult(job, {
      outcome: inputRequest ? "needs_input" : undefined, inputRequest,
      agent: { provider: invocation.provider, threadId: invocation.threadId }, result, gitPushSucceeded, checks, repository, candidate,
    });
  }
  return createJobResult(job, {
    agent: { provider: invocation.provider, threadId: invocation.threadId },
    finalResponse: invocation.finalResponse,
    gitPushSucceeded: reportsSuccessfulGitPush(invocation.finalResponse),
    checks, repository, candidate,
  });
}

export function toLegacyFinishPayload(jobResult) {
  const threadId = jobResult.agent?.threadId;
  const canonical = { canonicalResult: jobResult, resultVersion: jobResult.version };
  return jobResult.result
    ? { ...canonical, result: jobResult.result, threadId, gitPushSucceeded: jobResult.git.pushSucceeded }
    : { ...canonical, finalResponse: jobResult.finalResponse, threadId, gitPushSucceeded: jobResult.git.pushSucceeded };
}
