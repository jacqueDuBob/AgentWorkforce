import { CodexDevelopmentAgentAdapter } from "./runner/codex-adapter.mjs";
import { CommandCapability } from "./runner/command-capability.mjs";
import { FlowboardJobSource } from "./runner/flowboard-job-source.mjs";
import { GitCapability } from "./runner/git-capability.mjs";
import { LocalCheckoutWorkspaceProvider } from "./runner/local-checkout-workspace.mjs";
import { Runner } from "./runner/runner.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function createRunnerWorker({ appUrl, workerToken, repositories, codex, fetchImplementation }) {
  const jobSource = new FlowboardJobSource({ appUrl, workerToken, fetchImplementation });
  return {
    jobSource,
    runner: new Runner({
      jobSource,
      workspaceProvider: new LocalCheckoutWorkspaceProvider(repositories),
      gitCapability: new GitCapability(new CommandCapability()),
      agentAdapter: new CodexDevelopmentAgentAdapter(codex),
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
        try {
          await runner.execute(job);
          console.log(`[finished] ${job.ticket.title}`);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Local Codex run failed.";
          await jobSource.complete(job.id, { error: message }).catch(() => {});
          console.error(`[failed] ${job.ticket.title}: ${message}`);
        }
      }
    } catch (cause) {
      console.error(cause instanceof Error ? cause.message : cause);
      await delay(Math.max(configuration.pollInterval, 5000));
    }
  }
}
