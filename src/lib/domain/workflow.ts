import type {
  AgentRun,
  Approval,
  Artifact,
  BoardState,
  Card,
  FindingSeverity,
  GitHubOperation,
  ReviewCycle,
  ReviewFinding,
  StageId,
  TestRun,
  TransitionLog,
  TransitionPolicy,
  UsageRecord,
} from "@/lib/domain/types";
import { makeId, nowIso } from "@/lib/utils/id";

export type TransitionActor = {
  actorType: "human" | "system";
  actorId: string;
};

export type TransitionResult = {
  transition: TransitionLog;
  card: Card;
};

export function unresolvedFindingsForCard(state: BoardState, cardId: string): ReviewFinding[] {
  return state.reviewFindings.filter((finding) => finding.cardId === cardId && finding.status === "open");
}

function policyFor(state: BoardState, fromStageId: StageId, toStageId: StageId): TransitionPolicy | undefined {
  return state.policies.find((policy) => policy.fromStageId === fromStageId && policy.toStageId === toStageId);
}

function latestTestRun(state: BoardState, cardId: string): TestRun | undefined {
  return [...state.testRuns].reverse().find((run) => run.cardId === cardId);
}

function hasMergeApproval(state: BoardState, cardId: string): boolean {
  return state.approvals.some(
    (approval) => approval.cardId === cardId && approval.kind === "merge" && approval.approved,
  );
}

function evaluateCondition(
  policy: TransitionPolicy,
  card: Card,
  state: BoardState,
): { ok: boolean; reason: string } {
  const unresolvedCount = unresolvedFindingsForCard(state, card.id).length;

  switch (policy.condition.kind) {
    case "always":
      return { ok: true, reason: "Condition passed." };
    case "unresolved_findings_and_loop_available":
      if (unresolvedCount === 0) {
        return { ok: false, reason: "No unresolved findings to remediate." };
      }
      if (card.autoReviewLoopCount < 3) {
        return { ok: true, reason: "Automatic loop is still within limit." };
      }
      if (card.manualRemediationCredits > 0) {
        return { ok: true, reason: "Manual remediation credit available." };
      }
      return { ok: false, reason: "Manual approval required for additional remediation." };
    case "zero_unresolved_findings":
      return unresolvedCount === 0
        ? { ok: true, reason: "No unresolved findings remain." }
        : { ok: false, reason: "Unresolved findings block transition to testing." };
    case "all_mandatory_checks_pass": {
      const test = latestTestRun(state, card.id);
      if (!test) {
        return { ok: false, reason: "Testing evidence is missing." };
      }
      return test.mandatoryChecksPassed
        ? { ok: true, reason: "All mandatory checks passed." }
        : { ok: false, reason: "Mandatory checks failed." };
    }
    case "merge_approval_recorded":
      return hasMergeApproval(state, card.id)
        ? { ok: true, reason: "Human merge approval recorded." }
        : { ok: false, reason: "Human merge approval is required." };
    default:
      return { ok: false, reason: "Unsupported policy condition." };
  }
}

export function canTransition(
  card: Card,
  toStageId: StageId,
  state: BoardState,
): { allowed: boolean; reason: string; policy?: TransitionPolicy } {
  const policy = policyFor(state, card.stageId, toStageId);
  if (!policy) {
    return { allowed: false, reason: "No transition policy exists for this stage pair." };
  }

  const condition = evaluateCondition(policy, card, state);
  if (!condition.ok) {
    return { allowed: false, reason: condition.reason, policy };
  }

  return { allowed: true, reason: condition.reason, policy };
}

function createTransitionLog(
  card: Card,
  toStageId: StageId,
  actor: TransitionActor,
  decision: "allowed" | "blocked",
  reason: string,
  idempotencyKey: string,
  beforeState: Record<string, unknown>,
  afterState: Record<string, unknown>,
): TransitionLog {
  return {
    id: makeId("transition"),
    cardId: card.id,
    fromStageId: card.stageId,
    toStageId,
    decision,
    reason,
    idempotencyKey,
    actorType: actor.actorType,
    actorId: actor.actorId,
    beforeState,
    afterState,
    createdAt: nowIso(),
  };
}

