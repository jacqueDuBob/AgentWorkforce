import type { GitHubOperation, Repository } from "@/lib/domain/types";

export interface GitHubProvider {
  listRepositories(): Promise<Repository[]>;
  createTaskBranch(input: { repository: Repository; cardId: string }): Promise<GitHubOperation>;
  dispatchWorkflow(input: { repository: Repository; cardId: string; branch: string; role: string }): Promise<GitHubOperation>;
  upsertPullRequest(input: { repository: Repository; branch: string; title: string; body: string }): Promise<GitHubOperation>;
  mergePullRequest(input: { repository: Repository; cardId: string }): Promise<GitHubOperation>;
}
