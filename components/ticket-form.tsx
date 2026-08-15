"use client";

import { useState, type DragEvent } from "react";
import { ChevronRight, Download, ExternalLink, GripVertical, Plus, Trash2, X } from "lucide-react";
import { COLUMNS, type ColumnId, type GitHubRepository, type Priority, type Ticket, type TicketDraft } from "@/lib/types";

const priorities: Priority[] = ["Low", "Medium", "High", "Urgent"];
const emptyDraft = (status: ColumnId): TicketDraft => ({ title: "", description: "", findings: "", priority: "Medium", tags: [], assignee: "", acceptanceCriteria: [], repositoryId: "", baseBranch: "", status });

export function TicketForm({ open, ticket, tickets, repositories, initialStatus, onClose, onSave, onSelectTicket }: { open: boolean; ticket?: Ticket; tickets: Ticket[]; repositories: GitHubRepository[]; initialStatus: ColumnId; onClose: () => void; onSave: (draft: TicketDraft) => void; onSelectTicket: (ticket: Ticket) => void }) {
  if (!open) return null;
  return <TicketFormContent key={ticket?.id ?? `new-${initialStatus}`} ticket={ticket} tickets={tickets} repositories={repositories} initialStatus={initialStatus} onClose={onClose} onSave={onSave} onSelectTicket={onSelectTicket}/>;
}

