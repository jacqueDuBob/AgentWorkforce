import { createOpenAIModelProvider } from "@/lib/providers/models/openai-provider";
import { demoModelProvider } from "@/lib/providers/models/demo-provider";
import type { ModelAdapter } from "@/lib/providers/models/types";

export function getModelProvider(env: {
  demoMode: boolean;
  openAiApiKey: string | undefined;
  classifierModel: string;
  timeoutMs: number;
}): ModelAdapter {
  if (env.demoMode || !env.openAiApiKey) {
    return demoModelProvider;
  }

  return createOpenAIModelProvider({
    apiKey: env.openAiApiKey,
    classifierModel: env.classifierModel,
    timeoutMs: env.timeoutMs,
  });
}
