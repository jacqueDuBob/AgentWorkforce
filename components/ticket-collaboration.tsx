"use client";

import { useCallback, useEffect, useState } from "react";
import { answerAgentQuestion, addTicketComment, loadTicketCollaboration, reviewTicketProposal } from "@/lib/collaboration-store";
import type { Ticket } from "@/lib/types";
import type { AgentQuestion, TicketComment, TicketProposal } from "@/lib/collaboration-types";
import { X } from "lucide-react";

export function TicketCollaboration({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const [comments, setComments] = useState<TicketComment[]>([]); const [questions, setQuestions] = useState<AgentQuestion[]>([]); const [proposals, setProposals] = useState<TicketProposal[]>([]);
  const [body, setBody] = useState(""); const [answers, setAnswers] = useState<Record<string, string>>({}); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => loadTicketCollaboration(ticket.id).then((value) => { setComments(value.comments); setQuestions(value.questions); setProposals(value.proposals); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load the conversation.")), [ticket.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  const post = async () => { if (!body.trim()) return; setBusy(true); try { await addTicketComment(ticket.id, body); setBody(""); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not post the comment."); } finally { setBusy(false); } };
  const resolve = async (question: AgentQuestion) => { const answer = answers[question.id]?.trim(); if (!answer) return; setBusy(true); try { await answerAgentQuestion(question.id, answer); setAnswers((current) => ({ ...current, [question.id]: "" })); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not resolve the question."); } finally { setBusy(false); } };
  const review = async (proposal: TicketProposal, status: "approved" | "rejected") => { setBusy(true); try { await reviewTicketProposal(proposal.id, status); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not review the proposal."); } finally { setBusy(false); } };
  return <div className="modal-backdrop" onMouseDown={onClose} role="presentation"><section className="modal collaboration-modal" role="dialog" aria-modal="true" aria-labelledby="conversation-title" onMouseDown={(event) => event.stopPropagation()}>
    <div className="modal-header"><div><p className="eyebrow">Ticket conversation</p><h2 id="conversation-title">{ticket.title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></div>
    {error && <div className="error-banner">{error}</div>}
    {questions.filter((item) => item.status === "open").map((question) => <div className="collaboration-question" key={question.id}><strong>Agent question</strong><p>{question.question}</p><div className="inline-form"><input value={answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Answer the agent…"/><button className="button primary" disabled={busy || !answers[question.id]?.trim()} onClick={() => void resolve(question)}>Resolve</button></div></div>)}
    {proposals.filter((item) => item.status === "pending").map((proposal) => <div className="collaboration-proposal" key={proposal.id}><strong>Approval needed: {proposal.title}</strong><p>{proposal.description}</p><div className="form-actions"><button className="button secondary" disabled={busy} onClick={() => void review(proposal, "rejected")}>Reject</button><button className="button primary" disabled={busy} onClick={() => void review(proposal, "approved")}>Approve update</button></div></div>)}
    <div className="comment-list">{comments.length ? comments.map((comment) => <div className="comment" key={comment.id}><p>{comment.body}</p><small>{new Date(comment.createdAt).toLocaleString()}</small></div>) : <p className="empty-state">No comments yet. Start the conversation with the ticket owner or assignee.</p>}</div>
    <div className="comment-compose"><textarea rows={3} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a comment…"/><button className="button primary" disabled={busy || !body.trim()} onClick={() => void post()}>Post comment</button></div>
  </section></div>;
}
