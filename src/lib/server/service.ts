import { approvalInputSchema, createCardInputSchema, dismissFindingInputSchema, transitionInputSchema, updateCardInputSchema, updatePolicyInputSchema } from "@/lib/domain/validation";
import { getEnv } from "@/lib/server/env";
import { getGitHubProvider } from "@/lib/providers/github";
import { getModelProvider } from "@/lib/providers/models";
import { getStore } from "@/lib/store";

const ACTOR_ID = "single-user-owner";

export function getBoardSnapshot() {
  return Promise.resolve(getStore().getSnapshot());
}

export function createCard(input: unknown) {
  const parsed = createCardInputSchema.parse(input);
  return Promise.resolve(getStore().createCard(parsed));
}

export function updateCard(cardId: string, input: unknown) {
  const parsed = updateCardInputSchema.parse(input);
  return Promise.resolve(getStore().updateCard(cardId, parsed));
}

export function transitionCard(cardId: string, input: unknown) {
  const parsed = transitionInputSchema.parse(input);
  const idempotencyKey = parsed.idempotencyKey ?? `manual-${cardId}-${parsed.targetStageId}-${crypto.randomUUID()}`;
  return Promise.resolve(getStore().transitionCard(cardId, parsed.targetStageId, idempotencyKey, ACTOR_ID));
}

export function recordApproval(cardId: string, input: unknown) {
  const parsed = approvalInputSchema.parse(input);
  return Promise.resolve(getStore().approve(cardId, parsed, ACTOR_ID));
}

export function dismissCardFinding(cardId: string, input: unknown) {
  const parsed = dismissFindingInputSchema.parse(input);
  return Promise.resolve(getStore().dismissFinding(cardId, parsed.findingId, parsed.justification, ACTOR_ID));
}

export function updatePolicyMode(policyId: string, input: unknown) {
  const parsed = updatePolicyInputSchema.parse(input);
  return Promise.resolve(getStore().setPolicyMode(policyId, parsed.mode));
}

export async function classifyCard(cardId: string) {
  const store = getStore();
  const snapshot = await store.getSnapshot();
  const card = snapshot.cards.find((item) => item.id === cardId);
  if (!card) {
    throw new Error("Card not found.");
  }

  const env = getEnv();
  const model = getModelProvider({
    openAiApiKey: env.OPENAI_API_KEY,
    classifierModel: env.OPENAI_CLASSIFIER_MODEL,
    timeoutMs: env.OPENAI_TIMEOUT_MS,
  });

  const classification = await model.classifyTask({
    title: card.title,
    description: card.description,
  });

  await store.setClassification(cardId, classification.output);
  return store.getSnapshot();
}

export async function mergeCard(cardId: string) {
  const store = getStore();
  const snapshot = await store.getSnapshot();
  const card = snapshot.cards.find((item) => item.id === cardId);
  if (!card) {
    throw new Error("Card not found.");
  }

  const mergeApproved = snapshot.approvals.some(
    (approval) => approval.cardId === cardId && approval.kind === "merge" && approval.approved,
  );
  if (!mergeApproved) {
    throw new Error("Merge requires explicit human approval.");
  }

  if (!card.repositoryId) {
    throw new Error("Card must be associated with a repository before merge.");
  }

  const repository = snapshot.repositories.find((repo) => repo.id === card.repositoryId);
  if (!repository) {
    throw new Error("Repository not found.");
  }

  const env = getEnv();
  const github = getGitHubProvider({
    githubAppId: env.GITHUB_APP_ID,
    githubAppPrivateKey: env.GITHUB_APP_PRIVATE_KEY,
    githubInstallationId: env.GITHUB_INSTALLATION_ID,
  });

  await github.mergePullRequest({ repository, cardId: card.id });
  return transitionCard(cardId, { targetStageId: "merge" });
}
