import { CodexDevelopmentAgentAdapter } from "./runner/codex-adapter.mjs";
import { CommandCapability } from "./runner/command-capability.mjs";
import { FlowboardJobSource } from "./runner/flowboard-job-source.mjs";
import { GitCapability } from "./runner/git-capability.mjs";
import { LocalCheckoutWorkspaceProvider } from "./runner/local-checkout-workspace.mjs";
import { Runner } from "./runner/runner.mjs";
import { createFailedJobResult } from "./runner/contracts.mjs";
import { VerificationExecutor } from "./runner/verification-executor.mjs";
import { VerificationPlanProvider } from "./runner/verification-plan.mjs";
import { VerificationWorkspaceProvider } from "./runner/verification-workspace.mjs";
import { createWorkerCapabilities } from "./runner/worker-capabilities.mjs";
import { classifyFailure } from "./runner/failures.mjs";
import { randomUUID } from "node:crypto";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function createRunnerWorker({ appUrl, workerToken, repositories, verificationPlans = {}, codex, fetchImplementation }) {
  const capabilities = createWorkerCapabilities(repositories);
  const jobSource = new FlowboardJobSource({ appUrl, workerToken, capabilities, fetchImplementation });
  const commandCapability = new CommandCapability();
  return {
    jobSource,
    runner: new Runner({
      jobSource,
      workspaceProvider: new LocalCheckoutWorkspaceProvider(repositories),
      gitCapability: new GitCapability(commandCapability),
      agentAdapter: new CodexDevelopmentAgentAdapter(codex),
      verificationPlanProvider: new VerificationPlanProvider(verificationPlans, { commandCapability }),
      verificationWorkspaceProvider: new VerificationWorkspaceProvider(commandCapability),
      verificationExecutor: new VerificationExecutor(commandCapability),
    }),
  };
}

export async function runWorker(configuration) {
  const { jobSource, runner } = createRunnerWorker(configuration);
  console.log(`Flowboard Codex worker polling ${configuration.appUrl}`);
  for (;;) {
    try {
      const job = await jobSource.claim();
      if (!job) await delay(configuration.pollInterval);
      else {
        console.log(`[claimed] ${job.ticket.title}`);
        let heartbeat;
        try {
          if (job.attempt?.id) heartbeat = setInterval(() => {
            jobSource.heartbeat(job.id, job.attempt.id, { phase: "executing" }).catch((cause) => console.error(`[heartbeat] ${cause.message}`));
          }, configuration.heartbeatInterval ?? 30_000);
          await runner.execute(job);
          console.log(`[finished] ${job.ticket.title}`);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Local Codex run failed.";
          const canonicalResult = cause?.jobResult ?? createFailedJobResult(job, cause);
          const failure = classifyFailure(cause);
          await jobSource.complete(job.id, { attemptId: job.attempt?.id, completionId: randomUUID(), error: message, ...failure, resultVersion: canonicalResult.version, canonicalResult }).catch(() => {});
          console.error(`[failed] ${job.ticket.title}: ${message}`);
        } finally {
          if (heartbeat) clearInterval(heartbeat);
        }
      }
    } catch (cause) {
      console.error(cause instanceof Error ? cause.message : cause);
      await delay(Math.max(configuration.pollInterval, 5000));
    }
  }
}
