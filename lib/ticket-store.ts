import { ensureSupabaseSession, supabase } from "./supabase";
import { COLUMNS, type AcceptanceCriterion, type Ticket } from "./types";

const STORAGE_KEY = "flowboard-tickets";

const splitCriteria = (value: unknown): AcceptanceCriterion[] => String(value ?? "").split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text) => ({ id: crypto.randomUUID(), text, completed: false }));
const readCriteria = (items: unknown, legacy: unknown): AcceptanceCriterion[] => Array.isArray(items) ? items.flatMap((item) => {
  if (!item || typeof item !== "object") return [];
  const value = item as Record<string, unknown>;
  return typeof value.id === "string" && typeof value.text === "string" && typeof value.completed === "boolean" ? [{ id: value.id, text: value.text, completed: value.completed }] : [];
}) : splitCriteria(legacy);

const fromRow = (row: Record<string, unknown>): Ticket => ({
  id: String(row.id), title: String(row.title), description: String(row.description ?? ""), findings: String(row.findings ?? ""),
  priority: row.priority as Ticket["priority"], tags: (row.tags as string[]) ?? [],
  assignee: String(row.assignee ?? ""), acceptanceCriteria: readCriteria(row.acceptance_criteria_items, row.acceptance_criteria),
  repositoryId: String(row.repository_id ?? ""), baseBranch: String(row.base_branch ?? ""),
  status: row.status as Ticket["status"], position: Number(row.position ?? 0),
  createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  itemType: row.item_type === "Epic" ? "Epic" : "Item", parentEpicId: String(row.parent_epic_id ?? ""), isDraft: Boolean(row.is_draft),
});

const priorities = ["Low", "Medium", "High", "Urgent"];

function isTicket(value: unknown): value is Ticket {
  if (!value || typeof value !== "object") return false;
  const ticket = value as Record<string, unknown>;
  return typeof ticket.id === "string" && typeof ticket.title === "string" &&
    typeof ticket.description === "string" && (ticket.findings === undefined || typeof ticket.findings === "string") && priorities.includes(String(ticket.priority)) &&
    Array.isArray(ticket.tags) && ticket.tags.length <= 3 && ticket.tags.every((tag) => typeof tag === "string") &&
    typeof ticket.assignee === "string" && Array.isArray(ticket.acceptanceCriteria) && ticket.acceptanceCriteria.every((item) => item && typeof item.id === "string" && typeof item.text === "string" && typeof item.completed === "boolean") && typeof ticket.repositoryId === "string" && typeof ticket.baseBranch === "string" &&
    COLUMNS.includes(ticket.status as (typeof COLUMNS)[number]) && Number.isFinite(ticket.position) &&
    typeof ticket.createdAt === "string" && typeof ticket.updatedAt === "string" &&
    (ticket.itemType === undefined || ticket.itemType === "Item" || ticket.itemType === "Epic") &&
    (ticket.parentEpicId === undefined || typeof ticket.parentEpicId === "string") && (ticket.isDraft === undefined || typeof ticket.isDraft === "boolean");
}

function readLocalTickets(): Ticket[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) throw new Error("Stored board is not an array");
    const migrated = parsed.map((value) => value && typeof value === "object" && typeof (value as Record<string, unknown>).acceptanceCriteria === "string" ? { ...(value as Record<string, unknown>), acceptanceCriteria: splitCriteria((value as Record<string, unknown>).acceptanceCriteria) } : value);
    const normalized = migrated.map((value) => isTicket(value) ? { ...value, findings: value.findings ?? "", itemType: value.itemType ?? "Item", parentEpicId: value.parentEpicId ?? "", isDraft: value.isDraft ?? false } : value);
    const valid = normalized.filter(isTicket);
    if (valid.length !== parsed.length || normalized.some((value, index) => JSON.stringify(value) !== JSON.stringify(parsed[index]))) localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
    return valid;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

const toRow = (ticket: Ticket) => ({
  id: ticket.id, title: ticket.title, description: ticket.description, findings: ticket.findings, priority: ticket.priority,
  tags: ticket.tags, assignee: ticket.assignee, acceptance_criteria_items: ticket.acceptanceCriteria,
  repository_id: ticket.repositoryId || null, base_branch: ticket.baseBranch, status: ticket.status, position: ticket.position,
  item_type: ticket.itemType, parent_epic_id: ticket.parentEpicId || null, is_draft: ticket.isDraft,
});

export async function persistTicket(ticket: Ticket) {
  if (supabase) {
    await ensureSupabaseSession();
    const { error } = await supabase.from("tickets").upsert(toRow(ticket));
    if (error) throw error;
  } else {
    const tickets = readLocalTickets();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...tickets.filter((item) => item.id !== ticket.id), ticket]));
  }
}

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
