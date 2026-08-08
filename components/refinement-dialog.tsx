"use client";

import { useEffect, useState } from "react";
import { Bot, Sparkles, X } from "lucide-react";
import type { ColumnAgent } from "@/lib/agent-types";
import type { RefinementAnswer, RefinementProposal } from "@/lib/refinement-types";
import type { GitHubRepository, Ticket } from "@/lib/types";

export function RefinementDialog({ ticket, agent, repositories, onClose, onSubmit }: {
  ticket?: Ticket;
  agent?: ColumnAgent;
  repositories: GitHubRepository[];
  onClose: () => void;
  onSubmit: (repositoryId: string, proposal: RefinementProposal, answers: RefinementAnswer[]) => Promise<void>;
}) {
  const [proposal, setProposal] = useState<RefinementProposal>();
  const [repositoryId, setRepositoryId] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ticket || !agent) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setProposal(undefined); setAnswers({});
    fetch("/api/refinement", {
      method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, repositories, instructions: agent.instructions }),
    }).then(async (response) => {
      const data = await response.json() as RefinementProposal & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not start the refinement agent.");
      setProposal(data); setRepositoryId(data.repositoryId || ticket.repositoryId);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not start the refinement agent.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ticket, agent, repositories]);

  if (!ticket || !agent) return null;
  const complete = proposal?.questions.every((question) => answers[question.id]?.trim());
  const submit = async () => {
    if (!proposal || !complete) return;
    setSubmitting(true); setError("");
    try {
      await onSubmit(repositoryId, proposal, proposal.questions.map((question) => ({ questionId: question.id, question: question.question, answer: answers[question.id].trim() })));
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
        <div className="refinement-questions">{proposal.questions.map((question, index) => <fieldset key={question.id}><legend><span>{index + 1}</span>{question.question}</legend><div className="suggestion-grid">{question.suggestions.map((suggestion) => <button type="button" key={suggestion} className={answers[question.id] === suggestion ? "selected" : ""} onClick={() => setAnswers((current) => ({ ...current, [question.id]: suggestion }))}>{suggestion}</button>)}</div><label className="custom-answer">Or write your own answer<input value={question.suggestions.includes(answers[question.id] as never) ? "" : answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Custom answer…"/></label></fieldset>)}</div>
      </div>}
      <footer className="refinement-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={!complete || submitting} onClick={() => void submit()}>{submitting ? "Starting…" : "Submit & run agent"}</button></footer>
    </section>
  </div>;
}
