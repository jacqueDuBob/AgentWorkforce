import { ensureSupabaseSession, supabase } from "./supabase";
import { COLUMNS, type Ticket } from "./types";

const STORAGE_KEY = "flowboard-tickets";

const fromRow = (row: Record<string, unknown>): Ticket => ({
  id: String(row.id), title: String(row.title), description: String(row.description ?? ""),
  priority: row.priority as Ticket["priority"], tags: (row.tags as string[]) ?? [],
  assignee: String(row.assignee ?? ""), acceptanceCriteria: String(row.acceptance_criteria ?? ""),
  status: row.status as Ticket["status"], position: Number(row.position ?? 0),
  createdAt: String(row.created_at), updatedAt: String(row.updated_at),
});

const priorities = ["Low", "Medium", "High", "Urgent"];

function isTicket(value: unknown): value is Ticket {
  if (!value || typeof value !== "object") return false;
  const ticket = value as Record<string, unknown>;
  return typeof ticket.id === "string" && typeof ticket.title === "string" &&
    typeof ticket.description === "string" && priorities.includes(String(ticket.priority)) &&
    Array.isArray(ticket.tags) && ticket.tags.length <= 3 && ticket.tags.every((tag) => typeof tag === "string") &&
    typeof ticket.assignee === "string" && typeof ticket.acceptanceCriteria === "string" &&
    COLUMNS.includes(ticket.status as (typeof COLUMNS)[number]) && Number.isFinite(ticket.position) &&
    typeof ticket.createdAt === "string" && typeof ticket.updatedAt === "string";
}

function readLocalTickets(): Ticket[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) throw new Error("Stored board is not an array");
    const valid = parsed.filter(isTicket);
    if (valid.length !== parsed.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
    return valid;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

const toRow = (ticket: Ticket) => ({
  id: ticket.id, title: ticket.title, description: ticket.description, priority: ticket.priority,
  tags: ticket.tags, assignee: ticket.assignee, acceptance_criteria: ticket.acceptanceCriteria,
  status: ticket.status, position: ticket.position,
});

export async function loadTickets(): Promise<Ticket[]> {
  if (supabase) {
    await ensureSupabaseSession();
    const { data, error } = await supabase.from("tickets").select("*").order("position");
    if (error) throw error;
    return (data ?? []).map(fromRow);
  }
  return readLocalTickets();
}

export async function persistTickets(tickets: Ticket[]) {
  if (supabase) {
    await ensureSupabaseSession();
    const { error } = await supabase.from("tickets").upsert(tickets.map(toRow));
    if (error) throw error;
  } else localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets));
}

export async function removeTicket(id: string) {
  if (supabase) {
    await ensureSupabaseSession();
    const { error } = await supabase.from("tickets").delete().eq("id", id);
    if (error) throw error;
  } else localStorage.setItem(STORAGE_KEY, JSON.stringify(readLocalTickets().filter((ticket) => ticket.id !== id)));
}