export function recordApproval(
  state: BoardState,
  card: Card,
  input: { kind: "remediation" | "merge"; approved: boolean; justification: string },
  actor: TransitionActor,
): Approval {
  const approval: Approval = {
    id: makeId("approval"),
    cardId: card.id,
    kind: input.kind,
    approved: input.approved,
    justification: input.justification,
    actorType: actor.actorType,
    actorId: actor.actorId,
    createdAt: nowIso(),
    consumedAt: null,
  };
  state.approvals.push(approval);

  if (input.approved && input.kind === "remediation") {
    card.manualRemediationCredits += 1;
    card.blockedReason = null;
  }

  if (input.approved && input.kind === "merge") {
    card.mergeApprovedAt = nowIso();
  }

  card.updatedAt = nowIso();
  return approval;
}

function addUsage(state: BoardState, card: Card, runId: string, model: string, tokens: number, usd: number): UsageRecord {
  const usage: UsageRecord = {
    id: makeId("usage"),
    cardId: card.id,
    runId,
    model,
    tokenUsage: tokens,
    estimatedCostUsd: usd,
    createdAt: nowIso(),
  };
  state.usageRecords.push(usage);
  card.tokenUsage += tokens;
  card.estimatedCostUsd = Number((card.estimatedCostUsd + usd).toFixed(6));
  return usage;
}

function addRun(
  state: BoardState,
  card: Card,
  input: {
    role: AgentRun["role"];
    stageId: StageId;
    promptVersion: string;
    outputSummary: string;
    tokenUsage: number;
    estimatedCostUsd: number;
    cycleNumber: number;
  },
): AgentRun {
  const startedAt = nowIso();
  const run: AgentRun = {
    id: makeId("run"),
    cardId: card.id,
    role: input.role,
    stageId: input.stageId,
    status: "completed",
    startedAt,
    endedAt: nowIso(),
    promptVersion: input.promptVersion,
    tokenUsage: input.tokenUsage,
    estimatedCostUsd: input.estimatedCostUsd,
    outputSummary: input.outputSummary,
    cycleNumber: input.cycleNumber,
  };
  state.agentRuns.push(run);
  addUsage(state, card, run.id, `demo-${input.role}`, input.tokenUsage, input.estimatedCostUsd);
  return run;
}

function addArtifact(state: BoardState, card: Card, runId: string, type: Artifact["type"], label: string, url: string): Artifact {
  const artifact: Artifact = {
    id: makeId("artifact"),
    cardId: card.id,
    runId,
    type,
    label,
    url,
    createdAt: nowIso(),
  };
  state.artifacts.push(artifact);
  return artifact;
}

function createDevelopmentRun(state: BoardState, card: Card): void {
  card.remediationAttemptCount += 1;
  const run = addRun(state, card, {
    role: "developer",
    stageId: "development",
    promptVersion: "developer@1.0.0",
    outputSummary: `Remediation attempt ${card.remediationAttemptCount} completed with patch proposal.`,
    tokenUsage: 1200,
    estimatedCostUsd: 0.0018,
    cycleNumber: card.reviewCycleCount,
  });

  addArtifact(
    state,
    card,
    run.id,
    "patch",
    `Attempt ${card.remediationAttemptCount} patch`,
    `https://example.local/artifacts/${run.id}/patch.diff`,
  );
}

