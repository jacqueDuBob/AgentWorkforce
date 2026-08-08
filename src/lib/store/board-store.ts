import type { BoardState, Card, Classification, StageId, TransitionPolicyMode } from "@/lib/domain/types";

export interface BoardStore {
  getSnapshot(): BoardState | Promise<BoardState>;
  reset(): BoardState | Promise<BoardState>;
  createCard(input: { title: string; description: string; repositoryId: string | null }): Card | Promise<Card>;
  updateCard(
    cardId: string,
    input: {
      title?: string;
      description?: string;
      repositoryId?: string | null;
      demoResolveFindingsOnAttempt?: number;
    },
  ): Card | Promise<Card>;
  setClassification(cardId: string, classification: Classification): Card | Promise<Card>;
  transitionCard(cardId: string, toStageId: StageId, idempotencyKey: string, actorId: string): BoardState | Promise<BoardState>;
  approve(
    cardId: string,
    input: { kind: "remediation" | "merge"; approved: boolean; justification: string },
    actorId: string,
  ): BoardState | Promise<BoardState>;
  dismissFinding(cardId: string, findingId: string, justification: string, actorId: string): BoardState | Promise<BoardState>;
  setPolicyMode(policyId: string, mode: TransitionPolicyMode): BoardState | Promise<BoardState>;
}