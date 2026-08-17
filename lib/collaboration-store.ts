import { ensureSupabaseSession, supabase } from "./supabase";
import type { AgentQuestion, HumanInputRequest, Notification, TicketComment, TicketProposal } from "./collaboration-types";

const required = () => { if (!supabase) throw new Error("Supabase is required for ticket collaboration."); return supabase; };
const comment = (row: Record<string, unknown>): TicketComment => ({ id: String(row.id), ticketId: String(row.ticket_id), authorId: String(row.author_id), body: String(row.body), createdAt: String(row.created_at) });
const question = (row: Record<string, unknown>): AgentQuestion => ({ id: String(row.id), ticketId: String(row.ticket_id), runId: String(row.run_id), question: String(row.question), answer: row.answer ? String(row.answer) : undefined, status: row.status as AgentQuestion["status"], createdAt: String(row.created_at), resolvedAt: row.resolved_at ? String(row.resolved_at) : undefined });
const proposal = (row: Record<string, unknown>): TicketProposal => ({ id: String(row.id), ticketId: String(row.ticket_id), runId: row.run_id ? String(row.run_id) : undefined, title: String(row.title), description: String(row.description ?? ""), changes: (row.changes as Record<string, unknown>) ?? {}, status: row.status as TicketProposal["status"], createdAt: String(row.created_at) });
const notification = (row: Record<string, unknown>): Notification => ({ id: String(row.id), ticketId: row.ticket_id ? String(row.ticket_id) : undefined, kind: row.kind as Notification["kind"], title: String(row.title), body: String(row.body ?? ""), readAt: row.read_at ? String(row.read_at) : undefined, createdAt: String(row.created_at) });

export async function loadTicketCollaboration(ticketId: string) {
  const client = required(); await ensureSupabaseSession();
  const [{ data: comments, error: commentsError }, { data: questions, error: questionsError }, { data: proposals, error: proposalsError }, { data: requests, error: requestsError }] = await Promise.all([
    client.from("ticket_comments").select("*").eq("ticket_id", ticketId).order("created_at"),
    client.from("agent_questions").select("*").eq("ticket_id", ticketId).order("created_at"),
    client.from("ticket_proposals").select("*").eq("ticket_id", ticketId).order("created_at", { ascending: false }),
    client.from("human_input_requests").select("*,agent_runs!inner(ticket_id)").eq("agent_runs.ticket_id", ticketId).order("created_at"),
  ]);
  const migrationMissing = requestsError && ["42P01", "PGRST205"].includes(requestsError.code ?? "");
  if (commentsError || questionsError || proposalsError || requestsError && !migrationMissing) throw commentsError ?? questionsError ?? proposalsError ?? requestsError;
  const inputRequests: HumanInputRequest[] = (requests ?? []).map((row) => ({
    id: String(row.id), jobId: String(row.job_id), attemptId: String(row.attempt_id), round: Number(row.round_number),
    status: row.status as HumanInputRequest["status"], questions: Array.isArray(row.questions) ? row.questions as HumanInputRequest["questions"] : [], createdAt: String(row.created_at),
  }));
  return { comments: (comments ?? []).map(comment), questions: (questions ?? []).map(question), proposals: (proposals ?? []).map(proposal), inputRequests };
}
export async function addTicketComment(ticketId: string, body: string) { const client = required(); await ensureSupabaseSession(); const { error } = await client.from("ticket_comments").insert({ ticket_id: ticketId, body: body.trim() }); if (error) throw error; }
export async function answerAgentQuestion(id: string, answer: string) { const client = required(); await ensureSupabaseSession(); const { error } = await client.rpc("resolve_agent_question", { question_id: id, response: answer.trim() }); if (error) throw error; }
export async function submitHumanInput(requestId: string, submissionKey: string, answers: Array<{ questionId: string; answer: string | string[] }>) { const client = required(); await ensureSupabaseSession(); const { error } = await client.rpc("submit_human_input", { requested_request_id: requestId, requested_submission_key: submissionKey, requested_answers: answers }); if (error) throw error; }
export async function reviewTicketProposal(id: string, status: "approved" | "rejected") { const client = required(); await ensureSupabaseSession(); const { error } = await client.rpc("approve_ticket_proposal", { proposal_id: id, decision: status }); if (error) throw error; }
export async function loadNotifications() { const client = required(); await ensureSupabaseSession(); const { data, error } = await client.from("notifications").select("*").order("created_at", { ascending: false }).limit(50); if (error) throw error; return (data ?? []).map(notification); }
export async function markNotificationRead(id: string) { const client = required(); await ensureSupabaseSession(); const { error } = await client.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id); if (error) throw error; }