function createReviewRun(state: BoardState, card: Card): void {
  card.reviewCycleCount += 1;
  const run = addRun(state, card, {
    role: "reviewer",
    stageId: "code_review",
    promptVersion: "reviewer@1.0.0",
    outputSummary: "Code review completed with structured findings.",
    tokenUsage: 1700,
    estimatedCostUsd: 0.0042,
    cycleNumber: card.reviewCycleCount,
  });

  const cycle: ReviewCycle = {
    id: makeId("cycle"),
    cardId: card.id,
    cycleNumber: card.reviewCycleCount,
    unresolvedCount: 0,
    createdAt: nowIso(),
  };

  state.reviewCycles.push(cycle);

  const shouldResolve = card.remediationAttemptCount >= card.demoResolveFindingsOnAttempt;
  if (!shouldResolve) {
    const finding: ReviewFinding = {
      id: makeId("finding"),
      cardId: card.id,
      cycleNumber: card.reviewCycleCount,
      stableId: "security-auth-header-check",
      severity: (card.reviewCycleCount % 2 === 0 ? "informational" : "low") as FindingSeverity,
      category: "security",
      title: "Request headers are not fully validated",
      description: "Input sanitization does not validate all trusted headers prior to use.",
      evidence: "Observed direct header pass-through in authentication middleware.",
      filePath: "src/middleware.ts",
      lineNumber: 42,
      requiredOutcome: "Validate and normalize trusted headers before use.",
      status: "open",
      resolutionEvidence: null,
      resolutionCommit: null,
      dismissalJustification: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    state.reviewFindings.push(finding);
    cycle.unresolvedCount = 1;
  }

  addArtifact(state, card, run.id, "report", `Review cycle ${card.reviewCycleCount}`, `https://example.local/artifacts/${run.id}/report.json`);
}

function createTestingRun(state: BoardState, card: Card): void {
  const run = addRun(state, card, {
    role: "tester",
    stageId: "testing",
    promptVersion: "tester@1.0.0",
    outputSummary: "Mandatory checks executed.",
    tokenUsage: 600,
    estimatedCostUsd: 0.0008,
    cycleNumber: card.reviewCycleCount,
  });

  const testRun: TestRun = {
    id: makeId("test"),
    cardId: card.id,
    cycleNumber: card.reviewCycleCount,
    status: "passed",
    mandatoryChecksPassed: true,
    evidence: `Tests passed for remediation attempt ${card.remediationAttemptCount}.`,
    createdAt: nowIso(),
  };

  state.testRuns.push(testRun);
  addArtifact(state, card, run.id, "test_evidence", `Test evidence cycle ${card.reviewCycleCount}`, `https://example.local/artifacts/${run.id}/tests.txt`);
}

function createMergeOperation(state: BoardState, card: Card): GitHubOperation {
  const operation: GitHubOperation = {
    id: makeId("ghop"),
    cardId: card.id,
    operationType: "merge",
    status: "completed",
    externalId: `demo-merge-${card.id}`,
    metadata: {
      branch: `agentboard/${card.id}`,
      pullRequest: `https://github.com/demo/repo/pull/${Math.floor(Math.random() * 200 + 1)}`,
      mergedBy: "agentboard-server",
    },
    createdAt: nowIso(),
  };
  state.githubOperations.push(operation);
  return operation;
}

function afterStageEntered(state: BoardState, card: Card): void {
  if (card.stageId === "classification") {
    const run = addRun(state, card, {
      role: "classifier",
      stageId: "classification",
      promptVersion: "classifier@1.0.0",
      outputSummary: "Classification generated.",
      tokenUsage: 350,
      estimatedCostUsd: 0.0004,
      cycleNumber: card.reviewCycleCount,
    });

    card.classification = {
      workflow: "software-development",
      taskType: "bug_fix",
      domains: ["frontend", "authentication"],
      complexity: "medium",
      risk: "high",
      specializations: ["typescript", "nextjs", "security"],
      suggestedTests: ["unit", "integration"],
      requiresSecurityReview: true,
      confidence: 0.92,
    };
    card.specializationTags = card.classification.specializations;
    addArtifact(state, card, run.id, "report", "Classifier output", `https://example.local/artifacts/${run.id}/classification.json`);
  }

  if (card.stageId === "development") {
    createDevelopmentRun(state, card);
  }

  if (card.stageId === "code_review") {
    createReviewRun(state, card);
  }

  if (card.stageId === "testing") {
    createTestingRun(state, card);
  }

  if (card.stageId === "merge") {
    createMergeOperation(state, card);
  }
}

function nextAutomaticTarget(card: Card, state: BoardState): StageId | null {
  const candidates = state.policies.filter((policy) => policy.fromStageId === card.stageId && policy.mode !== "manual");
  for (const candidate of candidates) {
    const check = canTransition(card, candidate.toStageId, state);
    if (check.allowed) {
      return candidate.toStageId;
    }
  }
  return null;
}

export function runAutomaticTransitions(state: BoardState, card: Card): void {
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const target = nextAutomaticTarget(card, state);
    if (!target) {
      return;
    }

    const key = `system-auto-${card.id}-${card.stageId}-${target}-${iteration}`;
    applyTransition(state, card.id, target, key, { actorType: "system", actorId: "workflow-engine" });

    if (card.stageId === "code_review" && unresolvedFindingsForCard(state, card.id).length > 0 && card.autoReviewLoopCount >= 3) {
      return;
    }
  }
}

