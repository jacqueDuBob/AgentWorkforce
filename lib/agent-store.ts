import { ensureSupabaseSession, supabase } from "./supabase";
import { COLUMNS, type ColumnId } from "./types";
import { DEFAULT_AGENT_INSTRUCTIONS, type ColumnAgent } from "./agent-types";

const defaults = (): ColumnAgent[] => COLUMNS.map((column) => ({
  column, name: `${column} Agent`, modelName: "gpt-5.6-luna", instructions: DEFAULT_AGENT_INSTRUCTIONS[column],
  startMode: "manual", enabled: true, repositoryAccess: "all", allowedRepositoryIds: [],
}));

export async function loadColumnAgents(): Promise<ColumnAgent[]> {
  if (!supabase) return defaults();
  await ensureSupabaseSession();
  const [{ data, error }, { data: permissions, error: permissionsError }] = await Promise.all([
    supabase.from("column_agents").select("*"), supabase.from("column_agent_repositories").select("column_agent_id,repository_id"),
  ]);
  if (error) throw error;
  if (permissionsError) throw permissionsError;
  const saved = new Map((data ?? []).map((row) => [row.column_name as ColumnId, row]));
  return defaults().map((fallback) => {
    const row = saved.get(fallback.column);
    return row ? { id: row.id, column: fallback.column, name: row.name, modelName: row.model_name ?? fallback.modelName, instructions: row.instructions, startMode: row.start_mode, enabled: row.enabled, repositoryAccess: row.repository_access ?? "all", allowedRepositoryIds: (permissions ?? []).filter((item) => item.column_agent_id === row.id).map((item) => item.repository_id) } : fallback;
  });
}

export async function saveColumnAgent(agent: ColumnAgent) {
  if (!supabase) return;
  await ensureSupabaseSession();
  const { data, error } = await supabase.from("column_agents").upsert({ column_name: agent.column, name: agent.name, model_name: agent.modelName, instructions: agent.instructions, start_mode: agent.startMode, enabled: agent.enabled, repository_access: agent.repositoryAccess }, { onConflict: "user_id,column_name" }).select("id").single();
  if (error) throw error;
  const agentId = data.id;
  const { error: deleteError } = await supabase.from("column_agent_repositories").delete().eq("column_agent_id", agentId);
  if (deleteError) throw deleteError;
  if (agent.repositoryAccess === "selected" && agent.allowedRepositoryIds.length) {
    const { error: insertError } = await supabase.from("column_agent_repositories").insert(agent.allowedRepositoryIds.map((repositoryId) => ({ column_agent_id: agentId, repository_id: repositoryId })));
    if (insertError) throw insertError;
  }
}

export async function queueAgentRun(ticketId: string, agent: ColumnAgent, trigger: "manual" | "automatic", output?: Record<string, unknown>) {
  if (!supabase) throw new Error("Supabase is required to run agents.");
  await ensureSupabaseSession();
  const { error } = await supabase.from("agent_runs").insert({ ticket_id: ticketId, column_name: agent.column, agent_name: agent.name, model_name: agent.modelName, trigger_type: trigger, status: "queued", output });
  if (error) throw error;
}
