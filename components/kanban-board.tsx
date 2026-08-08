"use client";
/* eslint-disable react-hooks/refs -- dnd-kit's hook intentionally exposes callback refs and attributes for render. */

import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CircleUserRound, Ellipsis, GripVertical, LayoutGrid, LogOut, Plus, Search, Trash2, X } from "lucide-react";
import { COLUMNS, type ColumnId, type Ticket, type TicketDraft } from "@/lib/types";
import { loadTickets, persistTickets, removeTicket } from "@/lib/ticket-store";
import { TicketForm } from "./ticket-form";

const priorityClass = (priority: Ticket["priority"]) => `priority ${priority.toLowerCase()}`;

function Card({ ticket, overlay = false, dragDisabled = false, onEdit, onDelete }: { ticket: Ticket; overlay?: boolean; dragDisabled?: boolean; onEdit?: () => void; onDelete?: () => void }) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const sortable = useSortable({ id: ticket.id, data: { type: "ticket", ticket }, disabled: overlay || dragDisabled });
  const style = overlay ? undefined : { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menu]);
  return <article ref={sortable.setNodeRef} style={style} className={`ticket-card ${overlay ? "dragging" : ""}`} {...sortable.attributes}>
    <div className="card-top"><span className={priorityClass(ticket.priority)}><i/>{ticket.priority}</span><div className="card-tools" ref={menuRef}><button className="grip" {...sortable.listeners} disabled={dragDisabled} title={dragDisabled ? "Clear search to move items" : undefined} aria-label={`Move ${ticket.title}`}><GripVertical size={16}/></button><button className="more" onClick={() => setMenu(!menu)} aria-label="Ticket actions" aria-expanded={menu}><Ellipsis size={18}/></button>{menu && <div className="card-menu"><button onClick={() => { setMenu(false); onEdit?.(); }}>Edit</button><button className="danger" onClick={() => { setMenu(false); onDelete?.(); }}><Trash2 size={14}/> Delete</button></div>}</div></div>
    <h3 onClick={onEdit}>{ticket.title}</h3>{ticket.description && <p>{ticket.description}</p>}
    {ticket.tags.length > 0 && <div className="tag-list compact">{ticket.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>}
    <div className="card-footer"><span className="ticket-id">FW-{ticket.id.replaceAll("-", "").slice(0, 8).toUpperCase()}</span>{ticket.assignee ? <span className="assignee" title={ticket.assignee}>{ticket.assignee.slice(0, 2).toUpperCase()}</span> : <CircleUserRound size={21} className="unassigned"/>}</div>
  </article>;
}

function Column({ name, tickets, dragDisabled, onAdd, onEdit, onDelete }: { name: ColumnId; tickets: Ticket[]; dragDisabled: boolean; onAdd: () => void; onEdit: (t: Ticket) => void; onDelete: (t: Ticket) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: name, data: { type: "column", status: name } });
  return <section className={`board-column ${isOver ? "over" : ""}`} ref={setNodeRef}>
    <header><div><span className="status-dot"/><h2>{name}</h2><span className="count">{tickets.length}</span></div><button onClick={onAdd} aria-label={`Add item to ${name}`}><Plus size={18}/></button></header>
    <SortableContext items={tickets.map((ticket) => ticket.id)} strategy={verticalListSortingStrategy}><div className="column-cards">{tickets.map((ticket) => <Card key={ticket.id} ticket={ticket} dragDisabled={dragDisabled} onEdit={() => onEdit(ticket)} onDelete={() => onDelete(ticket)}/>)}{tickets.length === 0 && <button className="empty-column" onClick={onAdd}><Plus size={16}/> Add item</button>}</div></SortableContext>
  </section>;
}

function DeleteDialog({ ticket, onCancel, onConfirm }: { ticket?: Ticket; onCancel: () => void; onConfirm: () => void }) {
  if (!ticket) return null;
  return <div className="modal-backdrop" onMouseDown={onCancel} role="presentation"><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}><span className="delete-icon"><Trash2 size={20}/></span><h2 id="delete-title">Delete this item?</h2><p>“{ticket.title}” will be permanently removed from the board.</p><div className="form-actions"><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger-button" onClick={onConfirm}>Delete item</button></div></section></div>;
}

