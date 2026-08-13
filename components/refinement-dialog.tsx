"use client";

import { useEffect, useState } from "react";
import { Bot, Sparkles, X } from "lucide-react";
import type { ColumnAgent } from "@/lib/agent-types";
import type { RefinedTicketContent, RefinementAnswer, RefinementProposal } from "@/lib/refinement-types";
import type { GitHubRepository, Ticket } from "@/lib/types";
import { supabase } from "@/lib/supabase";

async function authenticatedHeaders() {
  const { data } = await supabase!.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired. Please sign in again.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export function RefinementDialog({ ticket, agent, repositories, masterInstructions, onClose, onSubmit }: {
  ticket: Ticket;
  agent: ColumnAgent;
  repositories: GitHubRepository[];
  masterInstructions: string;
  onClose: () => void;
  onSubmit: (repositoryId: string, proposal: RefinementProposal, answers: RefinementAnswer[], rewrite: RefinedTicketContent) => Promise<void>;
}) {
  const [proposal, setProposal] = useState<RefinementProposal>();
  const [repositoryId, setRepositoryId] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    authenticatedHeaders().then((headers) => fetch("/api/refinement", {
      method: "POST", signal: controller.signal, headers,
      body: JSON.stringify({ ticketId: ticket.id }),
    })).then(async (response) => {
      const data = await response.json() as RefinementProposal & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not start the refinement agent.");
      setProposal(data); setRepositoryId(data.repositoryId || ticket.repositoryId);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not start the refinement agent.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ticket, agent, repositories, masterInstructions]);

  const complete = proposal?.questions.every((question) => answers[question.id]?.trim());
  const currentQuestion = proposal?.questions[questionIndex];
  const answerSuggestion = (questionId: string, answer: string) => {
    setAnswers((current) => ({ ...current, [questionId]: answer }));
    if (proposal && questionIndex < proposal.questions.length - 1) setQuestionIndex(questionIndex + 1);
  };
  const submit = async () => {
    if (!proposal || !complete) return;
    setSubmitting(true); setError("");
    try {
      const completedAnswers = proposal.questions.map((question) => ({ questionId: question.id, question: question.question, answer: answers[question.id].trim() }));
      const response = await fetch("/api/refinement", { method: "POST", headers: await authenticatedHeaders(), body: JSON.stringify({ action: "rewrite", ticketId: ticket.id, answers: completedAnswers }) });
      const rewrite = await response.json() as RefinedTicketContent & { error?: string };
      if (!response.ok) throw new Error(rewrite.error || "The refinement agent could not rewrite the ticket.");
      await onSubmit(repositoryId, proposal, completedAnswers, rewrite);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The refinement could not be submitted."); }
    finally { setSubmitting(false); }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="refinement-dialog" role="dialog" aria-modal="true" aria-labelledby="refinement-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="refinement-header"><span><Bot size={20}/></span><div><p className="eyebrow">{agent.name}</p><h2 id="refinement-title">Refine “{ticket.title}”</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></header>
      {loading && <div className="refinement-loading"><Sparkles size={20}/><strong>Analysing the ticket…</strong><span>Classifying the repository and finding the most useful questions.</span></div>}
      {error && <div className="error-banner refinement-error">{error}</div>}
      {proposal && <div className="refinement-body">
        <section className="repository-classification"><div><p className="eyebrow">Repository classification</p><strong>{proposal.repositoryReason}</strong></div><label>Repository<select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}><option value="">No matching repository</option>{repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.owner}/{repository.name}</option>)}</select></label></section>
        {currentQuestion && <div className="refinement-question-page"><p className="question-count">Question {questionIndex + 1} of {proposal.questions.length}</p><fieldset><legend>{currentQuestion.question}</legend><div className="suggestion-grid">{currentQuestion.suggestions.map((suggestion) => <button type="button" key={suggestion} className={answers[currentQuestion.id] === suggestion ? "selected" : ""} onClick={() => answerSuggestion(currentQuestion.id, suggestion)}>{suggestion}</button>)}</div><label className="custom-answer">Or write your own answer<textarea rows={3} value={currentQuestion.suggestions.includes(answers[currentQuestion.id] as never) ? "" : answers[currentQuestion.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [currentQuestion.id]: event.target.value }))} placeholder="Custom answer…"/></label></fieldset></div>}
      </div>}
      <footer className="refinement-actions"><div className="question-progress" aria-label={`${Object.values(answers).filter((answer) => answer.trim()).length} of ${proposal?.questions.length ?? 0} questions completed`}>{proposal?.questions.map((question, index) => <button type="button" key={question.id} className={`${answers[question.id]?.trim() ? "answered" : ""} ${index === questionIndex ? "active" : ""}`} onClick={() => setQuestionIndex(index)} aria-label={`Go to question ${index + 1}`}/>)}</div><div className="question-navigation"><button className="button secondary" onClick={questionIndex === 0 ? onClose : () => setQuestionIndex(questionIndex - 1)}>{questionIndex === 0 ? "Cancel" : "Back"}</button>{proposal && questionIndex < proposal.questions.length - 1 ? <button className="button primary" disabled={!currentQuestion || !answers[currentQuestion.id]?.trim()} onClick={() => setQuestionIndex(questionIndex + 1)}>Next question</button> : <button className="button primary" disabled={!complete || submitting} onClick={() => void submit()}>{submitting ? "Rewriting ticket…" : "Submit & refine ticket"}</button>}</div></footer>
    </section>
  </div>;
}
