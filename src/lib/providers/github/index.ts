import { createGitHubAppProvider } from "@/lib/providers/github/app-provider";
import { demoGitHubProvider } from "@/lib/providers/github/demo-provider";
import type { GitHubProvider } from "@/lib/providers/github/types";

export function getGitHubProvider(env: {
  demoMode: boolean;
  githubAppId?: string;
  githubAppPrivateKey?: string;
  githubInstallationId?: string;
}): GitHubProvider {
  if (
    env.demoMode ||
    !env.githubAppId ||
    !env.githubAppPrivateKey ||
    !env.githubInstallationId
  ) {
    return demoGitHubProvider;
  }

  return createGitHubAppProvider({
    appId: env.githubAppId,
    privateKey: env.githubAppPrivateKey,
    installationId: env.githubInstallationId,
  });
}
