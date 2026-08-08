import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AgentDefinition,
  Approval,
  Artifact,
  BoardState,
  Card,
  Classification,
  GitHubOperation,
  Repository,
  ReviewCycle,
  ReviewFinding,
  SpecializationProfile,
  Stage,
  StageId,
  TestRun,
  TransitionLog,
  TransitionPolicy,
  TransitionPolicyMode,
  UsageRecord,
} from "@/lib/domain/types";
import { applyTransition, dismissFinding, recordApproval, runAutomaticTransitions } from "@/lib/domain/workflow";
import { nowIso } from "@/lib/utils/id";
import { createSeedState, SEED_IDS } from "@/lib/store/seed-data";
import type { BoardStore } from "@/lib/store/board-store";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function requireRow<T>(row: T | null | undefined, message: string): T {
  if (!row) {
    throw new Error(message);
  }

  return row;
}

export class SupabaseBoardStore implements BoardStore {
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
    const { data: board, error } = await this.client.from("boards").select("id").eq("id", SEED_IDS.boardId).maybeSingle();
    if (error) {
      throw new Error(error.message);
    }

    if (!board) {
      await this.seedDatabase();
    }

    this.state = await this.readSnapshot();
  }

  private async seedDatabase(): Promise<void> {
    const seed = createSeedState();

    await this.client.from("owner_profiles").insert({
      id: SEED_IDS.ownerId,
      email: "owner@example.com",
      display_name: seed.owner.displayName,
      updated_at: nowIso(),
    });

    await this.client.from("boards").insert({
      id: SEED_IDS.boardId,
      owner_profile_id: SEED_IDS.ownerId,
      name: "AgentBoard MVP",
      updated_at: nowIso(),
    });

    await this.client.from("repositories").insert(
      seed.repositories.map((repository) => ({
        id: repository.id,
        owner_profile_id: SEED_IDS.ownerId,
        github_repository_id: null,
        full_name: repository.fullName,
        default_branch: repository.defaultBranch,
        installation_id: repository.installationId ?? null,
        enabled: repository.enabled,
        updated_at: nowIso(),
      })),
    );

    await this.client.from("workflow_definitions").insert({
      id: SEED_IDS.workflowDefinitionId,
      board_id: SEED_IDS.boardId,
      key: "software-development",
      version: "1.0.0",
    });

    await this.client.from("workflow_stages").insert(
      seed.stages.map((stage) => ({
        workflow_definition_id: SEED_IDS.workflowDefinitionId,
        stage_id: stage.id,
        label: stage.label,
        order_index: stage.order,
      })),
    );

    await this.client.from("transition_policies").insert(
      seed.policies.map((policy) => ({
        id: policy.id,
        workflow_definition_id: SEED_IDS.workflowDefinitionId,
        from_stage_id: policy.fromStageId,
        to_stage_id: policy.toStageId,
        mode: policy.mode,
        condition: policy.condition,
        updated_at: policy.updatedAt,
      })),
    );

    await this.client.from("agent_definitions").insert(
      seed.agentDefinitions.map((agentDefinition) => ({
        id: agentDefinition.id,
        board_id: SEED_IDS.boardId,
        role: agentDefinition.role,
        version: agentDefinition.version,
        prompt: agentDefinition.prompt,
        model: agentDefinition.model,
      })),
    );

    await this.client.from("specialization_profiles").insert(
      seed.specializationProfiles.map((profile) => ({
        id: profile.id,
        board_id: SEED_IDS.boardId,
        repository_id: profile.repositoryId,
        profile_type: profile.type,
        name: profile.name,
        guidance: profile.guidance,
      })),
    );

    await this.client.from("cards").insert(seed.cards.map((card) => this.serializeCard(card)));
  }

  private async readSnapshot(): Promise<BoardState> {
    const [ownerResult, boardResult, repositoriesResult, workflowResult, stagesResult, policiesResult, cardsResult, agentsResult, profilesResult] = await Promise.all([
      this.client.from("owner_profiles").select("id, display_name").eq("id", SEED_IDS.ownerId).maybeSingle(),
      this.client.from("boards").select("id, owner_profile_id, name").eq("id", SEED_IDS.boardId).maybeSingle(),
      this.client.from("repositories").select("id, owner_profile_id, github_repository_id, full_name, default_branch, installation_id, enabled").eq("owner_profile_id", SEED_IDS.ownerId),
      this.client.from("workflow_definitions").select("id").eq("board_id", SEED_IDS.boardId).maybeSingle(),
      this.client.from("workflow_stages").select("stage_id, label, order_index").eq("workflow_definition_id", SEED_IDS.workflowDefinitionId).order("order_index", { ascending: true }),
      this.client.from("transition_policies").select("id, from_stage_id, to_stage_id, mode, condition, updated_at").eq("workflow_definition_id", SEED_IDS.workflowDefinitionId),
      this.client.from("cards").select("*").eq("board_id", SEED_IDS.boardId),
      this.client.from("agent_definitions").select("id, role, version, prompt, model").eq("board_id", SEED_IDS.boardId),
      this.client.from("specialization_profiles").select("id, repository_id, profile_type, name, guidance").eq("board_id", SEED_IDS.boardId),
    ]);

    const errors = [ownerResult.error, boardResult.error, repositoriesResult.error, workflowResult.error, stagesResult.error, policiesResult.error, cardsResult.error, agentsResult.error, profilesResult.error].filter(Boolean);
    if (errors.length > 0) {
      throw new Error((errors[0] as { message: string }).message);
    }

    const cardIds = (cardsResult.data ?? []).map((row) => (row as { id: string }).id);
    const [agentRunsResult, reviewCyclesResult, reviewFindingsResult, testRunsResult, approvalsResult, githubOperationsResult, usageRecordsResult, artifactsResult, transitionsResult] = cardIds.length > 0
      ? await Promise.all([
          this.client.from("agent_runs").select("*").in("card_id", cardIds),
          this.client.from("review_cycles").select("*").in("card_id", cardIds),
          this.client.from("review_findings").select("*").in("card_id", cardIds),
          this.client.from("test_runs").select("*").in("card_id", cardIds),
          this.client.from("approvals").select("*").in("card_id", cardIds),
          this.client.from("github_operations").select("*").in("card_id", cardIds),
          this.client.from("usage_cost_records").select("*").in("card_id", cardIds),
          this.client.from("card_artifacts").select("*").in("card_id", cardIds),
          this.client.from("workflow_transition_audit").select("*").in("card_id", cardIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

    const runIds = (agentRunsResult.data ?? []).map((row) => (row as { id: string }).id);
    const runEventsResult = runIds.length > 0
      ? await this.client.from("run_events").select("*").in("run_id", runIds)
      : { data: [], error: null };

    const childErrors = [agentRunsResult.error, runEventsResult.error, reviewCyclesResult.error, reviewFindingsResult.error, testRunsResult.error, approvalsResult.error, githubOperationsResult.error, usageRecordsResult.error, artifactsResult.error, transitionsResult.error].filter(Boolean);
    if (childErrors.length > 0) {
      throw new Error((childErrors[0] as { message: string }).message);
    }

    const state: BoardState = {
      owner: {
        id: requireRow(ownerResult.data as { id: string; display_name: string } | null, "Owner not found.").id,
        displayName: requireRow(ownerResult.data as { id: string; display_name: string } | null, "Owner not found.").display_name,
      },
      repositories: (repositoriesResult.data ?? []).map((row) => this.deserializeRepository(row as Record<string, unknown>)),
      stages: (stagesResult.data ?? []).map((row) => this.deserializeStage(row as Record<string, unknown>)),
      cards: (cardsResult.data ?? []).map((row) => this.deserializeCard(row as Record<string, unknown>)),
      policies: (policiesResult.data ?? []).map((row) => this.deserializePolicy(row as Record<string, unknown>)),
      agentDefinitions: (agentsResult.data ?? []).map((row) => this.deserializeAgentDefinition(row as Record<string, unknown>)),
      specializationProfiles: (profilesResult.data ?? []).map((row) => this.deserializeSpecializationProfile(row as Record<string, unknown>)),
      agentRuns: (agentRunsResult.data ?? []).map((row) => this.deserializeAgentRun(row as Record<string, unknown>)),
      runEvents: (runEventsResult.data ?? []).map((row) => this.deserializeRunEvent(row as Record<string, unknown>)),
      reviewCycles: (reviewCyclesResult.data ?? []).map((row) => this.deserializeReviewCycle(row as Record<string, unknown>)),
      reviewFindings: (reviewFindingsResult.data ?? []).map((row) => this.deserializeReviewFinding(row as Record<string, unknown>)),
      testRuns: (testRunsResult.data ?? []).map((row) => this.deserializeTestRun(row as Record<string, unknown>)),
      approvals: (approvalsResult.data ?? []).map((row) => this.deserializeApproval(row as Record<string, unknown>)),
      githubOperations: (githubOperationsResult.data ?? []).map((row) => this.deserializeGitHubOperation(row as Record<string, unknown>)),
      usageRecords: (usageRecordsResult.data ?? []).map((row) => this.deserializeUsageRecord(row as Record<string, unknown>)),
      artifacts: (artifactsResult.data ?? []).map((row) => this.deserializeArtifact(row as Record<string, unknown>)),
      transitions: (transitionsResult.data ?? []).map((row) => this.deserializeTransition(row as Record<string, unknown>)),
      idempotencyResults: Object.fromEntries(
        (transitionsResult.data ?? []).map((row) => {
          const transition = this.deserializeTransition(row as Record<string, unknown>);
          return [transition.idempotencyKey, transition] as const;
        }),
      ),
    };

    return state;
  }

  private async persistState(): Promise<void> {
    const state = this.state;
    if (!state) {
      throw new Error("Board state is not initialized.");
    }

    await this.client.from("owner_profiles").delete().eq("id", SEED_IDS.ownerId);

    await this.client.from("owner_profiles").insert({
      id: SEED_IDS.ownerId,
      email: "owner@example.com",
      display_name: state.owner.displayName,
      updated_at: nowIso(),
    });

    await this.client.from("boards").delete().eq("id", SEED_IDS.boardId);
    await this.client.from("boards").insert({
      id: SEED_IDS.boardId,
      owner_profile_id: SEED_IDS.ownerId,
      name: "AgentBoard MVP",
      updated_at: nowIso(),
    });

    await this.client.from("repositories").delete().eq("owner_profile_id", SEED_IDS.ownerId);
    if (state.repositories.length > 0) {
      await this.client.from("repositories").insert(
        state.repositories.map((repository) => ({
          id: repository.id,
          owner_profile_id: SEED_IDS.ownerId,
          github_repository_id: repository.installationId ?? null,
          full_name: repository.fullName,
          default_branch: repository.defaultBranch,
          installation_id: repository.installationId ?? null,
          enabled: repository.enabled,
          updated_at: nowIso(),
        })),
      );
    }

    await this.client.from("workflow_definitions").delete().eq("board_id", SEED_IDS.boardId);
    await this.client.from("workflow_definitions").insert({
      id: SEED_IDS.workflowDefinitionId,
      board_id: SEED_IDS.boardId,
      key: "software-development",
      version: "1.0.0",
    });

    await this.client.from("workflow_stages").delete().eq("workflow_definition_id", SEED_IDS.workflowDefinitionId);
    await this.client.from("workflow_stages").insert(
      state.stages.map((stage) => ({
        workflow_definition_id: SEED_IDS.workflowDefinitionId,
        stage_id: stage.id,
        label: stage.label,
        order_index: stage.order,
      })),
    );

    await this.client.from("transition_policies").delete().eq("workflow_definition_id", SEED_IDS.workflowDefinitionId);
    await this.client.from("transition_policies").insert(
      state.policies.map((policy) => ({
        id: policy.id,
        workflow_definition_id: SEED_IDS.workflowDefinitionId,
        from_stage_id: policy.fromStageId,
        to_stage_id: policy.toStageId,
        mode: policy.mode,
        condition: policy.condition,
        updated_at: policy.updatedAt,
      })),
    );

    await this.client.from("agent_definitions").delete().eq("board_id", SEED_IDS.boardId);
    await this.client.from("agent_definitions").insert(
      state.agentDefinitions.map((agentDefinition) => ({
        id: agentDefinition.id,
        board_id: SEED_IDS.boardId,
        role: agentDefinition.role,
        version: agentDefinition.version,
        prompt: agentDefinition.prompt,
        model: agentDefinition.model,
      })),
    );

    await this.client.from("specialization_profiles").delete().eq("board_id", SEED_IDS.boardId);
    await this.client.from("specialization_profiles").insert(
      state.specializationProfiles.map((profile) => ({
        id: profile.id,
        board_id: SEED_IDS.boardId,
        repository_id: profile.repositoryId,
        profile_type: profile.type,
        name: profile.name,
        guidance: profile.guidance,
      })),
    );

    const cardIds = state.cards.map((card) => card.id);

    await this.client.from("workflow_transition_audit").delete().in("card_id", cardIds);
    await this.client.from("card_artifacts").delete().in("card_id", cardIds);
    await this.client.from("usage_cost_records").delete().in("card_id", cardIds);
    await this.client.from("github_operations").delete().in("card_id", cardIds);
    await this.client.from("approvals").delete().in("card_id", cardIds);
    await this.client.from("test_runs").delete().in("card_id", cardIds);
    await this.client.from("review_findings").delete().in("card_id", cardIds);
    await this.client.from("review_cycles").delete().in("card_id", cardIds);
    await this.client.from("run_events").delete().in("run_id", state.agentRuns.map((run) => run.id));
    await this.client.from("agent_runs").delete().in("card_id", cardIds);
    await this.client.from("cards").delete().eq("board_id", SEED_IDS.boardId);

    await this.client.from("cards").insert(state.cards.map((card) => this.serializeCard(card)));

    if (state.agentRuns.length > 0) {
      await this.client.from("agent_runs").insert(
        state.agentRuns.map((run) => ({
          id: run.id,
          card_id: run.cardId,
          role: run.role,
          stage_id: run.stageId,
          status: run.status,
          prompt_version: run.promptVersion,
          cycle_number: run.cycleNumber,
          token_usage: run.tokenUsage,
          estimated_cost_usd: run.estimatedCostUsd,
          output_summary: run.outputSummary,
          started_at: run.startedAt,
          ended_at: run.endedAt,
        })),
      );
    }

    if (state.runEvents.length > 0) {
      await this.client.from("run_events").insert(
        state.runEvents.map((event) => ({
          id: event.id,
          run_id: event.runId,
          event_type: event.eventType,
          payload: event.payload,
          created_at: event.createdAt,
        })),
      );
    }

    if (state.reviewCycles.length > 0) {
      await this.client.from("review_cycles").insert(
        state.reviewCycles.map((cycle) => ({
          id: cycle.id,
          card_id: cycle.cardId,
          cycle_number: cycle.cycleNumber,
          unresolved_count: cycle.unresolvedCount,
          created_at: cycle.createdAt,
        })),
      );
    }

    if (state.reviewFindings.length > 0) {
      await this.client.from("review_findings").insert(
        state.reviewFindings.map((finding) => ({
          id: finding.id,
          card_id: finding.cardId,
          cycle_number: finding.cycleNumber,
          stable_id: finding.stableId,
          severity: finding.severity,
          category: finding.category,
          title: finding.title,
          description: finding.description,
          evidence: finding.evidence,
          file_path: finding.filePath,
          line_number: finding.lineNumber,
          required_outcome: finding.requiredOutcome,
          status: finding.status,
          resolution_evidence: finding.resolutionEvidence,
          resolution_commit: finding.resolutionCommit,
          dismissal_justification: finding.dismissalJustification,
          created_at: finding.createdAt,
          updated_at: finding.updatedAt,
        })),
      );
    }

    if (state.testRuns.length > 0) {
      await this.client.from("test_runs").insert(
        state.testRuns.map((run) => ({
          id: run.id,
          card_id: run.cardId,
          cycle_number: run.cycleNumber,
          status: run.status,
          mandatory_checks_passed: run.mandatoryChecksPassed,
          evidence: run.evidence,
          created_at: run.createdAt,
        })),
      );
    }

    if (state.approvals.length > 0) {
      await this.client.from("approvals").insert(
        state.approvals.map((approval) => ({
          id: approval.id,
          card_id: approval.cardId,
          kind: approval.kind,
          approved: approval.approved,
          justification: approval.justification,
          actor_type: approval.actorType,
          actor_id: approval.actorId,
          consumed_at: approval.consumedAt,
          created_at: approval.createdAt,
        })),
      );
    }

    if (state.githubOperations.length > 0) {
      await this.client.from("github_operations").insert(
        state.githubOperations.map((operation) => ({
          id: operation.id,
          card_id: operation.cardId,
          operation_type: operation.operationType,
          status: operation.status,
          external_id: operation.externalId,
          metadata: operation.metadata,
          created_at: operation.createdAt,
        })),
      );
    }

    if (state.usageRecords.length > 0) {
      await this.client.from("usage_cost_records").insert(
        state.usageRecords.map((record) => ({
          id: record.id,
          card_id: record.cardId,
          run_id: record.runId,
          model: record.model,
          token_usage: record.tokenUsage,
          estimated_cost_usd: record.estimatedCostUsd,
          created_at: record.createdAt,
        })),
      );
    }

    if (state.artifacts.length > 0) {
      await this.client.from("card_artifacts").insert(
        state.artifacts.map((artifact) => ({
          id: artifact.id,
          card_id: artifact.cardId,
          run_id: artifact.runId,
          artifact_type: artifact.type,
          label: artifact.label,
          url: artifact.url,
          created_at: artifact.createdAt,
        })),
      );
    }

    if (state.transitions.length > 0) {
      await this.client.from("workflow_transition_audit").insert(
        state.transitions.map((transition) => ({
          id: transition.id,
          card_id: transition.cardId,
          from_stage_id: transition.fromStageId,
          to_stage_id: transition.toStageId,
          decision: transition.decision,
          reason: transition.reason,
          idempotency_key: transition.idempotencyKey,
          actor_type: transition.actorType,
          actor_id: transition.actorId,
          before_state: transition.beforeState,
          after_state: transition.afterState,
          created_at: transition.createdAt,
        })),
      );
    }
  }

  private deserializeRepository(row: Record<string, unknown>): Repository {
    const fullName = String(row.full_name);
    return {
      id: String(row.id),
      owner: fullName.split("/")[0] ?? String(row.owner_profile_id),
      name: fullName.split("/").at(-1) ?? fullName,
      fullName,
      defaultBranch: String(row.default_branch ?? "main"),
      installationId: toStringOrNull(row.installation_id) ?? undefined,
      enabled: toBoolean(row.enabled, true),
    };
  }

  private deserializeStage(row: Record<string, unknown>): Stage {
    return {
      id: String(row.stage_id) as StageId,
      label: String(row.label),
      order: toNumber(row.order_index),
    };
  }

  private deserializePolicy(row: Record<string, unknown>): TransitionPolicy {
    return {
      id: String(row.id),
      fromStageId: String(row.from_stage_id) as TransitionPolicy["fromStageId"],
      toStageId: String(row.to_stage_id) as TransitionPolicy["toStageId"],
      mode: String(row.mode) as TransitionPolicyMode,
      condition: row.condition as TransitionPolicy["condition"],
      updatedAt: String(row.updated_at ?? nowIso()),
    };
  }

  private deserializeCard(row: Record<string, unknown>): Card {
    return {
      id: String(row.id),
      title: String(row.title),
      description: String(row.description),
      repositoryId: toStringOrNull(row.repository_id),
      stageId: String(row.stage_id) as StageId,
      classification: (row.classification ?? null) as Classification | null,
      specializationTags: Array.isArray(row.specialization_tags) ? row.specialization_tags.map(String) : [],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      autoReviewLoopCount: toNumber(row.auto_review_loop_count),
      manualRemediationCredits: toNumber(row.manual_remediation_credits),
      remediationAttemptCount: toNumber(row.remediation_attempt_count),
      reviewCycleCount: toNumber(row.review_cycle_count),
      blockedReason: toStringOrNull(row.blocked_reason),
      estimatedCostUsd: toNumber(row.estimated_cost_usd),
      tokenUsage: toNumber(row.token_usage),
      mergeApprovedAt: toStringOrNull(row.merge_approved_at),
      demoResolveFindingsOnAttempt: 4,
    };
  }

  private deserializeAgentDefinition(row: Record<string, unknown>): AgentDefinition {
    return {
      id: String(row.id),
      role: String(row.role) as AgentDefinition["role"],
      version: String(row.version),
      prompt: String(row.prompt),
      model: String(row.model),
    };
  }

  private deserializeSpecializationProfile(row: Record<string, unknown>): SpecializationProfile {
    return {
      id: String(row.id),
      type: String(row.profile_type) as SpecializationProfile["type"],
      name: String(row.name),
      guidance: String(row.guidance),
      repositoryId: toStringOrNull(row.repository_id),
    };
  }

  private deserializeAgentRun(row: Record<string, unknown>) {
    return {
      id: String(row.id),
      cardId: String(row.card_id),
      role: String(row.role) as BoardState["agentRuns"][number]["role"],
      stageId: String(row.stage_id) as StageId,
      status: String(row.status) as BoardState["agentRuns"][number]["status"],
      startedAt: String(row.started_at),
      endedAt: toStringOrNull(row.ended_at),
      promptVersion: String(row.prompt_version),
      tokenUsage: toNumber(row.token_usage),
      estimatedCostUsd: toNumber(row.estimated_cost_usd),
      outputSummary: String(row.output_summary),
      cycleNumber: toNumber(row.cycle_number),
    };
  }

  private deserializeRunEvent(row: Record<string, unknown>) {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      eventType: String(row.event_type),
      payload: (row.payload ?? {}) as Record<string, unknown>,
      createdAt: String(row.created_at),
    };
  }

  private deserializeReviewCycle(row: Record<string, unknown>): ReviewCycle {
    return {
      id: String(row.id),
      cardId: String(row.card_id),
      cycleNumber: toNumber(row.cycle_number),
      unresolvedCount: toNumber(row.unresolved_count),
      createdAt: String(row.created_at),
    };
  }

  private deserializeReviewFinding(row: Record<string, unknown>): ReviewFinding {
    return {
      id: String(row.id),
      cardId: String(row.card_id),
      cycleNumber: toNumber(row.cycle_number),
      stableId: String(row.stable_id),
      severity: String(row.severity) as ReviewFinding["severity"],
      category: String(row.category),
      title: String(row.title),
      description: String(row.description),
      evidence: String(row.evidence),
      filePath: toStringOrNull(row.file_path),
      lineNumber: typeof row.line_number === "number" ? row.line_number : null,
      requiredOutcome: String(row.required_outcome),
      status: String(row.status) as ReviewFinding["status"],
      resolutionEvidence: toStringOrNull(row.resolution_evidence),
      resolutionCommit: toStringOrNull(row.resolution_commit),
      dismissalJustification: toStringOrNull(row.dismissal_justification),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private deserializeTestRun(row: Record<string, unknown>): TestRun {
    return {
      id: String(row.id),
      cardId: String(row.card_id),
      cycleNumber: toNumber(row.cycle_number),
      status: String(row.status) as TestRun["status"],
      mandatoryChecksPassed: toBoolean(row.mandatory_checks_passed),
      evidence: String(row.evidence),
      createdAt: String(row.created_at),
    };
  }

  private deserializeApproval(row: Record<string, unknown>): Approval {
    return {
      id: String(row.id),
      cardId: String(row.card_id),
      kind: String(row.kind) as Approval["kind"],
      approved: toBoolean(row.approved),
      justification: String(row.justification),
      actorType: String(row.actor_type) as Approval["actorType"],
      actorId: String(row.actor_id),
      createdAt: String(row.created_at),
      consumedAt: toStringOrNull(row.consumed_at),
    };
  }

  private deserializeGitHubOperation(row: Record<string, unknown>): GitHubOperation {
    return {
      id: String(row.id),
      cardId: String(row.card_id),
      operationType: String(row.operation_type) as GitHubOperation["operationType"],
      status: String(row.status) as GitHubOperation["status"],
      externalId: toStringOrNull(row.external_id),
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      createdAt: String(row.created_at),
    };
  }

  private deserializeUsageRecord(row: Record<string, unknown>): UsageRecord {
    return {
      id: String(row.id),
      cardId: String(row.card_id),
      runId: toStringOrNull(row.run_id),
      model: String(row.model),
      tokenUsage: toNumber(row.token_usage),
      estimatedCostUsd: toNumber(row.estimated_cost_usd),
      createdAt: String(row.created_at),
    };
  }

  private deserializeArtifact(row: Record<string, unknown>): Artifact {
    return {
      id: String(row.id),
      cardId: String(row.card_id),
      runId: toStringOrNull(row.run_id),
      type: String(row.artifact_type) as Artifact["type"],
      label: String(row.label),
      url: String(row.url),
      createdAt: String(row.created_at),
    };
  }

  private deserializeTransition(row: Record<string, unknown>): TransitionLog {
    return {
      id: String(row.id),
      cardId: String(row.card_id),
      fromStageId: String(row.from_stage_id) as TransitionLog["fromStageId"],
      toStageId: String(row.to_stage_id) as TransitionLog["toStageId"],
      decision: String(row.decision) as TransitionLog["decision"],
      reason: String(row.reason),
      idempotencyKey: String(row.idempotency_key),
      actorType: String(row.actor_type) as TransitionLog["actorType"],
      actorId: String(row.actor_id),
      beforeState: (row.before_state ?? {}) as Record<string, unknown>,
      afterState: (row.after_state ?? {}) as Record<string, unknown>,
      createdAt: String(row.created_at),
    };
  }

  private serializeCard(card: Card) {
    return {
      id: card.id,
      board_id: SEED_IDS.boardId,
      repository_id: card.repositoryId,
      title: card.title,
      description: card.description,
      stage_id: card.stageId,
      classification: card.classification,
      specialization_tags: card.specializationTags,
      auto_review_loop_count: card.autoReviewLoopCount,
      manual_remediation_credits: card.manualRemediationCredits,
      remediation_attempt_count: card.remediationAttemptCount,
      review_cycle_count: card.reviewCycleCount,
      blocked_reason: card.blockedReason,
      merge_approved_at: card.mergeApprovedAt,
      token_usage: card.tokenUsage,
      estimated_cost_usd: card.estimatedCostUsd,
      created_at: card.createdAt,
      updated_at: card.updatedAt,
    };
  }

  async getSnapshot(): Promise<BoardState> {
    await this.ensureLoaded();
    return clone(requireRow(this.state, "Board state is not initialized."));
  }

  async reset(): Promise<BoardState> {
    this.state = createSeedState();
    await this.persistState();
    return this.getSnapshot();
  }

  async createCard(input: { title: string; description: string; repositoryId: string | null }): Promise<Card> {
    await this.ensureLoaded();
    const state = requireRow(this.state, "Board state is not initialized.");
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
    await this.persistState();
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
    const state = requireRow(this.state, "Board state is not initialized.");
    const card = state.cards.find((item) => item.id === cardId);
    if (!card) {
      throw new Error("Card not found.");
    }

    if (input.title !== undefined) card.title = input.title;
    if (input.description !== undefined) card.description = input.description;
    if (input.repositoryId !== undefined) card.repositoryId = input.repositoryId;
    if (input.demoResolveFindingsOnAttempt !== undefined) card.demoResolveFindingsOnAttempt = input.demoResolveFindingsOnAttempt;

    card.updatedAt = nowIso();
    await this.persistState();
    return clone(card);
  }

  async setClassification(cardId: string, classification: Classification): Promise<Card> {
    await this.ensureLoaded();
    const state = requireRow(this.state, "Board state is not initialized.");
    const card = state.cards.find((item) => item.id === cardId);
    if (!card) {
      throw new Error("Card not found.");
    }

    card.classification = classification;
    card.specializationTags = classification.specializations;
    card.updatedAt = nowIso();
    await this.persistState();
    return clone(card);
  }

  async transitionCard(cardId: string, toStageId: StageId, idempotencyKey: string, actorId: string): Promise<BoardState> {
    await this.ensureLoaded();
    const state = requireRow(this.state, "Board state is not initialized.");
    applyTransition(state, cardId, toStageId, idempotencyKey, {
      actorType: "human",
      actorId,
    });
    await this.persistState();
    return this.getSnapshot();
  }

  async approve(cardId: string, input: { kind: "remediation" | "merge"; approved: boolean; justification: string }, actorId: string): Promise<BoardState> {
    await this.ensureLoaded();
    const state = requireRow(this.state, "Board state is not initialized.");
    const card = state.cards.find((item) => item.id === cardId);
    if (!card) {
      throw new Error("Card not found.");
    }

    recordApproval(state, card, input, {
      actorType: "human",
      actorId,
    });
    await this.persistState();
    return this.getSnapshot();
  }

  async dismissFinding(cardId: string, findingId: string, justification: string, actorId: string): Promise<BoardState> {
    await this.ensureLoaded();
    const state = requireRow(this.state, "Board state is not initialized.");
    const card = state.cards.find((item) => item.id === cardId);
    if (!card) {
      throw new Error("Card not found.");
    }

    dismissFinding(state, card, findingId, justification, {
      actorType: "human",
      actorId,
    });
    await this.persistState();
    return this.getSnapshot();
  }

  async setPolicyMode(policyId: string, mode: TransitionPolicyMode): Promise<BoardState> {
    await this.ensureLoaded();
    const state = requireRow(this.state, "Board state is not initialized.");
    const policy = state.policies.find((item) => item.id === policyId);
    if (!policy) {
      throw new Error("Policy not found.");
    }

    policy.mode = mode;
    policy.updatedAt = nowIso();
    await this.persistState();
    return this.getSnapshot();
  }
}