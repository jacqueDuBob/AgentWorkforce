import { createGitHubAppProvider } from "@/lib/providers/github/app-provider";
import type { GitHubProvider } from "@/lib/providers/github/types";

export function getGitHubProvider(env: {
  githubAppId?: string;
  githubAppPrivateKey?: string;
  githubInstallationId?: string;
}): GitHubProvider {
  if (!env.githubAppId || !env.githubAppPrivateKey || !env.githubInstallationId) {
    throw new Error("GitHub App credentials are required.");
  }

  return createGitHubAppProvider({
    appId: env.githubAppId,
    privateKey: env.githubAppPrivateKey,
    installationId: env.githubInstallationId,
  });
}
