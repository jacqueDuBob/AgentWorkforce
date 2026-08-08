import { ensureSupabaseSession, supabase } from "./supabase";
import type { GitHubRepository } from "./types";

export async function loadRepositories(): Promise<GitHubRepository[]> {
  if (!supabase) return [];
  await ensureSupabaseSession();
  const { data, error } = await supabase.from("github_repositories").select("*").order("owner").order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, owner: row.owner, name: row.name, defaultBranch: row.default_branch }));
}

export async function addRepository(repository: Omit<GitHubRepository, "id">): Promise<GitHubRepository> {
  if (!supabase) throw new Error("Supabase is required.");
  await ensureSupabaseSession();
  const { data, error } = await supabase.from("github_repositories").insert({ owner: repository.owner, name: repository.name, default_branch: repository.defaultBranch }).select().single();
  if (error) throw error;
  return { id: data.id, owner: data.owner, name: data.name, defaultBranch: data.default_branch };
}

export async function deleteRepository(id: string) {
  if (!supabase) return;
  await ensureSupabaseSession();
  const { error } = await supabase.from("github_repositories").delete().eq("id", id);
  if (error) throw error;
}