function TicketFormContent({ ticket, tickets, repositories, initialStatus, onClose, onSave, onSelectTicket }: { ticket?: Ticket; tickets: Ticket[]; repositories: GitHubRepository[]; initialStatus: ColumnId; onClose: () => void; onSave: (draft: TicketDraft) => void; onSelectTicket: (ticket: Ticket) => void }) {
  const [draft, setDraft] = useState<TicketDraft>(() => ticket ? { title: ticket.title, description: ticket.description, findings: ticket.findings, priority: ticket.priority, tags: ticket.tags, assignee: ticket.assignee, acceptanceCriteria: ticket.acceptanceCriteria, repositoryId: ticket.repositoryId, baseBranch: ticket.baseBranch, status: ticket.status } : emptyDraft(initialStatus));
  const [tag, setTag] = useState("");
  const [draggedCriterionId, setDraggedCriterionId] = useState<string>();
  const children = ticket ? tickets.filter((item) => item.parentEpicId === ticket.id) : [];
  const parent = ticket?.parentEpicId ? tickets.find((item) => item.id === ticket.parentEpicId) : undefined;
  const openTicket = (event: React.MouseEvent<HTMLAnchorElement>, selected: Ticket) => {
    event.preventDefault();
    onSelectTicket(selected);
  };
  const addTag = () => {
    const value = tag.trim();
    if (value && draft.tags.length < 3 && !draft.tags.includes(value)) {
      setDraft({ ...draft, tags: [...draft.tags, value] });
      setTag("");
    }
  };
  const updateCriteria = (acceptanceCriteria: TicketDraft["acceptanceCriteria"]) => setDraft({ ...draft, acceptanceCriteria });
  const addCriterion = () => updateCriteria([...draft.acceptanceCriteria, { id: crypto.randomUUID(), text: "", completed: false }]);
  const dropCriterion = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    if (!draggedCriterionId || draggedCriterionId === targetId) return;
    const from = draft.acceptanceCriteria.findIndex((item) => item.id === draggedCriterionId);
    const to = draft.acceptanceCriteria.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...draft.acceptanceCriteria];
    next.splice(to, 0, next.splice(from, 1)[0]);
    updateCriteria(next); setDraggedCriterionId(undefined);
  };
  const downloadContent = () => {
    const criteria = draft.acceptanceCriteria.map((item) => `- [${item.completed ? "x" : " "}] ${item.text}`).join("\n");
    const content = [`# Description`, draft.description || "No description provided.", "## Acceptance criteria", criteria || "No acceptance criteria provided."].join("\n\n");
    const blobUrl = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `${draft.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ticket"}.md`;
    link.click();
    URL.revokeObjectURL(blobUrl);
  };

  return <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="ticket-form-title" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-header"><div><p className="eyebrow">{ticket ? "Edit work item" : "New work item"}</p><h2 id="ticket-form-title">{ticket ? "Update the details" : "What needs to be done?"}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></div>
      <form onSubmit={(e) => { e.preventDefault(); onSave(draft); }}>
        {ticket?.parentEpicId && <div className="parent-item-link"><span>Parent ID</span>{parent ? <a href={`#ticket-${parent.id}`} onClick={(event) => openTicket(event, parent)}>FW-{parent.id.replaceAll("-", "").slice(0, 8).toUpperCase()} · {parent.title}<ExternalLink size={12}/></a> : <span className="missing-parent">FW-{ticket.parentEpicId.replaceAll("-", "").slice(0, 8).toUpperCase()} (not found)</span>}</div>}
        <label>Title<input autoFocus required maxLength={120} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="A clear, concise title" /></label>
        <label>Description<textarea rows={4} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Add context and useful details…" /></label>
        <label>Findings<textarea rows={4} value={draft.findings} onChange={(e) => setDraft({ ...draft, findings: e.target.value })} placeholder="Review findings appear here and are included in the next agent run." /></label>
        <div className="form-grid">
          <label>Priority<select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}>{priorities.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label>Status<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ColumnId })}>{COLUMNS.map((column) => <option key={column}>{column}</option>)}</select></label>
        </div>
        <label>Assignee<input value={draft.assignee} onChange={(e) => setDraft({ ...draft, assignee: e.target.value })} placeholder="Name or role" /></label>
        <div className="form-grid"><label>GitHub repository<select value={draft.repositoryId} onChange={(e) => { const repository = repositories.find((item) => item.id === e.target.value); setDraft({ ...draft, repositoryId: e.target.value, baseBranch: repository?.defaultBranch ?? "" }); }}><option value="">No repository</option>{repositories.map((repository) => <option value={repository.id} key={repository.id}>{repository.owner}/{repository.name}</option>)}</select></label><label>Base branch<input value={draft.baseBranch} disabled={!draft.repositoryId} onChange={(e) => setDraft({ ...draft, baseBranch: e.target.value })} placeholder="main"/></label></div>
        <label>Tags <span className="label-hint">up to 3</span><div className="tag-input"><input value={tag} disabled={draft.tags.length >= 3} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} placeholder="Type and press Enter"/><button type="button" onClick={addTag} disabled={!tag.trim() || draft.tags.length >= 3}>Add</button></div></label>
        {draft.tags.length > 0 && <div className="tag-list">{draft.tags.map((item) => <button type="button" key={item} className="tag" onClick={() => setDraft({ ...draft, tags: draft.tags.filter((t) => t !== item) })}>{item}<X size={12}/></button>)}</div>}
        <fieldset className="acceptance-criteria"><legend>Acceptance criteria</legend><div className="criteria-list">{draft.acceptanceCriteria.map((criterion) => <div className="criterion-row" key={criterion.id} draggable onDragStart={() => setDraggedCriterionId(criterion.id)} onDragEnd={() => setDraggedCriterionId(undefined)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropCriterion(event, criterion.id)}><button type="button" className="criterion-grip" aria-label={`Reorder ${criterion.text || "criterion"}`} title="Drag to reorder"><GripVertical size={16}/></button><input className="criterion-check" type="checkbox" checked={criterion.completed} onChange={(event) => updateCriteria(draft.acceptanceCriteria.map((item) => item.id === criterion.id ? { ...item, completed: event.target.checked } : item))} aria-label={`Mark ${criterion.text || "criterion"} complete`}/><input value={criterion.text} onChange={(event) => updateCriteria(draft.acceptanceCriteria.map((item) => item.id === criterion.id ? { ...item, text: event.target.value } : item))} placeholder="How will we know this is done?" aria-label="Acceptance criterion"/><button type="button" className="criterion-delete" onClick={() => updateCriteria(draft.acceptanceCriteria.filter((item) => item.id !== criterion.id))} aria-label={`Delete ${criterion.text || "criterion"}`}><Trash2 size={15}/></button></div>)}</div><button type="button" className="add-criterion" onClick={addCriterion}><Plus size={15}/> Add criterion</button></fieldset>
        {ticket && <details className="child-items"><summary><ChevronRight size={16}/><span>Child Items</span><span className="child-count">{children.length}</span></summary><div className="child-items-content">{children.length === 0 ? <p className="no-child-items">No Child Items</p> : <div className="child-table-wrap"><table><thead><tr><th>Title</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{children.map((child) => <tr key={child.id}><td><a href={`#ticket-${child.id}`} onClick={(event) => openTicket(event, child)}>{child.title}</a></td><td>{child.status}</td><td><a href={`#ticket-${child.id}`} onClick={(event) => openTicket(event, child)} aria-label={`Open ${child.title}`}>Open</a></td></tr>)}</tbody></table></div>}</div></details>}
        <div className="form-actions">{ticket && <button type="button" className="button secondary download-content" onClick={downloadContent}><Download size={15}/> Download content</button>}<button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" type="submit">{ticket ? "Save changes" : "Create item"}</button></div>
      </form>
    </section>
  </div>;
}
