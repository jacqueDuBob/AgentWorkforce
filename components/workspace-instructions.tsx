"use client";

import { useState } from "react";
import { BookOpenText, X } from "lucide-react";

export function WorkspaceInstructions({ instructions, onClose, onSave }: { instructions: string; onClose: () => void; onSave: (instructions: string) => Promise<void> }) {
  const [draft, setDraft] = useState(instructions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true); setError("");
    try { await onSave(draft); onClose(); }
    catch { setError("The master instructions could not be saved."); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop" onMouseDown={onClose} role="presentation"><section className="workspace-instructions-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-instructions-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">Workspace context</p><h2 id="workspace-instructions-title"><BookOpenText size={20}/> Master instructions</h2><p>This is one canonical document. Rewrite it as your workspace evolves; saving replaces the previous version.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></div><label>Instructions<textarea autoFocus rows={16} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Define shared product terminology, engineering principles, and decision rules…"/></label><div className="instruction-meta"><span>{draft.length.toLocaleString()} characters</span><span>Inserted wherever an agent template uses {"{{workspaceInstructions}}"}.</span></div>{error && <div className="auth-error">{error}</div>}<div className="form-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Replace instructions"}</button></div></section></div>;
}
