import type { BoardState, Card, Classification, StageId, TransitionPolicyMode } from "@/lib/domain/types";
import { applyTransition, dismissFinding, recordApproval, runAutomaticTransitions } from "@/lib/domain/workflow";
import { createSeedState } from "@/lib/store/seed-data";
import { nowIso } from "@/lib/utils/id";

export class DemoStore {
  private state: BoardState;

  constructor() {
    this.state = createSeedState();
    runAutomaticTransitions(this.state, this.state.cards[0]);
  }

  getSnapshot(): BoardState {
    return structuredClone(this.state);
  }

  reset(): BoardState {
    this.state = createSeedState();
    runAutomaticTransitions(this.state, this.state.cards[0]);
    return this.getSnapshot();
  }

  createCard(input: { title: string; description: string; repositoryId: string | null }): Card {
    const now = nowIso();
    const card: Card = {
      id: crypto.randomUUID(),
      title: input.title,
      description: input.description,
      repositoryId: input.repositoryId,
      stageId: "inbox",
      classification: null,
      specializationTags: [],
      createdAt: now,
      updatedAt: now,
      autoReviewLoopCount: 0,
      manualRemediationCredits: 0,
      remediationAttemptCount: 0,
      reviewCycleCount: 0,
      blockedReason: null,
      estimatedCostUsd: 0,
      tokenUsage: 0,
      mergeApprovedAt: null,
      demoResolveFindingsOnAttempt: 4,
    };

    this.state.cards.push(card);
    runAutomaticTransitions(this.state, card);
    return structuredClone(card);
  }

  updateCard(
    cardId: string,
    input: {
      title?: string;
      description?: string;
      repositoryId?: string | null;
      demoResolveFindingsOnAttempt?: number;
    },
  ): Card {
    const card = this.state.cards.find((item) => item.id === cardId);
    if (!card) {
      throw new Error("Card not found.");
    }

    if (input.title !== undefined) {
      card.title = input.title;
    }
    if (input.description !== undefined) {
      card.description = input.description;
    }
    if (input.repositoryId !== undefined) {
      card.repositoryId = input.repositoryId;
    }
    if (input.demoResolveFindingsOnAttempt !== undefined) {
      card.demoResolveFindingsOnAttempt = input.demoResolveFindingsOnAttempt;
    }

    card.updatedAt = nowIso();
    return structuredClone(card);
  }

  setClassification(cardId: string, classification: Classification): Card {
    const card = this.state.cards.find((item) => item.id === cardId);
    if (!card) {
      throw new Error("Card not found.");
    }

    card.classification = classification;
    card.specializationTags = classification.specializations;
    card.updatedAt = nowIso();
    return structuredClone(card);
  }

  transitionCard(cardId: string, toStageId: StageId, idempotencyKey: string, actorId: string): BoardState {
    applyTransition(this.state, cardId, toStageId, idempotencyKey, {
      actorType: "human",
      actorId,
    });
    return this.getSnapshot();
  }

  approve(cardId: string, input: { kind: "remediation" | "merge"; approved: boolean; justification: string }, actorId: string): BoardState {
    const card = this.state.cards.find((item) => item.id === cardId);
    if (!card) {
      throw new Error("Card not found.");
    }

    recordApproval(
      this.state,
      card,
      {
        kind: input.kind,
        approved: input.approved,
        justification: input.justification,
      },
      {
        actorType: "human",
        actorId,
      },
    );

    return this.getSnapshot();
  }

  dismissFinding(cardId: string, findingId: string, justification: string, actorId: string): BoardState {
    const card = this.state.cards.find((item) => item.id === cardId);
    if (!card) {
      throw new Error("Card not found.");
    }

    dismissFinding(
      this.state,
      card,
      findingId,
      justification,
      {
        actorType: "human",
        actorId,
      },
    );

    return this.getSnapshot();
  }

  setPolicyMode(policyId: string, mode: TransitionPolicyMode): BoardState {
    const policy = this.state.policies.find((item) => item.id === policyId);
    if (!policy) {
      throw new Error("Policy not found.");
    }

    policy.mode = mode;
    policy.updatedAt = nowIso();
    return this.getSnapshot();
  }
}
