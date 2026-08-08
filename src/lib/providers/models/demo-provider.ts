import type { ModelAdapter } from "@/lib/providers/models/types";

export const demoModelProvider: ModelAdapter = {
  async classifyTask() {
    return {
      output: {
        workflow: "software-development",
        taskType: "bug_fix",
        domains: ["frontend", "authentication"],
        complexity: "medium",
        risk: "high",
        specializations: ["typescript", "nextjs", "security"],
        suggestedTests: ["unit", "integration"],
        requiresSecurityReview: true,
        confidence: 0.92,
      },
      usage: {
        tokenUsage: 420,
        estimatedCostUsd: 0.0005,
        model: "demo-classifier-v1",
      },
      promptVersion: "classifier@1.0.0",
    };
  },
};
