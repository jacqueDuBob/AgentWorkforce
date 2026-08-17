import { runWorker } from "./runner-worker.mjs";
import { parseVerificationConfiguration } from "./runner/verification-plan.mjs";

const appUrl = (process.env.FLOWBOARD_URL || "").replace(/\/$/, "");
const workerToken = process.env.FLOWBOARD_WORKER_TOKEN || "";
const pollInterval = Number(process.env.FLOWBOARD_POLL_INTERVAL_MS || 5000);

if (!appUrl || !workerToken) {
  console.error("Set FLOWBOARD_URL and FLOWBOARD_WORKER_TOKEN before starting the worker.");
  process.exit(1);
}

let repositories;
try { repositories = JSON.parse(process.env.FLOWBOARD_REPOSITORIES || "{}"); }
catch { throw new Error("FLOWBOARD_REPOSITORIES must map owner/name to a local path."); }

const verificationPlans = parseVerificationConfiguration(process.env.FLOWBOARD_VERIFICATION_PLANS || "");

await runWorker({ appUrl, workerToken, pollInterval, repositories, verificationPlans });
