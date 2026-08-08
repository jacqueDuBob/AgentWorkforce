import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BoardState, Card, Classification, StageId, TransitionPolicyMode } from "@/lib/domain/types";
import { applyTransition, dismissFinding, recordApproval, runAutomaticTransitions } from "@/lib/domain/workflow";
import { nowIso } from "@/lib/utils/id";
import { createSeedState } from "@/lib/store/seed-data";
import type { BoardStore } from "@/lib/store/board-store";

const SNAPSHOT_ID = "2ed0d9c5-3f0c-4c11-8a86-8c7b7d3e1d2a";
const SNAPSHOT_NAME = "default";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class SupabaseStore implements BoardStore {
  private client: SupabaseClient;
  private state: BoardState | null = null;
  private loading: Promise<void> | null = null;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.state) {
      return;
    }

    if (!this.loading) {
      this.loading = this.load().finally(() => {
        this.loading = null;
      });
    }

    await this.loading;
  }

  private async load(): Promise<void> {
    const { data, error } = await this.client
      .from("board_snapshots")
      .select("snapshot")
      .eq("name", SNAPSHOT_NAME)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data?.snapshot) {
      this.state = createSeedState();
      await this.persist();
      return;
    }

    this.state = clone(data.snapshot as BoardState);
  }

  private async persist(): Promise<void> {
    const state = this.state;
    if (!state) {
      throw new Error("Board state is not initialized.");
    }

    const { error } = await this.client.from("board_snapshots").upsert({
      id: SNAPSHOT_ID,
      name: SNAPSHOT_NAME,
      snapshot: state,
      updated_at: nowIso(),
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  async getSnapshot(): Promise<BoardState> {
    await this.ensureLoaded();
    return clone(this.state as BoardState);
  }

  async reset(): Promise<BoardState> {
    this.state = createSeedState();
    await this.persist();
    return this.getSnapshot();
  }

  async createCard(input: { title: string; description: string; repositoryId: string | null }): Promise<Card> {
    await this.ensureLoaded();
    const state = this.state as BoardState;
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

    state.cards.push(card);
    runAutomaticTransitions(state, card);
    await this.persist();
    return clone(card);
  }

  async updateCard(
    cardId: string,
    input: {
      title?: string;
      description?: string;
      repositoryId?: string | null;
      demoResolveFindingsOnAttempt?: number;
    },
  ): Promise<Card> {
    await this.ensureLoaded();
    const state = this.state as BoardState;
    const card = state.cards.find((item) => item.id === cardId);
    if (!card) {
      throw new Error("Card not found.");
    }

    if (input.title !== undefined) card.title = input.title;
    if (input.description !== undefined) card.description = input.description;
    if (input.repositoryId !== undefined) card.repositoryId = input.repositoryId;
    if (input.demoResolveFindingsOnAttempt !== undefined) card.demoResolveFindingsOnAttempt = input.demoResolveFindingsOnAttempt;

    card.updatedAt = nowIso();
    await this.persist();
    return clone(card);
  }

  async setClassification(cardId: string, classification: Classification): Promise<Card> {
    await this.ensureLoaded();
    const state = this.state as BoardState;
    const card = state.cards.find((item) => item.id === cardId);
    if (!card) {
      throw new Error("Card not found.");
    }

    card.classification = classification;
    card.specializationTags = classification.specializations;
    card.updatedAt = nowIso();
    await this.persist();
    return clone(card);
  }

  async transitionCard(cardId: string, toStageId: StageId, idempotencyKey: string, actorId: string): Promise<BoardState> {
    await this.ensureLoaded();
    const state = this.state as BoardState;
    applyTransition(state, cardId, toStageId, idempotencyKey, {
      actorType: "human",
      actorId,
    });
    await this.persist();
    return this.getSnapshot();
  }

  async approve(cardId: string, input: { kind: "remediation" | "merge"; approved: boolean; justification: string }, actorId: string): Promise<BoardState> {
    await this.ensureLoaded();
    const state = this.state as BoardState;
    const card = state.cards.find((item) => item.id === cardId);
    if (!card) {
      throw new Error("Card not found.");
    }

    recordApproval(
      state,
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
    await this.persist();
    return this.getSnapshot();
  }

  async dismissFinding(cardId: string, findingId: string, justification: string, actorId: string): Promise<BoardState> {
    await this.ensureLoaded();
    const state = this.state as BoardState;
    const card = state.cards.find((item) => item.id === cardId);
    if (!card) {
      throw new Error("Card not found.");
    }

    dismissFinding(state, card, findingId, justification, {
      actorType: "human",
      actorId,
    });
    await this.persist();
    return this.getSnapshot();
  }

  async setPolicyMode(policyId: string, mode: TransitionPolicyMode): Promise<BoardState> {
    await this.ensureLoaded();
    const state = this.state as BoardState;
    const policy = state.policies.find((item) => item.id === policyId);
    if (!policy) {
      throw new Error("Policy not found.");
    }

    policy.mode = mode;
    policy.updatedAt = nowIso();
    await this.persist();
    return this.getSnapshot();
  }
}