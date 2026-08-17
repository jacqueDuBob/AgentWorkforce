import type { JobSpecV1, JobType } from "../../shared/job-contract.mjs";

export interface WorkerCapabilities {
  jobSpecVersions: number[];
  jobTypes: JobType[];
  agentAdapters: string[];
  workspaceProviders: string[];
  repositories: string[];
  features: string[];
}

export const RUNNER_FEATURES: readonly string[];
export function createWorkerCapabilities(repositories: Record<string, string>, overrides?: Partial<WorkerCapabilities>): Readonly<WorkerCapabilities>;
export function parseWorkerCapabilities(value: unknown): Readonly<WorkerCapabilities>;
export function workerCanExecute(capabilities: WorkerCapabilities, jobSpec: JobSpecV1): boolean;
