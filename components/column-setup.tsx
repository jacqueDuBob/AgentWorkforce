"use client";

import { useState } from "react";
import { Bot, Github, X } from "lucide-react";
import { COLUMNS, type ColumnId } from "@/lib/types";
import type { ColumnAgent, StartMode } from "@/lib/agent-types";

export function ColumnSetup({ open, agents, onClose, onSave }: {
  open: boolean; agents: ColumnAgent[]; onClose: () => void; onSave: (agent: ColumnAgent) => Promise<void>;
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
        <label>Instructions<textarea rows={5} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}/></label>
        <fieldset><legend>How work starts</legend><div className="mode-options">{(["manual", "automatic"] as StartMode[]).map((mode) => <label className={draft.startMode === mode ? "selected" : ""} key={mode}><input type="radio" name="start-mode" checked={draft.startMode === mode} onChange={() => setDraft({ ...draft, startMode: mode })}/><span><strong>{mode === "manual" ? "Manual" : "Automatic"}</strong><small>{mode === "manual" ? "Run from the work item when you are ready." : "Run as soon as an item enters this column."}</small></span></label>)}</div></fieldset>
        <div className="integration-heading"><Github size={18}/><div><strong>GitHub workspace</strong><span>The agent will prepare changes in this repository.</span></div></div>
        <div className="form-grid"><label>Owner or organization<input value={draft.githubOwner} onChange={(event) => setDraft({ ...draft, githubOwner: event.target.value })} placeholder="acme"/></label><label>Repository<input value={draft.githubRepo} onChange={(event) => setDraft({ ...draft, githubRepo: event.target.value })} placeholder="product-app"/></label></div>
        <label>Base branch<input value={draft.baseBranch} onChange={(event) => setDraft({ ...draft, baseBranch: event.target.value })} placeholder="main"/></label>
        <div className="setup-actions">{message && <span>{message}</span>}<button className="button secondary" onClick={onClose}>Close</button><button className="button primary" disabled={saving || !draft.name.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save agent"}</button></div>
      </div>
    </section>
  </div>;
}
