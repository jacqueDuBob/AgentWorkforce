"use client";

import { useEffect, useState } from "react";
import { Bot, Sparkles, X } from "lucide-react";
import type { ColumnAgent } from "@/lib/agent-types";
import type { RefinedTicketContent, RefinementAnswer, RefinementProposal } from "@/lib/refinement-types";
import type { GitHubRepository, Ticket } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { loadAgentRun } from "@/lib/agent-store";

async function authenticatedHeaders() {
  const { data } = await supabase!.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired. Please sign in again.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function waitForResult<T>(runId: string, signal: AbortSignal): Promise<T> {
  while (!signal.aborted) {
    const run = await loadAgentRun(runId);
    if (!run) throw new Error("The refinement run could not be found.");
    if (run.status === "finished") {
      if (run.error) throw new Error(run.error);
      const result = run.output?.result;
      if (!result) throw new Error("The Codex worker did not return a structured refinement result.");
      return result as T;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  throw new DOMException("Aborted", "AbortError");
}

export function RefinementDialog({ ticket, agent, repositories, onClose, onSubmit }: {
  ticket: Ticket;
  agent: ColumnAgent;
  repositories: GitHubRepository[];
  onClose: () => void;
  onSubmit: (repositoryId: string, proposal: RefinementProposal, answers: RefinementAnswer[], rewrite: RefinedTicketContent) => Promise<void>;
}) {
  const [proposal, setProposal] = useState<RefinementProposal>();
  const [repositoryId, setRepositoryId] = useState(() => repositories.some((repository) => repository.id === ticket.repositoryId) ? ticket.repositoryId : "");
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!started) return;
    const controller = new AbortController();
    authenticatedHeaders().then((headers) => fetch("/api/refinement", {
      method: "POST", signal: controller.signal, headers,
      body: JSON.stringify({ ticketId: ticket.id, repositoryId }),
    })).then(async (response) => {
      const queued = await response.json() as { runId?: string; error?: string };
      if (!response.ok || !queued.runId) throw new Error(queued.error || "Could not queue the refinement agent.");
      setProposal(await waitForResult<RefinementProposal>(queued.runId, controller.signal));
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not start the refinement agent.");
    });
    return () => controller.abort();
  }, [started, ticket, repositoryId]);

  const complete = proposal?.questions.every((question) => answers[question.id]?.trim());
  const currentQuestion = proposal?.questions[questionIndex];
  const loading = started && !proposal && !error;
  const answerSuggestion = (questionId: string, answer: string) => {
    setAnswers((current) => ({ ...current, [questionId]: answer }));
    if (proposal && questionIndex < proposal.questions.length - 1) setQuestionIndex(questionIndex + 1);
  };
  const submit = async () => {
    if (!proposal || !complete) return;
    setSubmitting(true); setError("");
    try {
      const completedAnswers = proposal.questions.map((question) => ({ questionId: question.id, question: question.question, answer: answers[question.id].trim() }));
      const response = await fetch("/api/refinement", { method: "POST", headers: await authenticatedHeaders(), body: JSON.stringify({ action: "rewrite", ticketId: ticket.id, repositoryId, proposal, answers: completedAnswers }) });
      const queued = await response.json() as { runId?: string; error?: string };
      if (!response.ok || !queued.runId) throw new Error(queued.error || "The refinement rewrite could not be queued.");
      const rewrite = await waitForResult<RefinedTicketContent>(queued.runId, new AbortController().signal);
      await onSubmit(repositoryId, proposal, completedAnswers, rewrite);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The refinement could not be submitted."); }
    finally { setSubmitting(false); }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="refinement-dialog" role="dialog" aria-modal="true" aria-labelledby="refinement-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="refinement-header"><span><Bot size={20}/></span><div><p className="eyebrow">{agent.name}</p><h2 id="refinement-title">Refine “{ticket.title}”</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></header>
      {!started && <div className="refinement-body refinement-repository-step"><p className="eyebrow">Repository context</p><h3>Select the repository to inspect</h3><p>The refinement agent will use this repository as the technical context for its questions and solution design.</p><label>Repository<select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}><option value="">Select a repository…</option>{repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.owner}/{repository.name}</option>)}</select></label>{repositories.length === 0 && <div className="error-banner">No repository is available to this agent. Add one or update its repository access first.</div>}</div>}
      {loading && <div className="refinement-loading"><Sparkles size={20}/><strong>Codex is inspecting the repository…</strong><span>The interactive run may wait briefly if the local worker is busy.</span></div>}
      {error && <div className="error-banner refinement-error">{error}</div>}
      {proposal && <div className="refinement-body">
        <section className="repository-classification"><div><p className="eyebrow">Repository context</p><strong>{proposal.repositoryReason}</strong></div><strong>{repositories.find((repository) => repository.id === repositoryId)?.owner}/{repositories.find((repository) => repository.id === repositoryId)?.name}</strong></section>
        {currentQuestion && <div className="refinement-question-page"><p className="question-count">Question {questionIndex + 1} of {proposal.questions.length}</p><fieldset><legend>{currentQuestion.question}</legend><div className="suggestion-grid">{currentQuestion.suggestions.map((suggestion) => <button type="button" key={suggestion} className={answers[currentQuestion.id] === suggestion ? "selected" : ""} onClick={() => answerSuggestion(currentQuestion.id, suggestion)}>{suggestion}</button>)}</div><label className="custom-answer">Or write your own answer<textarea rows={3} value={currentQuestion.suggestions.includes(answers[currentQuestion.id] as never) ? "" : answers[currentQuestion.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [currentQuestion.id]: event.target.value }))} placeholder="Custom answer…"/></label></fieldset></div>}
      </div>}
      <footer className="refinement-actions">{!started ? <><span/><div className="question-navigation"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={!repositoryId || repositories.length === 0} onClick={() => setStarted(true)}>Continue to refinement</button></div></> : <><div className="question-progress" aria-label={`${Object.values(answers).filter((answer) => answer.trim()).length} of ${proposal?.questions.length ?? 0} questions completed`}>{proposal?.questions.map((question, index) => <button type="button" key={question.id} className={`${answers[question.id]?.trim() ? "answered" : ""} ${index === questionIndex ? "active" : ""}`} onClick={() => setQuestionIndex(index)} aria-label={`Go to question ${index + 1}`}/>)}</div><div className="question-navigation"><button className="button secondary" onClick={questionIndex === 0 ? onClose : () => setQuestionIndex(questionIndex - 1)}>{questionIndex === 0 ? "Cancel" : "Back"}</button>{proposal && questionIndex < proposal.questions.length - 1 ? <button className="button primary" disabled={!currentQuestion || !answers[currentQuestion.id]?.trim()} onClick={() => setQuestionIndex(questionIndex + 1)}>Next question</button> : <button className="button primary" disabled={!complete || submitting} onClick={() => void submit()}>{submitting ? "Rewriting ticket…" : "Submit & refine ticket"}</button>}</div></>}</footer>
    </section>
  </div>;
}
