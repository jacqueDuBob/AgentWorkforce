export const COLUMNS = [
  "New", "In Refinement", "Ready", "In Work", "Work Completed", "In Review",
  "Review Completed", "In Testing", "Testing Completed", "Ready for Live", "Live",
] as const;

export type ColumnId = (typeof COLUMNS)[number];
export type Priority = "Low" | "Medium" | "High" | "Urgent";

export interface GitHubRepository { id: string; owner: string; name: string; defaultBranch: string; }

export interface AcceptanceCriterion { id: string; text: string; completed: boolean; }

export interface Ticket {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  tags: string[];
  assignee: string;
  acceptanceCriteria: AcceptanceCriterion[];
  repositoryId: string;
  baseBranch: string;
  status: ColumnId;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export type TicketDraft = Omit<Ticket, "id" | "position" | "createdAt" | "updatedAt">;
