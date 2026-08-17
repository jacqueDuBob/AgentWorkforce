import { legacyRunToJobSpec } from "./contracts.mjs";

export class FlowboardJobSource {
  constructor({ appUrl, workerToken, fetchImplementation = fetch }) {
    this.appUrl = appUrl.replace(/\/$/, "");
    this.workerToken = workerToken;
    this.fetch = fetchImplementation;
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
    const legacyJob = await this.request("/api/worker/runs/claim", { method: "POST" });
    return legacyJob ? legacyRunToJobSpec(legacyJob) : null;
  }

  async complete(jobId, payload) {
    await this.request(`/api/worker/runs/${jobId}/finish`, { method: "POST", body: JSON.stringify(payload) });
  }
}
