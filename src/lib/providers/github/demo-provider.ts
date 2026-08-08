import type { GitHubProvider } from "@/lib/providers/github/types";
import type { GitHubOperation, Repository } from "@/lib/domain/types";
import { makeId, nowIso } from "@/lib/utils/id";

function makeOperation(cardId: string, type: GitHubOperation["operationType"], metadata: Record<string, unknown>): GitHubOperation {
  return {
    id: makeId("ghop"),
    cardId,
    operationType: type,
    status: "completed",
    externalId: makeId("demo"),
    metadata,
    createdAt: nowIso(),
  };
}

const demoRepositories: Repository[] = [
  {
    id: "7e07a67e-5f16-4c34-b793-f8e177f2625f",
    owner: "acme",
    name: "web-portal",
    fullName: "acme/web-portal",
    defaultBranch: "main",
    enabled: true,
  },
  {
    id: "f788c732-bddd-4287-84fa-f3237ca3cd88",
    owner: "acme",
    name: "api-gateway",
    fullName: "acme/api-gateway",
    defaultBranch: "main",
    enabled: true,
  },
];

export const demoGitHubProvider: GitHubProvider = {
  async listRepositories() {
    return demoRepositories;
  },

  async createTaskBranch(input) {
    return makeOperation(input.cardId, "branch", {
      repository: input.repository.fullName,
      branch: `agentboard/${input.cardId}`,
    });
  },

  async dispatchWorkflow(input) {
    return makeOperation(input.cardId, "workflow_dispatch", {
      repository: input.repository.fullName,
      branch: input.branch,
      role: input.role,
      runId: Math.floor(Math.random() * 99999),
    });
  },

  async upsertPullRequest(input) {
    return makeOperation("n/a", "pr", {
      repository: input.repository.fullName,
      branch: input.branch,
      title: input.title,
      url: `https://github.com/${input.repository.fullName}/pull/${Math.floor(Math.random() * 100 + 1)}`,
    });
  },

  async mergePullRequest(input) {
    return makeOperation(input.cardId, "merge", {
      repository: input.repository.fullName,
      merged: true,
      sha: makeId("sha"),
    });
  },
};
