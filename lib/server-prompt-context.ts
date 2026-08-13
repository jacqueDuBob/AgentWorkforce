import "server-only";

import { getSupabaseAdmin } from "./supabase-admin";

export async function loadRefinementPromptContext(userId: string) {
  const admin = getSupabaseAdmin();
  const [{ data: agent, error: agentError }, { data: settings }, { data: repositories, error: repositoriesError }] = await Promise.all([
    admin.from("column_agents").select("*").eq("column_name", "In Refinement").single(),
    admin.from("workspace_settings").select("master_instructions").eq("user_id", userId).maybeSingle(),
    admin.from("github_repositories").select("id,owner,name,default_branch").eq("user_id", userId).order("owner").order("name"),
  ]);
  if (agentError) throw agentError;
  if (repositoriesError) throw repositoriesError;

  let allowedRepositories = repositories ?? [];
  if (agent.repository_access === "selected") {
    const { data: permissions, error } = await admin.from("column_agent_repositories")
      .select("repository_id").eq("column_agent_id", agent.id);
    if (error) throw error;
    const allowedIds = new Set((permissions ?? []).map((item) => item.repository_id));
    allowedRepositories = allowedRepositories.filter((repository) => allowedIds.has(repository.id));
  }

  return { admin, agent, masterInstructions: settings?.master_instructions ?? "", repositories: allowedRepositories };
}

export function serializeRepositories(repositories: Array<{ id: string; owner: string; name: string; default_branch: string }>) {
  return repositories.length
    ? repositories.map((repository) => ({ id: repository.id, name: `${repository.owner}/${repository.name}`, defaultBranch: repository.default_branch }))
    : [];
}
