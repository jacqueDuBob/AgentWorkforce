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
      const error = new Error(detail); error.status = response.status; throw error;
    }
    return body;
  }

  async claim() {
    const legacyJob = await this.request("/api/worker/runs/claim", { method: "POST", body: JSON.stringify({ capabilities: this.capabilities }) });
    if (!legacyJob) return null;
    if (legacyJob.jobSpec) {
      const persisted = parseJobSpec(legacyJob.jobSpec);
      return Object.freeze({
        ...persisted,
        attempt: legacyJob.attempt,
        continuation: legacyJob.continuation ?? null,
        repositoryCandidate: legacyJob.repositoryCandidate ?? null,
        prompt: persisted.prompt,
        persisted: true,
        legacy: legacyJob,
      });
    }
    return Object.freeze({ ...legacyRunToJobSpec(legacyJob), attempt: legacyJob.attempt, continuation: legacyJob.continuation ?? null, repositoryCandidate: legacyJob.repositoryCandidate ?? null });
  }

  async complete(jobId, payload) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.request(`/api/worker/runs/${jobId}/finish`, { method: "POST", body: JSON.stringify(payload) });
        return;
      } catch (cause) {
        lastError = cause;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
    const error = new Error(`Could not deliver the job completion: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
    error.name = "CompletionDeliveryError";
    error.cause = lastError;
    throw error;
  }

  async heartbeat(jobId, attemptId, progress) {
    return this.request(`/api/worker/runs/${jobId}/heartbeat`, { method: "POST", body: JSON.stringify({ attemptId, progress }) });
  }

  async publishCandidate(jobId, attemptId, candidate) {
    let lastError;
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        const result = await this.request(`/api/worker/runs/${jobId}/candidate`, { method: "POST", body: JSON.stringify({ attemptId, candidate }) });
        return result.candidate;
      } catch (cause) {
        if (cause?.status === 409) { cause.name = "StaleCandidateError"; cause.failureClass = "configuration"; cause.retryable = false; throw cause; }
        lastError = cause;
        if (retry < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (retry + 1)));
      }
    }
    throw lastError;
  }
}
