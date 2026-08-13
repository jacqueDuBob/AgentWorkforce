"use client";

import { useState } from "react";
import { Bot, Github, X } from "lucide-react";
import { COLUMNS, type ColumnId, type GitHubRepository } from "@/lib/types";
import type { ColumnAgent, StartMode } from "@/lib/agent-types";

export function ColumnSetup({ open, agents, repositories, onClose, onSave }: {
  open: boolean; agents: ColumnAgent[]; repositories: GitHubRepository[]; onClose: () => void; onSave: (agent: ColumnAgent) => Promise<void>;
}) {
  const [column, setColumn] = useState<ColumnId>("New");
  const [draft, setDraft] = useState<ColumnAgent | undefined>(() => agents[0]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  if (!open || !draft) return null;

  const selectColumn = (next: ColumnId) => {
    setColumn(next);
    setDraft(agents.find((agent) => agent.column === next));
    setMessage("");
  };
  const save = async () => {
    setSaving(true); setMessage("");
    try { await onSave(draft); setMessage("Column agent saved."); }
    finally { setSaving(false); }
  };

  return <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
    <section className="column-setup" role="dialog" aria-modal="true" aria-labelledby="column-setup-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="setup-sidebar">
        <div className="setup-title"><span><Bot size={18}/></span><div><p className="eyebrow">Workflow agents</p><h2 id="column-setup-title">Column Setup</h2></div></div>
        <div className="setup-columns">{COLUMNS.map((item) => <button key={item} className={item === column ? "active" : ""} onClick={() => selectColumn(item)}><i/>{item}</button>)}</div>
      </div>
      <div className="setup-content">
        <div className="setup-content-header"><div><p className="eyebrow">Agent for</p><h3>{column}</h3></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></div>
        <div className="agent-enabled"><div><strong>Agent enabled</strong><span>Allow this worker to receive items in this column.</span></div><button className={`toggle ${draft.enabled ? "on" : ""}`} onClick={() => setDraft({ ...draft, enabled: !draft.enabled })} role="switch" aria-checked={draft.enabled}><i/></button></div>
        <label>Agent name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label>
        <label>Model<input list="agent-models" value={draft.modelName} onChange={(event) => setDraft({ ...draft, modelName: event.target.value })} placeholder="gpt-5.6-luna"/><datalist id="agent-models"><option value="gpt-5.6-luna"/><option value="gpt-5.6-terra"/><option value="gpt-5.6-sol"/></datalist><span className="field-hint">Enter any model identifier that supports structured output.</span></label>
        <label>Instructions<textarea rows={5} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}/></label>
        <span className="field-hint">Available placeholders: {"{{ticket}}"}, {"{{repository}}"}, {"{{workspaceInstructions}}"}, and {"{{runContext}}"}.</span>
        {column === "In Refinement" && <div className="refinement-prompt-fields">
          <label>Refinement questions prompt<textarea rows={7} value={draft.refinementQuestionsPrompt} onChange={(event) => setDraft({ ...draft, refinementQuestionsPrompt: event.target.value })}/></label>
          <label>Ticket rewrite prompt<textarea rows={7} value={draft.refinementRewritePrompt} onChange={(event) => setDraft({ ...draft, refinementRewritePrompt: event.target.value })}/></label>
          <label>Epic breakout prompt<textarea rows={7} value={draft.epicBreakoutPrompt} onChange={(event) => setDraft({ ...draft, epicBreakoutPrompt: event.target.value })}/></label>
          <span className="field-hint">Refinement prompts can also use {"{{refinementAnswers}}"}, {"{{requesterEmail}}"}, {"{{domain}}"}, and {"{{agentName}}"}.</span>
        </div>}
        <fieldset><legend>How work starts</legend><div className="mode-options">{(["manual", "automatic"] as StartMode[]).map((mode) => <label className={draft.startMode === mode ? "selected" : ""} key={mode}><input type="radio" name="start-mode" checked={draft.startMode === mode} onChange={() => setDraft({ ...draft, startMode: mode })}/><span><strong>{mode === "manual" ? "Manual" : "Automatic"}</strong><small>{mode === "manual" ? "Run from the work item when you are ready." : "Run as soon as an item enters this column."}</small></span></label>)}</div></fieldset>
        <div className="integration-heading"><Github size={18}/><div><strong>Repository access</strong><span>Control which connected repositories this agent may use.</span></div></div>
        <fieldset><div className="mode-options">{(["all", "selected"] as const).map((access) => <label className={draft.repositoryAccess === access ? "selected" : ""} key={access}><input type="radio" name="repository-access" checked={draft.repositoryAccess === access} onChange={() => setDraft({ ...draft, repositoryAccess: access })}/><span><strong>{access === "all" ? "All connected" : "Selected only"}</strong><small>{access === "all" ? "Use the repository selected on any ticket." : "Limit this agent to specific repositories."}</small></span></label>)}</div></fieldset>
        {draft.repositoryAccess === "selected" && <div className="repository-checklist">{repositories.length ? repositories.map((repository) => <label key={repository.id}><input type="checkbox" checked={draft.allowedRepositoryIds.includes(repository.id)} onChange={(event) => setDraft({ ...draft, allowedRepositoryIds: event.target.checked ? [...draft.allowedRepositoryIds, repository.id] : draft.allowedRepositoryIds.filter((id) => id !== repository.id) })}/><span>{repository.owner}/{repository.name}</span></label>) : <p>Add repositories from the workspace menu first.</p>}</div>}
        <div className="setup-actions">{message && <span>{message}</span>}<button className="button secondary" onClick={onClose}>Close</button><button className="button primary" disabled={saving || !draft.name.trim() || !draft.modelName.trim() || !draft.instructions.trim() || (column === "In Refinement" && (!draft.refinementQuestionsPrompt.trim() || !draft.refinementRewritePrompt.trim() || !draft.epicBreakoutPrompt.trim()))} onClick={() => void save()}>{saving ? "Saving…" : "Save agent"}</button></div>
      </div>
    </section>
  </div>;
}
