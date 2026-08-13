import { ensureSupabaseSession, supabase } from "./supabase";
import type { BreakoutSession, EpicRecommendation, Ticket } from "./types";

const RECOMMENDATIONS_KEY = "flowboard-epic-recommendations";
const SESSIONS_KEY = "flowboard-breakout-sessions";
const read = <T>(key: string): T[] => { try { return JSON.parse(localStorage.getItem(key) || "[]") as T[]; } catch { return []; } };
const write = <T>(key: string, values: T[]) => localStorage.setItem(key, JSON.stringify(values));
const recommendationFromRow = (row: Record<string, unknown>): EpicRecommendation => ({
  id: String(row.id), ticketId: String(row.ticket_id), reason: String(row.reason),
  recommendedBy: String(row.recommended_by), status: row.status as EpicRecommendation["status"],
  createdAt: String(row.created_at),
});

export async function recommendEpic(ticketId: string, reason: string, recommendedBy: string): Promise<EpicRecommendation> {
  if (supabase) {
    await ensureSupabaseSession();
    // Reopening a pending recommendation should reopen the confirmation, not
    // collide with the database's one-pending-recommendation constraint.
    const { data: pending, error: lookupError } = await supabase.from("epic_recommendations").select("*").eq("ticket_id", ticketId).eq("status", "pending").maybeSingle();
    if (lookupError) throw lookupError;
    if (pending) return recommendationFromRow(pending);
    const { data, error } = await supabase.from("epic_recommendations").insert({ ticket_id: ticketId, reason, recommended_by: recommendedBy }).select("*").single();
    if (error) throw error;
    return recommendationFromRow(data);
  }
  const recommendation: EpicRecommendation = { id: crypto.randomUUID(), ticketId, reason, recommendedBy, status: "pending", createdAt: new Date().toISOString() };
  write(RECOMMENDATIONS_KEY, [...read<EpicRecommendation>(RECOMMENDATIONS_KEY).filter((item) => item.ticketId !== ticketId || item.status !== "pending"), recommendation]);
  return recommendation;
}

export async function dismissEpicRecommendation(recommendation: EpicRecommendation): Promise<void> {
  if (supabase) {
    await ensureSupabaseSession();
    const { data, error } = await supabase.from("epic_recommendations").update({ status: "dismissed" })
      .eq("id", recommendation.id).eq("ticket_id", recommendation.ticketId).eq("status", "pending")
      .select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The pending Epic recommendation could not be found.");
    return;
  }
  const recommendations = read<EpicRecommendation>(RECOMMENDATIONS_KEY);
  if (!recommendations.some((item) => item.id === recommendation.id && item.ticketId === recommendation.ticketId && item.status === "pending")) {
    throw new Error("The pending Epic recommendation could not be found.");
  }
  write(RECOMMENDATIONS_KEY, recommendations.map((item) => item.id === recommendation.id ? { ...item, status: "dismissed" as const } : item));
}

export async function confirmEpicRecommendation(ticket: Ticket, recommendation: EpicRecommendation, requesterEmail: string, agent: { name: string; modelName: string }, domain: string): Promise<{ epic: Ticket; session: BreakoutSession }> {
  if (supabase) {
    await ensureSupabaseSession();
    const { data, error } = await supabase.rpc("confirm_epic_candidate", { recommendation_id: recommendation.id, requester_email: requesterEmail, breakout_agent_name: agent.name, breakout_model_name: agent.modelName, epic_domain: domain });
    if (error) throw error;
    const result = data as { session_id: string };
    return { epic: { ...ticket, itemType: "Epic", updatedAt: new Date().toISOString() }, session: { id: result.session_id, epicId: ticket.id, requesterEmail, agentName: agent.name, modelName: agent.modelName, domain, status: "active", failedChildren: [], createdAt: new Date().toISOString(), completedAt: "" } };
  }
  const sessions = read<BreakoutSession>(SESSIONS_KEY);
  if (sessions.some((item) => item.epicId === ticket.id && item.status === "active")) throw new Error("This Epic already has an active breakout session.");
  const session: BreakoutSession = { id: crypto.randomUUID(), epicId: ticket.id, requesterEmail, agentName: agent.name, modelName: agent.modelName, domain, status: "active", failedChildren: [], createdAt: new Date().toISOString(), completedAt: "" };
  const recommendations = read<EpicRecommendation>(RECOMMENDATIONS_KEY).map((item) => item.id === recommendation.id ? { ...item, status: "confirmed" as const } : item);
  write(RECOMMENDATIONS_KEY, recommendations); write(SESSIONS_KEY, [...sessions, session]);
  return { epic: { ...ticket, itemType: "Epic", updatedAt: new Date().toISOString() }, session };
}

export async function startEpicBreakout(ticket: Ticket, requesterEmail: string, agent: { name: string; modelName: string }, domain: string): Promise<{ epic: Ticket; session: BreakoutSession }> {
  if (ticket.itemType !== "Epic") {
    const recommendation = await recommendEpic(ticket.id, "The requesting user forced this item into refinement breakout.", "Requesting user");
    return confirmEpicRecommendation(ticket, recommendation, requesterEmail, agent, domain);
  }
  if (supabase) {
    await ensureSupabaseSession();
    const { data, error } = await supabase.from("epic_breakout_sessions").insert({ epic_id: ticket.id, requester_email: requesterEmail, agent_name: agent.name, model_name: agent.modelName, domain }).select("*").single();
    if (error) throw error;
    return { epic: ticket, session: { id: data.id, epicId: ticket.id, requesterEmail, agentName: agent.name, modelName: agent.modelName, domain, status: "active", failedChildren: [], createdAt: data.created_at, completedAt: "" } };
  }
  const sessions = read<BreakoutSession>(SESSIONS_KEY);
  if (sessions.some((item) => item.epicId === ticket.id && item.status === "active")) throw new Error("This Epic already has an active breakout session.");
  const session: BreakoutSession = { id: crypto.randomUUID(), epicId: ticket.id, requesterEmail, agentName: agent.name, modelName: agent.modelName, domain, status: "active", failedChildren: [], createdAt: new Date().toISOString(), completedAt: "" };
  write(SESSIONS_KEY, [...sessions, session]);
  return { epic: ticket, session };
}

export async function completeBreakoutSession(session: BreakoutSession, failedChildren: BreakoutSession["failedChildren"]) {
  if (supabase) {
    await ensureSupabaseSession();
    const { error } = await supabase.from("epic_breakout_sessions").update({ status: "completed", failed_children: failedChildren, completed_at: new Date().toISOString() }).eq("id", session.id).eq("status", "active");
    if (error) throw error;
  } else write(SESSIONS_KEY, read<BreakoutSession>(SESSIONS_KEY).map((item) => item.id === session.id ? { ...item, status: "completed", failedChildren, completedAt: new Date().toISOString() } : item));
}
