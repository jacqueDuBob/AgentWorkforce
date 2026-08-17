import "server-only";

import { randomUUID } from "node:crypto";
import { renderPromptTemplate } from "./prompt-template";
import { getSupabaseAdmin } from "./supabase-admin";
import {
  assertRepositoryAuthorization, buildJobSpecV1, jobTypeForColumn,
  validateVerificationPlan, type JobSpecV1, type JobType, type VerificationPlanV1,
} from "@/shared/job-contract.mjs";

type Trigger = "manual" | "automatic";
type RefinementAction = "questions" | "rewrite";

function verificationPlanFor(repositoryKey: string, jobType: JobType): VerificationPlanV1 {
  const serialized = process.env.FLOWBOARD_VERIFICATION_PLANS?.trim();
  if (!serialized) return { version: 1, checks: [], trustedPackageScripts: {} };
  let configuration: unknown;
  try { configuration = JSON.parse(serialized); }
  catch { throw new Error("FLOWBOARD_VERIFICATION_PLANS must be valid JSON."); }
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) throw new Error("FLOWBOARD_VERIFICATION_PLANS must map owner/name to verification checks.");
  const raw = (configuration as Record<string, unknown>)[repositoryKey];
  if (!raw) return { version: 1, checks: [], trustedPackageScripts: {} };
  const rawChecks = Array.isArray(raw) ? raw : (raw as { checks?: unknown }).checks;
  if (!Array.isArray(rawChecks)) throw new Error(`Verification plan for ${repositoryKey} must contain checks.`);
  const checks = rawChecks.filter((check) => {
    const types = check && typeof check === "object" ? (check as { jobTypes?: unknown }).jobTypes : undefined;
    if (types !== undefined && (!Array.isArray(types) || !types.length || !types.every((type) => ["development", "review", "testing"].includes(String(type))))) {
      throw new Error(`Verification plan for ${repositoryKey} contains invalid jobTypes.`);
    }
    return types === undefined || types.includes(jobType);
  }).map((check) => {
    const value = check as Record<string, unknown>;
    return { id: value.id, executable: value.executable, args: value.args, timeoutMs: value.timeoutMs ?? 600_000 };
  });
  return validateVerificationPlan({ version: 1, checks, trustedPackageScripts: {} });
}

function ticketSnapshot(ticket: Record<string, unknown>) {
  return {
    id: String(ticket.id), title: String(ticket.title), description: String(ticket.description ?? ""),
    findings: String(ticket.findings ?? ""), acceptanceCriteria: ticket.acceptance_criteria_items ?? [],
    priority: ticket.priority, tags: ticket.tags ?? [], status: ticket.status,
    baseBranch: String(ticket.base_branch ?? ""), itemType: ticket.item_type ?? "Item",
  };
}

function repositorySnapshot(repository: Record<string, unknown> | null) {
  return repository ? {
    id: String(repository.id), owner: String(repository.owner), name: String(repository.name),
    defaultBranch: String(repository.default_branch),
  } : null;
}

function refinementPromptRepository(repository: Record<string, unknown>) {
  return {
    id: String(repository.id), name: `${String(repository.owner)}/${String(repository.name)}`,
    defaultBranch: String(repository.default_branch),
  };
}

async function loadOwnedTicket(userId: string, ticketId: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("tickets").select("*").eq("id", ticketId).eq("user_id", userId).single();
  if (error) throw error;
  return { admin, ticket: data as Record<string, unknown> };
}

async function loadAgent(column: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("column_agents").select("*").eq("column_name", column).single();
  if (error) throw error;
  if (!data.enabled) throw new Error(`The ${column} agent is disabled.`);
  return data as Record<string, unknown>;
}

async function loadAuthorizedRepository(userId: string, agent: Record<string, unknown>, repositoryId: unknown) {
  if (!repositoryId) return null;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("github_repositories").select("*")
    .eq("id", String(repositoryId)).eq("user_id", userId).single();
  if (error) throw error;
  if (agent.repository_access === "selected") {
    const { data: permissions, error: permissionError } = await admin.from("column_agent_repositories")
      .select("repository_id").eq("column_agent_id", String(agent.id));
    if (permissionError) throw permissionError;
    assertRepositoryAuthorization(agent.repository_access, String(repositoryId), (permissions ?? []).map((item) => item.repository_id));
  }
  return data as Record<string, unknown>;
}

async function workspaceInstructions(userId: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("workspace_settings").select("master_instructions").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data?.master_instructions ?? "";
}

