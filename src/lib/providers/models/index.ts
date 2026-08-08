import { createOpenAIModelProvider } from "@/lib/providers/models/openai-provider";
import type { ModelAdapter } from "@/lib/providers/models/types";

export function getModelProvider(env: {
  openAiApiKey: string | undefined;
  classifierModel: string;
  timeoutMs: number;
}): ModelAdapter {
  if (!env.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  return createOpenAIModelProvider({
    apiKey: env.openAiApiKey,
    classifierModel: env.classifierModel,
    timeoutMs: env.timeoutMs,
  });
}