export function KanbanBoard({ userEmail, onSignOut }: { userEmail: string; onSignOut: () => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]); const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(""); const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState<Ticket>(); const [deleting, setDeleting] = useState<Ticket>(); const [formStatus, setFormStatus] = useState<ColumnId>("New"); const [active, setActive] = useState<Ticket>(); const [error, setError] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => { loadTickets().then(setTickets).catch(() => setError("Could not load your board." )).finally(() => setLoading(false)); }, []);
  const visible = useMemo(() => { const term = query.toLowerCase(); return tickets.filter((t) => !term || [t.title, t.description, t.assignee, ...t.tags].some((value) => value.toLowerCase().includes(term))); }, [tickets, query]);
  const saveAll = async (next: Ticket[]) => { setTickets(next); try { await persistTickets(next); setError(""); } catch { setError("Your change could not be saved. Please try again."); } };
  const openNew = (status: ColumnId = "New") => { setEditing(undefined); setFormStatus(status); setFormOpen(true); };
  const save = (draft: TicketDraft) => { const now = new Date().toISOString(); const next = editing ? tickets.map((t) => t.id === editing.id ? { ...t, ...draft, updatedAt: now } : t) : [...tickets, { ...draft, id: crypto.randomUUID(), position: tickets.filter((t) => t.status === draft.status).length, createdAt: now, updatedAt: now }]; setFormOpen(false); void saveAll(next); };
  const confirmDelete = async () => { if (!deleting) return; const ticket = deleting; const previous = tickets; const next = tickets.filter((item) => item.id !== ticket.id); setDeleting(undefined); setTickets(next); try { await removeTicket(ticket.id); } catch { setTickets(previous); setError("The item could not be deleted."); } };
  const dragStart = (event: DragStartEvent) => setActive(tickets.find((t) => t.id === event.active.id));
  const dragEnd = (event: DragEndEvent) => {
    setActive(undefined);
    const ticket = tickets.find((item) => item.id === event.active.id);
    if (!ticket || !event.over || query) return;
    const overTicket = tickets.find((item) => item.id === event.over?.id);
    const destination = overTicket?.status ?? (event.over.data.current?.status as ColumnId);
    if (!destination) return;
    const byPosition = (a: Ticket, b: Ticket) => a.position - b.position;
    const sourceItems = tickets.filter((item) => item.status === ticket.status).sort(byPosition);
    let affected: Ticket[];
    if (destination === ticket.status) {
      const oldIndex = sourceItems.findIndex((item) => item.id === ticket.id);
      const newIndex = overTicket ? sourceItems.findIndex((item) => item.id === overTicket.id) : sourceItems.length - 1;
      if (oldIndex === newIndex) return;
      affected = arrayMove(sourceItems, oldIndex, newIndex);
    } else {
      const destinationItems = tickets.filter((item) => item.status === destination && item.id !== ticket.id).sort(byPosition);
      const insertAt = overTicket ? destinationItems.findIndex((item) => item.id === overTicket.id) : destinationItems.length;
      destinationItems.splice(insertAt < 0 ? destinationItems.length : insertAt, 0, { ...ticket, status: destination });
      affected = [...sourceItems.filter((item) => item.id !== ticket.id), ...destinationItems];
    }
    const now = new Date().toISOString();
    const updates = new Map<string, Ticket>();
    for (const status of new Set([ticket.status, destination])) {
      affected.filter((item) => item.status === status).forEach((item, position) => updates.set(item.id, { ...item, position, updatedAt: now }));
    }
    void saveAll(tickets.map((item) => updates.get(item.id) ?? item));
  };

  return <main>
    <nav><div className="brand"><span><LayoutGrid size={18}/></span><strong>Flowboard</strong></div><div className="nav-meta"><span className="connection"><i/>Synced</span><span className="user-email">{userEmail}</span><button className="signout-button" onClick={onSignOut} aria-label="Sign out" title="Sign out"><LogOut size={17}/></button></div></nav>
    <div className="workspace-header"><div><p className="eyebrow">Workspace / Product</p><h1>Delivery board</h1><p>Move every idea from first thought to live.</p></div><button className="button primary create" onClick={() => openNew()}><Plus size={18}/> Create item</button></div>
    <div className="toolbar"><label className="search"><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search work items…" aria-label="Search work items"/>{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={15}/></button>}</label><span className="result-count">{query ? "Clear search to move items" : `${visible.length} ${visible.length === 1 ? "item" : "items"}`}</span></div>
    {error && <div className="error-banner">{error}<button onClick={() => setError("")}><X size={15}/></button></div>}
    {loading ? <div className="loading-board">Loading your workspace…</div> : <DndContext sensors={sensors} onDragStart={dragStart} onDragEnd={dragEnd} onDragCancel={() => setActive(undefined)}><div className="board">{COLUMNS.map((column) => <Column key={column} name={column} tickets={visible.filter((t) => t.status === column).sort((a,b) => a.position-b.position)} dragDisabled={Boolean(query)} onAdd={() => openNew(column)} onEdit={(ticket) => { setEditing(ticket); setFormStatus(ticket.status); setFormOpen(true); }} onDelete={setDeleting}/>)}</div><DragOverlay>{active ? <Card ticket={active} overlay/> : null}</DragOverlay></DndContext>}
    <TicketForm open={formOpen} ticket={editing} initialStatus={formStatus} onClose={() => setFormOpen(false)} onSave={save}/>
    <DeleteDialog ticket={deleting} onCancel={() => setDeleting(undefined)} onConfirm={() => void confirmDelete()}/>
  </main>;
}
