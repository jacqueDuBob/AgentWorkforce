import { legacyRunToJobSpec } from "./contracts.mjs";
import { parseJobSpec } from "../../shared/job-contract.mjs";

export class FlowboardJobSource {
  constructor({ appUrl, workerToken, capabilities, fetchImplementation = fetch }) {
    this.appUrl = appUrl.replace(/\/$/, "");
    this.workerToken = workerToken;
    this.fetch = fetchImplementation;
    this.capabilities = capabilities;
  }

  async request(endpoint, init = {}) {
    const response = await this.fetch(`${this.appUrl}${endpoint}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.workerToken}`, "Content-Type": "application/json", ...init.headers },
    });
    if (response.status === 204) return null;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof body.error === "string" ? body.error
        : body.error ? JSON.stringify(body.error) : `Flowboard returned HTTP ${response.status}.`;
      throw new Error(detail);
    }
    return body;
  }

  async claim() {
    const legacyJob = await this.request("/api/worker/runs/claim", { method: "POST", body: JSON.stringify({ capabilities: this.capabilities }) });
    if (!legacyJob) return null;
    if (legacyJob.jobSpec) {
      const persisted = parseJobSpec(legacyJob.jobSpec);
      const resumeContext = Array.isArray(legacyJob.resumeContext) ? legacyJob.resumeContext : [];
      return Object.freeze({
        ...persisted,
        attempt: legacyJob.attempt,
        prompt: resumeContext.length
          ? `${persisted.prompt}\n\nResolved agent questions (use these answers to continue the work):\n${JSON.stringify(resumeContext)}`
          : persisted.prompt,
        persisted: true,
        legacy: legacyJob,
      });
    }
    return Object.freeze({ ...legacyRunToJobSpec(legacyJob), attempt: legacyJob.attempt });
  }

  async complete(jobId, payload) {
    await this.request(`/api/worker/runs/${jobId}/finish`, { method: "POST", body: JSON.stringify(payload) });
  }

  async heartbeat(jobId, attemptId, progress) {
    return this.request(`/api/worker/runs/${jobId}/heartbeat`, { method: "POST", body: JSON.stringify({ attemptId, progress }) });
  }
}
