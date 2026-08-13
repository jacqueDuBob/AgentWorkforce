import { ensureSupabaseSession, supabase } from "./supabase";
import { COLUMNS, type ColumnId } from "./types";
import type { AgentRun, AgentRunStatus, ColumnAgent } from "./agent-types";

export async function loadColumnAgents(): Promise<ColumnAgent[]> {
  if (!supabase) return [];
  await ensureSupabaseSession();
  const [{ data, error }, { data: permissions, error: permissionsError }] = await Promise.all([
    supabase.from("column_agents").select("*"), supabase.from("column_agent_repositories").select("column_agent_id,repository_id"),
  ]);
  if (error) throw error;
  if (permissionsError) throw permissionsError;
  const saved = new Map((data ?? []).map((row) => [row.column_name as ColumnId, row]));
  return COLUMNS.flatMap((column) => {
    const row = saved.get(column);
    return row ? [{ id: row.id, column, name: row.name, modelName: row.model_name, instructions: row.instructions,
      refinementQuestionsPrompt: row.refinement_questions_prompt ?? "", refinementRewritePrompt: row.refinement_rewrite_prompt ?? "",
      epicBreakoutPrompt: row.epic_breakout_prompt ?? "", startMode: row.start_mode, enabled: row.enabled,
      repositoryAccess: row.repository_access ?? "all", allowedRepositoryIds: (permissions ?? []).filter((item) => item.column_agent_id === row.id).map((item) => item.repository_id) }] : [];
  });
}

export async function saveColumnAgent(agent: ColumnAgent) {
  if (!supabase) return;
  await ensureSupabaseSession();
  const { data, error } = await supabase.from("column_agents").upsert({ column_name: agent.column, name: agent.name, model_name: agent.modelName, instructions: agent.instructions,
    refinement_questions_prompt: agent.refinementQuestionsPrompt, refinement_rewrite_prompt: agent.refinementRewritePrompt,
    epic_breakout_prompt: agent.epicBreakoutPrompt, start_mode: agent.startMode, enabled: agent.enabled,
    repository_access: agent.repositoryAccess }, { onConflict: "user_id,column_name" }).select("id").single();
  if (error) throw error;
  const agentId = data.id;
  const { error: deleteError } = await supabase.from("column_agent_repositories").delete().eq("column_agent_id", agentId);
  if (deleteError) throw deleteError;
  if (agent.repositoryAccess === "selected" && agent.allowedRepositoryIds.length) {
    const { error: insertError } = await supabase.from("column_agent_repositories").insert(agent.allowedRepositoryIds.map((repositoryId) => ({ column_agent_id: agentId, repository_id: repositoryId })));
    if (insertError) throw insertError;
  }
}

export async function queueAgentRun(ticketId: string, agent: ColumnAgent, trigger: "manual" | "automatic", renderedPrompt: string, output?: Record<string, unknown>) {
  if (!supabase) throw new Error("Supabase is required to run agents.");
  await ensureSupabaseSession();
  const { data, error } = await supabase.from("agent_runs").insert({ ticket_id: ticketId, column_name: agent.column, agent_name: agent.name, model_name: agent.modelName, rendered_prompt: renderedPrompt, trigger_type: trigger, status: "queued", output }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function updateAgentRunStatus(id: string, status: AgentRunStatus, details?: { output?: Record<string, unknown>; error?: string }) {
  if (!supabase) throw new Error("Supabase is required to update agent runs.");
  await ensureSupabaseSession();
  const values: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (details && "output" in details) values.output = details.output;
  if (details && "error" in details) values.error = details.error || null;
  const { error } = await supabase.from("agent_runs").update(values).eq("id", id);
  if (error) throw error;
}

export async function processAgentRun<T extends Record<string, unknown>>(id: string, process: () => Promise<T>) {
  await updateAgentRunStatus(id, "in_progress", { error: "" });
  try {
    const output = await process();
    await updateAgentRunStatus(id, "finished", { output, error: "" });
    return output;
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "The agent run failed.";
    await updateAgentRunStatus(id, "finished", { error });
    throw cause;
  }
}

export async function loadAgentRuns(): Promise<AgentRun[]> {
  if (!supabase) return [];
  await ensureSupabaseSession();
  const { data, error } = await supabase.from("agent_runs").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id, ticketId: row.ticket_id, column: row.column_name, agentName: row.agent_name,
    modelName: row.model_name ?? "", renderedPrompt: row.rendered_prompt ?? "", trigger: row.trigger_type, status: row.status,
    output: row.output ?? undefined, error: row.error ?? "", createdAt: row.created_at, updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined, finishedAt: row.finished_at ?? undefined,
  }));
}
