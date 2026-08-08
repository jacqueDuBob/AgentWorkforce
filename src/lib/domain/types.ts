export const STAGE_IDS = [
  "inbox",
  "classification",
  "refinement",
  "planning",
  "development",
  "code_review",
  "testing",
  "human_approval",
  "merge",
  "done",
] as const;

export type StageId = (typeof STAGE_IDS)[number];

export const FINDING_SEVERITIES = ["informational", "low", "medium", "high", "critical"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_STATUSES = ["open", "resolved", "dismissed"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const POLICY_MODES = ["automatic", "manual", "conditional"] as const;
export type TransitionPolicyMode = (typeof POLICY_MODES)[number];

export const APPROVAL_KINDS = ["remediation", "merge"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const AGENT_ROLES = ["classifier", "refiner", "planner", "developer", "reviewer", "tester"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export interface Repository {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  installationId?: string;
  enabled: boolean;
}

export interface Classification {
  workflow: "software-development";
  taskType: "bug_fix" | "feature" | "refactor" | "chore";
  domains: string[];
  complexity: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
  specializations: string[];
  suggestedTests: string[];
  requiresSecurityReview: boolean;
  confidence: number;
}

export interface Card {
  id: string;
  title: string;
  description: string;
  repositoryId: string | null;
  stageId: StageId;
  classification: Classification | null;
  specializationTags: string[];
  createdAt: string;
  updatedAt: string;
  autoReviewLoopCount: number;
  manualRemediationCredits: number;
  remediationAttemptCount: number;
  reviewCycleCount: number;
  blockedReason: string | null;
  estimatedCostUsd: number;
  tokenUsage: number;
  mergeApprovedAt: string | null;
  demoResolveFindingsOnAttempt: number;
}

export interface Stage {
  id: StageId;
  label: string;
  order: number;
}

export interface TransitionPolicy {
  id: string;
  fromStageId: StageId;
  toStageId: StageId;
  mode: TransitionPolicyMode;
  condition:
    | { kind: "always" }
    | { kind: "unresolved_findings_and_loop_available" }
    | { kind: "zero_unresolved_findings" }
    | { kind: "all_mandatory_checks_pass" }
    | { kind: "merge_approval_recorded" };
  updatedAt: string;
}

export interface AgentDefinition {
  id: string;
  role: AgentRole;
  version: string;
  prompt: string;
  model: string;
}

export interface SpecializationProfile {
  id: string;
  type: "language" | "framework" | "technical_concern" | "repository_guidance";
  name: string;
  guidance: string;
  repositoryId: string | null;
}

export interface AgentRun {
  id: string;
  cardId: string;
  role: AgentRole;
  stageId: StageId;
  status: "queued" | "running" | "completed" | "failed";
  startedAt: string;
  endedAt: string | null;
  promptVersion: string;
  tokenUsage: number;
  estimatedCostUsd: number;
  outputSummary: string;
  cycleNumber: number;
}

export interface RunEvent {
  id: string;
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ReviewCycle {
  id: string;
  cardId: string;
  cycleNumber: number;
  unresolvedCount: number;
  createdAt: string;
}

export interface ReviewFinding {
  id: string;
  cardId: string;
  cycleNumber: number;
  stableId: string;
  severity: FindingSeverity;
  category: string;
  title: string;
  description: string;
  evidence: string;
  filePath: string | null;
  lineNumber: number | null;
  requiredOutcome: string;
  status: FindingStatus;
  resolutionEvidence: string | null;
  resolutionCommit: string | null;
  dismissalJustification: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestRun {
  id: string;
  cardId: string;
  cycleNumber: number;
  status: "passed" | "failed";
  mandatoryChecksPassed: boolean;
  evidence: string;
  createdAt: string;
}

export interface Approval {
  id: string;
  cardId: string;
  kind: ApprovalKind;
  approved: boolean;
  justification: string;
  actorType: "human" | "system";
  actorId: string;
  createdAt: string;
  consumedAt: string | null;
}

export interface GitHubOperation {
  id: string;
  cardId: string;
  operationType: "branch" | "workflow_dispatch" | "pr" | "merge";
  status: "pending" | "completed" | "failed";
  externalId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageRecord {
  id: string;
  cardId: string;
  runId: string | null;
  model: string;
  tokenUsage: number;
  estimatedCostUsd: number;
  createdAt: string;
}

export interface Artifact {
  id: string;
  cardId: string;
  runId: string | null;
  type: "log" | "patch" | "test_evidence" | "report";
  label: string;
  url: string;
  createdAt: string;
}

export interface TransitionLog {
  id: string;
  cardId: string;
  fromStageId: StageId;
  toStageId: StageId;
  decision: "allowed" | "blocked";
  reason: string;
  idempotencyKey: string;
  actorType: "human" | "system";
  actorId: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  createdAt: string;
}

export interface BoardState {
  owner: {
    id: string;
    displayName: string;
  };
  repositories: Repository[];
  stages: Stage[];
  cards: Card[];
  policies: TransitionPolicy[];
  agentDefinitions: AgentDefinition[];
  specializationProfiles: SpecializationProfile[];
  agentRuns: AgentRun[];
  runEvents: RunEvent[];
  reviewCycles: ReviewCycle[];
  reviewFindings: ReviewFinding[];
  testRuns: TestRun[];
  approvals: Approval[];
  githubOperations: GitHubOperation[];
  usageRecords: UsageRecord[];
  artifacts: Artifact[];
  transitions: TransitionLog[];
  idempotencyResults: Record<string, TransitionLog>;
}
