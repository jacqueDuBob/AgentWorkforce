import { importPKCS8, SignJWT } from "jose";
import type { GitHubProvider } from "@/lib/providers/github/types";
import type { GitHubOperation, Repository } from "@/lib/domain/types";
import { makeId, nowIso } from "@/lib/utils/id";

export function createGitHubAppProvider(config: {
  appId: string;
  privateKey: string;
  installationId: string;
  apiBaseUrl?: string;
}): GitHubProvider {
  const apiBaseUrl = config.apiBaseUrl ?? "https://api.github.com";
  let cachedInstallationToken: { token: string; expiresAt: number } | null = null;

  async function createAppJwt(): Promise<string> {
    const normalizedKey = config.privateKey.replace(/\\n/g, "\n");
    const key = await importPKCS8(normalizedKey, "RS256");
    const now = Math.floor(Date.now() / 1000);

    return new SignJWT({})
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuedAt(now - 30)
      .setExpirationTime(now + 9 * 60)
      .setIssuer(config.appId)
      .sign(key);
  }

  async function getInstallationToken(): Promise<string> {
    if (cachedInstallationToken && Date.now() < cachedInstallationToken.expiresAt - 30_000) {
      return cachedInstallationToken.token;
    }

    const jwt = await createAppJwt();
    const response = await fetch(`${apiBaseUrl}/app/installations/${config.installationId}/access_tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(`Failed to request installation token: ${response.status}`);
    }

    const body = (await response.json()) as { token: string; expires_at: string };
    cachedInstallationToken = {
      token: body.token,
      expiresAt: new Date(body.expires_at).getTime(),
    };

    return body.token;
  }

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await getInstallationToken();
    return fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        ...(init.headers ?? {}),
      },
    });
  }

  function asOperation(cardId: string, type: GitHubOperation["operationType"], metadata: Record<string, unknown>): GitHubOperation {
    return {
      id: makeId("ghop"),
      cardId,
      operationType: type,
      status: "completed",
      externalId: null,
      metadata,
      createdAt: nowIso(),
    };
  }

  async function listRepositories(): Promise<Repository[]> {
    const response = await request(`/installation/repositories?per_page=100`);
    if (!response.ok) {
      throw new Error(`Failed to list repositories: ${response.status}`);
    }
    const body = (await response.json()) as {
      repositories: Array<{ id: number; owner: { login: string }; name: string; full_name: string; default_branch: string }>;
    };
    return body.repositories.map((repo) => ({
      id: String(repo.id),
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      installationId: config.installationId,
      enabled: true,
    }));
  }

  return {
    listRepositories,

    async createTaskBranch(input) {
      const branch = `agentboard/${input.cardId}`;
      const refResponse = await request(`/repos/${input.repository.fullName}/git/ref/heads/${input.repository.defaultBranch}`);
      if (!refResponse.ok) {
        throw new Error(`Failed to read default branch ref: ${refResponse.status}`);
      }
      const refBody = (await refResponse.json()) as { object: { sha: string } };

      const createRefResponse = await request(`/repos/${input.repository.fullName}/git/refs`, {
        method: "POST",
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: refBody.object.sha,
        }),
      });

      if (!createRefResponse.ok && createRefResponse.status !== 422) {
        throw new Error(`Failed to create task branch: ${createRefResponse.status}`);
      }

      return asOperation(input.cardId, "branch", {
        repository: input.repository.fullName,
        branch,
      });
    },

    async dispatchWorkflow(input) {
      const response = await request(`/repos/${input.repository.fullName}/actions/workflows/agentboard-runner.yml/dispatches`, {
        method: "POST",
        body: JSON.stringify({
          ref: input.repository.defaultBranch,
          inputs: {
            card_id: input.cardId,
            branch: input.branch,
            role: input.role,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to dispatch workflow: ${response.status}`);
      }

      return asOperation(input.cardId, "workflow_dispatch", {
        repository: input.repository.fullName,
        branch: input.branch,
        role: input.role,
      });
    },

    async upsertPullRequest(input) {
      const response = await request(`/repos/${input.repository.fullName}/pulls`, {
        method: "POST",
        body: JSON.stringify({
          title: input.title,
          head: input.branch,
          base: input.repository.defaultBranch,
          body: input.body,
        }),
      });

      const payload = (await response.json()) as { html_url?: string; message?: string };
      return {
        ...asOperation("n/a", "pr", {
          repository: input.repository.fullName,
          branch: input.branch,
          title: input.title,
          pullRequestUrl: payload.html_url,
          message: payload.message,
        }),
        status: response.ok ? "completed" : "failed",
      };
    },

    async mergePullRequest(input) {
      const pullsResponse = await request(
        `/repos/${input.repository.fullName}/pulls?head=${encodeURIComponent(`${input.repository.owner}:agentboard/${input.cardId}`)}&state=open`,
      );
      if (!pullsResponse.ok) {
        throw new Error(`Failed to list pull requests for merge: ${pullsResponse.status}`);
      }

      const pulls = (await pullsResponse.json()) as Array<{ number: number; html_url: string }>;
      const pull = pulls[0];
      if (!pull) {
        throw new Error("No open pull request found for card branch.");
      }

      const mergeResponse = await request(`/repos/${input.repository.fullName}/pulls/${pull.number}/merge`, {
        method: "PUT",
        body: JSON.stringify({ merge_method: "squash" }),
      });
      const mergePayload = (await mergeResponse.json()) as { merged?: boolean; sha?: string; message?: string };

      return {
        ...asOperation(input.cardId, "merge", {
          repository: input.repository.fullName,
          pullRequestUrl: pull.html_url,
          merged: mergePayload.merged,
          sha: mergePayload.sha,
          message: mergePayload.message,
        }),
        status: mergeResponse.ok ? "completed" : "failed",
      };
    },
  };
}
