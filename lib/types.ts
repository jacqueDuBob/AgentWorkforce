export const COLUMNS = [
  "New", "In Refinement", "Ready", "In Work", "Work Completed", "In Review",
  "Review Completed", "In Testing", "Testing Completed", "Ready for Live", "Live",
] as const;

export type ColumnId = (typeof COLUMNS)[number];
export type Priority = "Low" | "Medium" | "High" | "Urgent";
export type ItemType = "Item" | "Epic";

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
  itemType: ItemType;
  parentEpicId: string;
  isDraft: boolean;
}

export type TicketDraft = Omit<Ticket, "id" | "position" | "createdAt" | "updatedAt" | "itemType" | "parentEpicId" | "isDraft">;

export interface EpicRecommendation {
  id: string;
  ticketId: string;
  reason: string;
  recommendedBy: string;
  status: "pending" | "confirmed" | "dismissed";
  createdAt: string;
}

export interface BreakoutSession {
  id: string;
  epicId: string;
  requesterEmail: string;
  agentName: string;
  modelName: string;
  domain: string;
  status: "active" | "completed" | "inactive";
  failedChildren: Array<{ title: string; error: string }>;
  createdAt: string;
  completedAt: string;
}

export interface ProposedChild {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: Priority;
  tags: string[];
}
