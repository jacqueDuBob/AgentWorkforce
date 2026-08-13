import type { ColumnId } from "./types";

export type StartMode = "manual" | "automatic";

export interface ColumnAgent {
  id?: string;
  column: ColumnId;
  name: string;
  modelName: string;
  instructions: string;
  refinementQuestionsPrompt: string;
  refinementRewritePrompt: string;
  epicBreakoutPrompt: string;
  startMode: StartMode;
  enabled: boolean;
  repositoryAccess: "all" | "selected";
  allowedRepositoryIds: string[];
}

export type AgentRunStatus = "queued" | "in_progress" | "finished";

export interface AgentRun {
  id: string;
  ticketId: string;
  column: ColumnId;
  agentName: string;
  modelName: string;
  renderedPrompt: string;
  trigger: StartMode;
  status: AgentRunStatus;
  output?: Record<string, unknown>;
  error: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}
