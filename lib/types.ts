export const COLUMNS = [
  "New", "In Refinement", "Ready", "In Work", "Work Completed", "In Review",
  "Review Completed", "In Testing", "Testing Completed", "Ready for Live", "Live",
] as const;

export type ColumnId = (typeof COLUMNS)[number];
export type Priority = "Low" | "Medium" | "High" | "Urgent";

export interface Ticket {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  tags: string[];
  assignee: string;
  acceptanceCriteria: string;
  status: ColumnId;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export type TicketDraft = Omit<Ticket, "id" | "position" | "createdAt" | "updatedAt">;