async function persistJob(parameters: {
  userId: string; ticket: Record<string, unknown>; agent: Record<string, unknown>;
  repository: Record<string, unknown> | null; prompt: string; type: JobType; subtype?: string;
  trigger: Trigger; runKind: string; queueClass: "background" | "interactive"; input?: unknown;
}) {
  const admin = getSupabaseAdmin();
  const id = randomUUID();
  const repository = repositorySnapshot(parameters.repository);
  const spec = buildJobSpecV1({
    id, type: parameters.type, subtype: parameters.subtype,
    ticket: ticketSnapshot(parameters.ticket), repository, prompt: parameters.prompt,
    agent: { provider: "codex", name: String(parameters.agent.name), model: String(parameters.agent.model_name ?? "") || undefined },
    verificationPlan: verificationPlanFor(repository ? `${repository.owner}/${repository.name}` : "", parameters.type),
    input: parameters.input ?? {},
  }) as JobSpecV1;
  const compatibilityRow = {
    id, user_id: parameters.userId, ticket_id: parameters.ticket.id, column_name: parameters.ticket.status,
    agent_name: parameters.agent.name, model_name: parameters.agent.model_name,
    rendered_prompt: parameters.prompt, trigger_type: parameters.trigger, status: "queued",
    run_kind: parameters.runKind, queue_class: parameters.queueClass, run_input: parameters.input ?? {},
  };
  let { data, error } = await admin.from("agent_runs").insert({
    ...compatibilityRow,
    job_type: spec.type, job_spec_version: spec.version, permission_profile: spec.permissions.profile, job_spec: spec,
  }).select("id").single();
  // App-first rolling upgrades can queue legacy-compatible rows until migration
  // 020 is applied. After the columns exist, every new row takes the persisted path.
  if (error && ["42703", "PGRST204"].includes(error.code ?? "")) {
    const fallback = await admin.from("agent_runs").insert(compatibilityRow).select("id").single();
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;
  if (!data) throw new Error("The agent run could not be queued.");
  return data.id as string;
}

export async function queueColumnJob(userId: string, ticketId: string, trigger: Trigger) {
  const { ticket } = await loadOwnedTicket(userId, ticketId);
  const agent = await loadAgent(String(ticket.status));
  const repository = await loadAuthorizedRepository(userId, agent, ticket.repository_id);
  const prompt = renderPromptTemplate(String(agent.instructions), {
    ticket, repository: repositorySnapshot(repository), workspaceInstructions: await workspaceInstructions(userId),
    runContext: { trigger, queuedColumn: ticket.status },
  });
  return persistJob({
    userId, ticket, agent, repository, prompt, type: jobTypeForColumn(String(ticket.status)),
    trigger, runKind: "column", queueClass: "background", input: {},
  });
}

export async function queueRefinementJob(userId: string, request: {
  ticketId: string; repositoryId?: string; action: RefinementAction; answers?: unknown; proposal?: unknown;
}) {
  const { ticket } = await loadOwnedTicket(userId, request.ticketId);
  const agent = await loadAgent("In Refinement");
  const repository = await loadAuthorizedRepository(userId, agent, request.repositoryId);
  if (!repository) throw new Error("Select a repository available to the refinement agent.");
  const rewriting = request.action === "rewrite";
  const template = rewriting ? agent.refinement_rewrite_prompt : agent.refinement_questions_prompt;
  const prompt = renderPromptTemplate(String(template), {
    ticket, repository: refinementPromptRepository(repository), workspaceInstructions: await workspaceInstructions(userId),
    refinementAnswers: request.answers, agentName: String(agent.name),
  });
  return persistJob({
    userId, ticket: { ...ticket, status: "In Refinement" }, agent, repository, prompt, type: "refinement",
    subtype: request.action, trigger: "manual", runKind: rewriting ? "refinement_rewrite" : "refinement_questions",
    queueClass: "interactive", input: { repositoryId: request.repositoryId, proposal: request.proposal ?? null, answers: request.answers ?? null },
  });
}

export async function queueEpicBreakoutJob(userId: string, epicId: string, domain: string, requesterEmail: string) {
  const { ticket } = await loadOwnedTicket(userId, epicId);
  if (ticket.item_type !== "Epic") throw new Error("A confirmed Epic is required.");
  const agent = await loadAgent("In Refinement");
  const repository = await loadAuthorizedRepository(userId, agent, ticket.repository_id);
  if (!repository) throw new Error("The Epic must use a repository available to the refinement agent.");
  const prompt = renderPromptTemplate(String(agent.epic_breakout_prompt), {
    ticket, repository: refinementPromptRepository(repository), workspaceInstructions: await workspaceInstructions(userId),
    domain, requesterEmail, agentName: String(agent.name),
  });
  return persistJob({
    userId, ticket: { ...ticket, status: "In Refinement" }, agent, repository, prompt, type: "epic_breakout",
    trigger: "manual", runKind: "epic_breakout", queueClass: "interactive",
    input: { repositoryId: repository.id, domain },
  });
}

export async function queueDeploymentJob(userId: string, ticketId: string, idempotencyKey?: string) {
  if (idempotencyKey) {
    const { data: existing, error } = await getSupabaseAdmin().from("agent_runs").select("id")
      .eq("user_id", userId).eq("run_kind", "column").contains("run_input", { trigger: "post_push", idempotencyKey }).maybeSingle();
    if (error) throw error;
    if (existing) return existing.id as string;
  }
  const { ticket } = await loadOwnedTicket(userId, ticketId);
  const agent = await loadAgent("In Deployment");
  if (agent.start_mode !== "automatic") return null;
  const repository = await loadAuthorizedRepository(userId, agent, ticket.repository_id);
  const prompt = renderPromptTemplate(String(agent.instructions), {
    ticket, repository, workspaceInstructions: await workspaceInstructions(userId),
    runContext: { trigger: "post_push", queuedColumn: "In Deployment" },
  });
  return persistJob({
    userId, ticket: { ...ticket, status: "In Deployment" }, agent, repository, prompt, type: "deployment",
    trigger: "automatic", runKind: "column", queueClass: "background", input: { trigger: "post_push", idempotencyKey: idempotencyKey ?? null },
  });
}
