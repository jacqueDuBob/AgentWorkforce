export interface TicketComment { id: string; ticketId: string; authorId: string; body: string; createdAt: string; }
export interface AgentQuestion { id: string; ticketId: string; runId: string; question: string; answer?: string; status: "open" | "resolved"; createdAt: string; resolvedAt?: string; }
export interface TicketProposal { id: string; ticketId: string; runId?: string; title: string; description: string; changes: Record<string, unknown>; status: "pending" | "approved" | "rejected"; createdAt: string; }
export interface Notification { id: string; ticketId?: string; kind: "comment" | "question" | "proposal" | "execution"; title: string; body: string; readAt?: string; createdAt: string; }
