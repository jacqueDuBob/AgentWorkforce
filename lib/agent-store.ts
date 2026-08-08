import { ensureSupabaseSession, supabase } from "./supabase";
import { COLUMNS, type ColumnId } from "./types";
import { DEFAULT_AGENT_INSTRUCTIONS, type ColumnAgent } from "./agent-types";

const defaults = (): ColumnAgent[] => COLUMNS.map((column) => ({
  column, name: `${column} Agent`, instructions: DEFAULT_AGENT_INSTRUCTIONS[column],
  startMode: "manual", enabled: true, githubOwner: "", githubRepo: "", baseBranch: "main",
}));

export async function loadColumnAgents(): Promise<ColumnAgent[]> {
  if (!supabase) return defaults();
  await ensureSupabaseSession();
  const { data, error } = await supabase.from("column_agents").select("*");
  if (error) throw error;
  const saved = new Map((data ?? []).map((row) => [row.column_name as ColumnId, row]));
  return defaults().map((fallback) => {
    const row = saved.get(fallback.column);
    return row ? { id: row.id, column: fallback.column, name: row.name, instructions: row.instructions, startMode: row.start_mode, enabled: row.enabled, githubOwner: row.github_owner ?? "", githubRepo: row.github_repo ?? "", baseBranch: row.base_branch ?? "main" } : fallback;
  });
}

export async function saveColumnAgent(agent: ColumnAgent) {
  if (!supabase) return;
  await ensureSupabaseSession();
  const { error } = await supabase.from("column_agents").upsert({ column_name: agent.column, name: agent.name, instructions: agent.instructions, start_mode: agent.startMode, enabled: agent.enabled, github_owner: agent.githubOwner, github_repo: agent.githubRepo, base_branch: agent.baseBranch }, { onConflict: "user_id,column_name" });
  if (error) throw error;
}

export async function queueAgentRun(ticketId: string, agent: ColumnAgent, trigger: "manual" | "automatic") {
  if (!supabase) throw new Error("Supabase is required to run agents.");
  await ensureSupabaseSession();
  const { error } = await supabase.from("agent_runs").insert({ ticket_id: ticketId, column_name: agent.column, agent_name: agent.name, trigger_type: trigger, status: "queued" });
  if (error) throw error;
}
