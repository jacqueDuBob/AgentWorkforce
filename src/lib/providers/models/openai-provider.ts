import OpenAI from "openai";
import type { ModelAdapter } from "@/lib/providers/models/types";
import { classificationSchema } from "@/lib/domain/validation";

export function createOpenAIModelProvider(params: {
  apiKey: string;
  classifierModel: string;
  timeoutMs: number;
}): ModelAdapter {
  const client = new OpenAI({ apiKey: params.apiKey, timeout: params.timeoutMs });

  return {
    async classifyTask(input) {
      const response = await client.responses.create({
        model: params.classifierModel,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "Classify software development tasks using strict JSON schema output.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Title: ${input.title}\nDescription: ${input.description}`,
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "classification",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                workflow: { type: "string", enum: ["software-development"] },
                taskType: { type: "string", enum: ["bug_fix", "feature", "refactor", "chore"] },
                domains: { type: "array", items: { type: "string" }, minItems: 1 },
                complexity: { type: "string", enum: ["low", "medium", "high"] },
                risk: { type: "string", enum: ["low", "medium", "high"] },
                specializations: { type: "array", items: { type: "string" } },
                suggestedTests: { type: "array", items: { type: "string" } },
                requiresSecurityReview: { type: "boolean" },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: [
                "workflow",
                "taskType",
                "domains",
                "complexity",
                "risk",
                "specializations",
                "suggestedTests",
                "requiresSecurityReview",
                "confidence",
              ],
            },
          },
        },
      });

      const outputText = response.output_text;
      const parsed = classificationSchema.parse(JSON.parse(outputText));

      const totalTokens = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
      const estimatedCostUsd = Number((totalTokens * 0.0000006).toFixed(6));

      return {
        output: parsed,
        usage: {
          tokenUsage: totalTokens,
          estimatedCostUsd,
          model: params.classifierModel,
        },
        promptVersion: "classifier@1.0.0",
      };
    },
  };
}
