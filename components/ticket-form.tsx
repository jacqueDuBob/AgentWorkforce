"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { COLUMNS, type ColumnId, type Priority, type Ticket, type TicketDraft } from "@/lib/types";

const priorities: Priority[] = ["Low", "Medium", "High", "Urgent"];
const emptyDraft = (status: ColumnId): TicketDraft => ({ title: "", description: "", priority: "Medium", tags: [], assignee: "", acceptanceCriteria: "", status });

export function TicketForm({ open, ticket, initialStatus, onClose, onSave }: { open: boolean; ticket?: Ticket; initialStatus: ColumnId; onClose: () => void; onSave: (draft: TicketDraft) => void }) {
  if (!open) return null;
  return <TicketFormContent key={ticket?.id ?? `new-${initialStatus}`} ticket={ticket} initialStatus={initialStatus} onClose={onClose} onSave={onSave}/>;
}

function TicketFormContent({ ticket, initialStatus, onClose, onSave }: { ticket?: Ticket; initialStatus: ColumnId; onClose: () => void; onSave: (draft: TicketDraft) => void }) {
  const [draft, setDraft] = useState<TicketDraft>(() => ticket ? { title: ticket.title, description: ticket.description, priority: ticket.priority, tags: ticket.tags, assignee: ticket.assignee, acceptanceCriteria: ticket.acceptanceCriteria, status: ticket.status } : emptyDraft(initialStatus));
  const [tag, setTag] = useState("");
  const addTag = () => {
    const value = tag.trim();
    if (value && draft.tags.length < 3 && !draft.tags.includes(value)) {
      setDraft({ ...draft, tags: [...draft.tags, value] });
      setTag("");
    }
  };

  return <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="ticket-form-title" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-header"><div><p className="eyebrow">{ticket ? "Edit work item" : "New work item"}</p><h2 id="ticket-form-title">{ticket ? "Update the details" : "What needs to be done?"}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></div>
      <form onSubmit={(e) => { e.preventDefault(); onSave(draft); }}>
        <label>Title<input autoFocus required maxLength={120} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="A clear, concise title" /></label>
        <label>Description<textarea rows={4} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Add context and useful details…" /></label>
        <div className="form-grid">
          <label>Priority<select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}>{priorities.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label>Status<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ColumnId })}>{COLUMNS.map((column) => <option key={column}>{column}</option>)}</select></label>
        </div>
        <label>Assignee<input value={draft.assignee} onChange={(e) => setDraft({ ...draft, assignee: e.target.value })} placeholder="Name or role" /></label>
        <label>Tags <span className="label-hint">up to 3</span><div className="tag-input"><input value={tag} disabled={draft.tags.length >= 3} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} placeholder="Type and press Enter"/><button type="button" onClick={addTag} disabled={!tag.trim() || draft.tags.length >= 3}>Add</button></div></label>
        {draft.tags.length > 0 && <div className="tag-list">{draft.tags.map((item) => <button type="button" key={item} className="tag" onClick={() => setDraft({ ...draft, tags: draft.tags.filter((t) => t !== item) })}>{item}<X size={12}/></button>)}</div>}
        <label>Acceptance criteria<textarea rows={3} value={draft.acceptanceCriteria} onChange={(e) => setDraft({ ...draft, acceptanceCriteria: e.target.value })} placeholder="How will we know this is done?" /></label>
        <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" type="submit">{ticket ? "Save changes" : "Create item"}</button></div>
      </form>
    </section>
  </div>;
}
