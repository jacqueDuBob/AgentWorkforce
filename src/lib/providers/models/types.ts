import type { Classification } from "@/lib/domain/types";

export interface ModelUsage {
  tokenUsage: number;
  estimatedCostUsd: number;
  model: string;
}

export interface ModelAdapter {
  classifyTask(input: { title: string; description: string }): Promise<{ output: Classification; usage: ModelUsage; promptVersion: string }>;
}
