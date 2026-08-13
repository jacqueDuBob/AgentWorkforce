import { ensureSupabaseSession, supabase } from "./supabase";

function isMissingWorkspaceSettings(error: { code?: string; message?: string }) {
  return error.code === "42P01" || error.code === "PGRST205" ||
    Boolean(error.message?.includes("workspace_settings") && error.message.includes("schema cache"));
}

export async function loadMasterInstructions(): Promise<string> {
  if (!supabase) return "";
  await ensureSupabaseSession();
  const { data, error } = await supabase.from("workspace_settings").select("master_instructions").maybeSingle();
  if (error) {
    // Master instructions were added after the core board schema. Keep the board
    // usable for existing installations until migration 005 is applied.
    if (isMissingWorkspaceSettings(error)) return "";
    throw error;
  }
  return data?.master_instructions ?? "";
}

export async function saveMasterInstructions(instructions: string): Promise<void> {
  if (!supabase) return;
  await ensureSupabaseSession();
  const { error } = await supabase.from("workspace_settings").upsert({ master_instructions: instructions.trim(), updated_at: new Date().toISOString() });
  if (error) throw error;
}
