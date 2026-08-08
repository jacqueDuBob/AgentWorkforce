import { ensureSupabaseSession, supabase } from "./supabase";

export const DEFAULT_MASTER_INSTRUCTIONS = `Use the selected repository as the source of truth for technical context.
Follow established repository terminology, architecture, and conventions.
Distinguish confirmed facts from assumptions and unresolved questions.
Prefer small, reviewable changes and measurable acceptance criteria.
Do not invent requirements when behavior is ambiguous.`;

export async function loadMasterInstructions(): Promise<string> {
  if (!supabase) return DEFAULT_MASTER_INSTRUCTIONS;
  await ensureSupabaseSession();
  const { data, error } = await supabase.from("workspace_settings").select("master_instructions").maybeSingle();
  if (error) throw error;
  return data?.master_instructions || DEFAULT_MASTER_INSTRUCTIONS;
}

export async function saveMasterInstructions(instructions: string): Promise<void> {
  if (!supabase) return;
  await ensureSupabaseSession();
  const { error } = await supabase.from("workspace_settings").upsert({ master_instructions: instructions.trim(), updated_at: new Date().toISOString() });
  if (error) throw error;
}
