import type { ColumnId } from "./types";

export type StartMode = "manual" | "automatic";

export interface ColumnAgent {
  id?: string;
  column: ColumnId;
  name: string;
  instructions: string;
  startMode: StartMode;
  enabled: boolean;
  repositoryAccess: "all" | "selected";
  allowedRepositoryIds: string[];
}

export const DEFAULT_AGENT_INSTRUCTIONS: Record<ColumnId, string> = {
  "New": "Review the request, identify its intent, and flag missing information.",
  "In Refinement": "Classify the best repository from the ticket content and ask focused questions that resolve missing requirements before implementation.",
  "Ready": "Confirm the work is actionable and produce a concise implementation plan.",
  "In Work": "Implement the approved change in the configured GitHub repository on a new branch.",
  "Work Completed": "Review the implementation for completeness and prepare a pull request summary.",
  "In Review": "Review the proposed code changes and report concrete findings.",
  "Review Completed": "Apply or verify approved review changes and summarize the result.",
  "In Testing": "Design and run appropriate tests for the change.",
  "Testing Completed": "Summarize test evidence and identify any remaining release risks.",
  "Ready for Live": "Prepare release notes and verify the change is ready to merge or deploy.",
  "Live": "Confirm the release outcome and create a concise completion summary.",
};
