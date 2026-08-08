import type {
  AgentDefinition,
  BoardState,
  Card,
  Classification,
  Repository,
  SpecializationProfile,
  Stage,
  StageId,
  TransitionPolicy,
  TransitionPolicyMode,
} from "@/lib/domain/types";
import { applyTransition, dismissFinding, recordApproval, runAutomaticTransitions } from "@/lib/domain/workflow";
import { makeId, nowIso } from "@/lib/utils/id";

const stages: Stage[] = [
  { id: "inbox", label: "Inbox", order: 1 },
  { id: "classification", label: "Classification", order: 2 },
  { id: "refinement", label: "Refinement", order: 3 },
  { id: "planning", label: "Planning", order: 4 },
  { id: "development", label: "Development", order: 5 },
  { id: "code_review", label: "Code Review", order: 6 },
  { id: "testing", label: "Testing", order: 7 },
  { id: "human_approval", label: "Human Approval", order: 8 },
  { id: "merge", label: "Merge", order: 9 },
  { id: "done", label: "Done", order: 10 },
];

const repositories: Repository[] = [
  {
    id: "7e07a67e-5f16-4c34-b793-f8e177f2625f",
    owner: "acme",
    name: "web-portal",
    fullName: "acme/web-portal",
    defaultBranch: "main",
    enabled: true,
  },
  {
    id: "f788c732-bddd-4287-84fa-f3237ca3cd88",
    owner: "acme",
    name: "api-gateway",
    fullName: "acme/api-gateway",
    defaultBranch: "main",
    enabled: true,
  },
];

const policies: TransitionPolicy[] = [
  {
    id: makeId("policy"),
    fromStageId: "inbox",
    toStageId: "classification",
    mode: "automatic",
    condition: { kind: "always" },
    updatedAt: nowIso(),
  },
  {
    id: makeId("policy"),
    fromStageId: "classification",
    toStageId: "refinement",
    mode: "automatic",
    condition: { kind: "always" },
    updatedAt: nowIso(),
  },
  {
    id: makeId("policy"),
    fromStageId: "refinement",
    toStageId: "planning",
    mode: "manual",
    condition: { kind: "always" },
    updatedAt: nowIso(),
  },
  {
    id: makeId("policy"),
    fromStageId: "planning",
    toStageId: "development",
    mode: "manual",
    condition: { kind: "always" },
    updatedAt: nowIso(),
  },
  {
    id: makeId("policy"),
    fromStageId: "development",
    toStageId: "code_review",
    mode: "automatic",
    condition: { kind: "always" },
    updatedAt: nowIso(),
  },
  {
    id: makeId("policy"),
    fromStageId: "code_review",
    toStageId: "development",
    mode: "conditional",
    condition: { kind: "unresolved_findings_and_loop_available" },
    updatedAt: nowIso(),
  },
  {
    id: makeId("policy"),
    fromStageId: "code_review",
    toStageId: "testing",
    mode: "conditional",
    condition: { kind: "zero_unresolved_findings" },
    updatedAt: nowIso(),
  },
  {
    id: makeId("policy"),
    fromStageId: "testing",
    toStageId: "human_approval",
    mode: "conditional",
    condition: { kind: "all_mandatory_checks_pass" },
    updatedAt: nowIso(),
  },
  {
    id: makeId("policy"),
    fromStageId: "human_approval",
    toStageId: "merge",
    mode: "manual",
    condition: { kind: "merge_approval_recorded" },
    updatedAt: nowIso(),
  },
  {
    id: makeId("policy"),
    fromStageId: "merge",
    toStageId: "done",
    mode: "automatic",
    condition: { kind: "always" },
    updatedAt: nowIso(),
  },
];

const agentDefinitions: AgentDefinition[] = [
  { id: makeId("agent"), role: "classifier", version: "1.0.0", prompt: "Classify task", model: "gpt-5-mini" },
  { id: makeId("agent"), role: "refiner", version: "1.0.0", prompt: "Refine task", model: "gpt-5-mini" },
  { id: makeId("agent"), role: "planner", version: "1.0.0", prompt: "Plan implementation", model: "gpt-5" },
  { id: makeId("agent"), role: "developer", version: "1.0.0", prompt: "Implement changes", model: "gpt-5" },
  { id: makeId("agent"), role: "reviewer", version: "1.0.0", prompt: "Review code", model: "gpt-5" },
  { id: makeId("agent"), role: "tester", version: "1.0.0", prompt: "Test software", model: "gpt-5-mini" },
];

const specializationProfiles: SpecializationProfile[] = [
  {
    id: makeId("spec"),
    type: "language",
    name: "TypeScript",
    guidance: "Use strict typing and schema validation.",
    repositoryId: null,
  },
  {
    id: makeId("spec"),
    type: "framework",
    name: "Next.js",
    guidance: "Prefer server components and route handlers for server boundaries.",
    repositoryId: null,
  },
  {
    id: makeId("spec"),
    type: "technical_concern",
    name: "Security",
    guidance: "Validate all external input and verify webhook signatures.",
    repositoryId: null,
  },
  {
    id: makeId("spec"),
    type: "repository_guidance",
    name: "web-portal conventions",
    guidance: "Run eslint, unit tests, and build before merge.",
    repositoryId: "7e07a67e-5f16-4c34-b793-f8e177f2625f",
  },
];

function initialCard(): Card {
  const now = nowIso();
  return {
    id: "f763eb5f-3b82-402d-a6d8-fa5b0f7ce432",
    title: "Fix session expiry redirect race in auth middleware",
    description:
      "Users are occasionally redirected to sign-in despite valid sessions. Ensure middleware handles token refresh and cache coherency under concurrent navigation.",
    repositoryId: "7e07a67e-5f16-4c34-b793-f8e177f2625f",
    stageId: "refinement",
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
}

function seedState(): BoardState {
  const card = initialCard();
  return {
    owner: {
      id: "owner-1",
      displayName: "Local Owner",
    },
    repositories,
    stages,
    cards: [card],
    policies,
    agentDefinitions,
    specializationProfiles,
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
}

export class DemoStore {
  private state: BoardState;

  constructor() {
    this.state = seedState();
    runAutomaticTransitions(this.state, this.state.cards[0]);
  }

  getSnapshot(): BoardState {
    return structuredClone(this.state);
  }

  reset(): BoardState {
    this.state = seedState();
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
