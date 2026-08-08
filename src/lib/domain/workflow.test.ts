import { describe, expect, test } from "vitest";
import { applyTransition, canTransition, recordApproval, runAutomaticTransitions, unresolvedFindingsForCard } from "@/lib/domain/workflow";
import type { BoardState, Card, StageId, TransitionPolicy } from "@/lib/domain/types";
import { classificationSchema } from "@/lib/domain/validation";

function policy(fromStageId: StageId, toStageId: StageId, mode: TransitionPolicy["mode"], condition: TransitionPolicy["condition"]): TransitionPolicy {
  return {
    id: `${fromStageId}-${toStageId}`,
    fromStageId,
    toStageId,
    mode,
    condition,
    updatedAt: new Date().toISOString(),
  };
}

function buildState(resolveOnAttempt: number): { state: BoardState; card: Card } {
  const card: Card = {
    id: "card-1",
    title: "Task",
    description: "Task",
    repositoryId: null,
    stageId: "planning",
    classification: null,
    specializationTags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    autoReviewLoopCount: 0,
    manualRemediationCredits: 0,
    remediationAttemptCount: 0,
    reviewCycleCount: 0,
    blockedReason: null,
    estimatedCostUsd: 0,
    tokenUsage: 0,
    mergeApprovedAt: null,
    demoResolveFindingsOnAttempt: resolveOnAttempt,
  };

  const state: BoardState = {
    owner: { id: "owner", displayName: "Owner" },
    repositories: [],
    stages: [],
    cards: [card],
    policies: [
      policy("planning", "development", "manual", { kind: "always" }),
      policy("development", "code_review", "automatic", { kind: "always" }),
      policy("code_review", "development", "conditional", { kind: "unresolved_findings_and_loop_available" }),
      policy("code_review", "testing", "conditional", { kind: "zero_unresolved_findings" }),
      policy("testing", "human_approval", "conditional", { kind: "all_mandatory_checks_pass" }),
      policy("human_approval", "merge", "manual", { kind: "merge_approval_recorded" }),
      policy("merge", "done", "automatic", { kind: "always" }),
    ],
    agentDefinitions: [],
    specializationProfiles: [],
    agentRuns: [],
    runEvents: [],
    reviewCycles: [],
    reviewFindings: [],
    testRuns: [],
    approvals: [],
    githubOperations: [],
    usageRecords: [],
    artifacts: [],
    transitions: [],
    idempotencyResults: {},
  };

  return { state, card };
}

describe("workflow transitions", () => {
  test("allows valid transition and blocks invalid transition", () => {
    const { state, card } = buildState(4);
    expect(canTransition(card, "development", state).allowed).toBe(true);
    expect(canTransition(card, "testing", state).allowed).toBe(false);
  });

  test("automatic versus manual policy behavior", () => {
    const { state, card } = buildState(4);
    runAutomaticTransitions(state, card);
    expect(card.stageId).toBe("planning");

    applyTransition(state, card.id, "development", "manual-to-dev", { actorType: "human", actorId: "owner" });
    expect(card.stageId).toBe("code_review");
  });

  test("all severities including informational and low remain blocking while unresolved", () => {
    const { state, card } = buildState(50);
    applyTransition(state, card.id, "development", "go-dev", { actorType: "human", actorId: "owner" });
    expect(card.stageId).toBe("code_review");
    expect(card.autoReviewLoopCount).toBe(3);

    const findings = unresolvedFindingsForCard(state, card.id);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((finding) => finding.severity === "low" || finding.severity === "informational")).toBe(true);
    expect(card.blockedReason).toContain("Manual approval required");
  });

  test("zero unresolved findings move to testing automatically", () => {
    const { state, card } = buildState(1);
    applyTransition(state, card.id, "development", "go-dev-success", { actorType: "human", actorId: "owner" });
    expect(card.stageId).toBe("human_approval");
    expect(unresolvedFindingsForCard(state, card.id)).toHaveLength(0);
  });

  test("stops automatic review loops at three", () => {
    const { state, card } = buildState(99);
    applyTransition(state, card.id, "development", "loop-check", { actorType: "human", actorId: "owner" });
    expect(card.autoReviewLoopCount).toBe(3);
    expect(card.stageId).toBe("code_review");
    expect(card.blockedReason).toContain("Manual approval required");
  });

  test("each manual approval unlocks exactly one additional remediation attempt", () => {
    const { state, card } = buildState(99);
    applyTransition(state, card.id, "development", "manual-credit-seed", { actorType: "human", actorId: "owner" });
    expect(card.manualRemediationCredits).toBe(0);

    recordApproval(
      state,
      card,
      { kind: "remediation", approved: true, justification: "Allow one more attempt" },
      { actorType: "human", actorId: "owner" },
    );
    expect(card.manualRemediationCredits).toBe(1);

    applyTransition(state, card.id, "development", "consume-credit", { actorType: "human", actorId: "owner" });
    expect(card.manualRemediationCredits).toBe(0);
    expect(card.blockedReason).toContain("Manual approval required");
  });

  test("idempotency key prevents duplicate transitions", () => {
    const { state, card } = buildState(4);
    applyTransition(state, card.id, "development", "same-key", { actorType: "human", actorId: "owner" });
    const transitionCount = state.transitions.length;
    applyTransition(state, card.id, "development", "same-key", { actorType: "human", actorId: "owner" });
    expect(state.transitions.length).toBe(transitionCount);
  });

  test("merge blocked without approval", () => {
    const { state, card } = buildState(1);
    applyTransition(state, card.id, "development", "ready-for-approval", { actorType: "human", actorId: "owner" });
    expect(card.stageId).toBe("human_approval");

    applyTransition(state, card.id, "merge", "merge-without-approval", { actorType: "human", actorId: "owner" });
    expect(card.stageId).toBe("human_approval");
    expect(card.blockedReason).toContain("Human merge approval is required");
  });

  test("merge allowed after approval", () => {
    const { state, card } = buildState(1);
    applyTransition(state, card.id, "development", "ready-for-approval-2", { actorType: "human", actorId: "owner" });
    recordApproval(
      state,
      card,
      { kind: "merge", approved: true, justification: "Ready to merge" },
      { actorType: "human", actorId: "owner" },
    );
    applyTransition(state, card.id, "merge", "merge-after-approval", { actorType: "human", actorId: "owner" });
    expect(card.stageId).toBe("done");
  });
});

describe("structured output validation", () => {
  test("accepts valid classifier payload", () => {
    const payload = {
      workflow: "software-development",
      taskType: "bug_fix",
      domains: ["frontend"],
      complexity: "medium",
      risk: "high",
      specializations: ["typescript"],
      suggestedTests: ["unit"],
      requiresSecurityReview: true,
      confidence: 0.91,
    };
    expect(() => classificationSchema.parse(payload)).not.toThrow();
  });

  test("rejects invalid classifier payload", () => {
    const payload = {
      workflow: "anything",
      confidence: 10,
    };
    expect(() => classificationSchema.parse(payload)).toThrow();
  });
});