export function applyTransition(
  state: BoardState,
  cardId: string,
  toStageId: StageId,
  idempotencyKey: string,
  actor: TransitionActor,
): TransitionResult {
  if (state.idempotencyResults[idempotencyKey]) {
    const cached = state.idempotencyResults[idempotencyKey];
    const card = state.cards.find((c) => c.id === cached.cardId);
    if (!card) {
      throw new Error("Card missing for cached idempotency result.");
    }
    return { transition: cached, card };
  }

  const card = state.cards.find((candidate) => candidate.id === cardId);
  if (!card) {
    throw new Error("Card not found.");
  }

  const beforeState = {
    stageId: card.stageId,
    autoReviewLoopCount: card.autoReviewLoopCount,
    manualRemediationCredits: card.manualRemediationCredits,
  };

  const check = canTransition(card, toStageId, state);
  if (!check.allowed) {
    const blocked = createTransitionLog(card, toStageId, actor, "blocked", check.reason, idempotencyKey, beforeState, beforeState);
    state.transitions.push(blocked);
    state.idempotencyResults[idempotencyKey] = blocked;
    card.blockedReason = check.reason;
    card.updatedAt = nowIso();
    return { transition: blocked, card };
  }

  if (card.stageId === "code_review" && toStageId === "development") {
    if (card.autoReviewLoopCount < 3) {
      card.autoReviewLoopCount += 1;
    } else if (card.manualRemediationCredits > 0) {
      card.manualRemediationCredits -= 1;
      const activeApproval = [...state.approvals]
        .reverse()
        .find((approval) => approval.cardId === card.id && approval.kind === "remediation" && approval.approved && !approval.consumedAt);
      if (activeApproval) {
        activeApproval.consumedAt = nowIso();
      }
    } else {
      card.blockedReason = "Manual approval required for additional remediation.";
      const blocked = createTransitionLog(
        card,
        toStageId,
        actor,
        "blocked",
        card.blockedReason,
        idempotencyKey,
        beforeState,
        beforeState,
      );
      state.transitions.push(blocked);
      state.idempotencyResults[idempotencyKey] = blocked;
      card.updatedAt = nowIso();
      return { transition: blocked, card };
    }
  }

  if (card.stageId === "human_approval" && toStageId === "merge" && !hasMergeApproval(state, card.id)) {
    card.blockedReason = "Merge requires explicit human approval.";
    const blocked = createTransitionLog(card, toStageId, actor, "blocked", card.blockedReason, idempotencyKey, beforeState, beforeState);
    state.transitions.push(blocked);
    state.idempotencyResults[idempotencyKey] = blocked;
    card.updatedAt = nowIso();
    return { transition: blocked, card };
  }

  card.stageId = toStageId;
  card.blockedReason = null;
  card.updatedAt = nowIso();

  afterStageEntered(state, card);

  const afterState = {
    stageId: card.stageId,
    autoReviewLoopCount: card.autoReviewLoopCount,
    manualRemediationCredits: card.manualRemediationCredits,
  };

  const transition = createTransitionLog(card, toStageId, actor, "allowed", check.reason, idempotencyKey, beforeState, afterState);
  state.transitions.push(transition);
  state.idempotencyResults[idempotencyKey] = transition;

  if (toStageId === "code_review") {
    const unresolved = unresolvedFindingsForCard(state, card.id).length;
    if (unresolved > 0 && card.autoReviewLoopCount >= 3 && card.manualRemediationCredits === 0) {
      card.blockedReason = "Manual approval required for additional remediation.";
      card.updatedAt = nowIso();
      return { transition, card };
    }
  }

  runAutomaticTransitions(state, card);
  return { transition, card };
}

export function dismissFinding(
  state: BoardState,
  card: Card,
  findingId: string,
  justification: string,
  actor: TransitionActor,
): ReviewFinding {
  const finding = state.reviewFindings.find((item) => item.id === findingId && item.cardId === card.id);
  if (!finding) {
    throw new Error("Finding not found for card.");
  }

  finding.status = "dismissed";
  finding.dismissalJustification = justification;
  finding.updatedAt = nowIso();

  state.transitions.push({
    id: makeId("transition"),
    cardId: card.id,
    fromStageId: card.stageId,
    toStageId: card.stageId,
    decision: "allowed",
    reason: `Finding ${finding.stableId} dismissed by ${actor.actorId}.`,
    idempotencyKey: makeId("dismissal"),
    actorType: actor.actorType,
    actorId: actor.actorId,
    beforeState: { findingId, status: "open" },
    afterState: { findingId, status: "dismissed", justification },
    createdAt: nowIso(),
  });

  card.updatedAt = nowIso();
  return finding;
}
