export type JobType = "refinement" | "development" | "review" | "testing" | "epic_breakout" | "deployment" | "column";
export type PermissionProfile = "repository_read" | "repository_write";
export type GitMode = "none" | "prepare_ticket_branch" | "require_ticket_branch";
export interface CheckDefinition { id: string; executable: string; args: string[]; timeoutMs: number; }
export interface VerificationPlanV1 { version: 1; checks: CheckDefinition[]; trustedPackageScripts: Record<string, string>; }
export interface JobSpecV1 {
  version: 1; id: string; type: JobType; subtype?: string;
  ticket: Record<string, unknown> & { id: string; title: string; baseBranch?: string; findings?: string };
  repository: null | { id: string; owner: string; name: string; defaultBranch: string };
  prompt: string; agent: { provider: "codex"; name: string; model?: string };
  permissions: { profile: PermissionProfile; repositoryAccess: "read-only" | "workspace-write"; gitMutation: "runner-only"; networkAccess: false; approvalPolicy: "never" };
  execution: { git: { mode: GitMode }; verificationPlan: VerificationPlanV1 };
  input?: unknown;
}
export interface JobResultV1 { version: 1; jobId: string; jobType: JobType; outcome: "succeeded" | "failed"; checks: Array<Record<string, unknown>>; [key: string]: unknown; }
export const JOB_SPEC_VERSION: 1;
export const JOB_RESULT_VERSION: 1;
export const JOB_TYPES: readonly JobType[];
export function jobTypeForColumn(column: string): JobType;
export function permissionProfileForJobType(type: JobType): PermissionProfile;
export function gitModeForJobType(type: JobType): GitMode;
export function assertRepositoryAuthorization(access: unknown, repositoryId: string | null | undefined, allowedRepositoryIds?: string[]): void;
export function validateCheckDefinition(value: unknown): CheckDefinition;
export function validateVerificationPlan(value: unknown): VerificationPlanV1;
export function parseJobSpec(value: unknown): JobSpecV1;
export function serializeJobSpec(value: unknown): JobSpecV1;
export function buildJobSpecV1(value: unknown): JobSpecV1;
export function parseJobResult(value: unknown): JobResultV1;
export function serializeJobResult(value: unknown): JobResultV1;
