"use client";
/* eslint-disable react-hooks/refs -- dnd-kit's hook intentionally exposes callback refs and attributes for render. */

import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { BookOpenText, Bot, CircleUserRound, Ellipsis, Github, GitBranch, GripVertical, LayoutGrid, ListTodo, LogOut, Menu, Play, Plus, Search, Settings2, Trash2, Zap, X } from "lucide-react";
import { COLUMNS, type ColumnId, type GitHubRepository, type Ticket, type TicketDraft } from "@/lib/types";
import { loadTickets, persistTicket, persistTickets, removeTicket } from "@/lib/ticket-store";
import { TicketForm } from "./ticket-form";
import { ColumnSetup } from "./column-setup";
import { loadColumnAgents, queueAgentRun, saveColumnAgent } from "@/lib/agent-store";
import type { ColumnAgent } from "@/lib/agent-types";
import { RepositorySetup } from "./repository-setup";
import { addRepository, deleteRepository, loadRepositories } from "@/lib/repository-store";
import { RefinementDialog } from "./refinement-dialog";
import type { RefinedTicketContent, RefinementAnswer, RefinementProposal } from "@/lib/refinement-types";
import { WorkspaceInstructions } from "./workspace-instructions";
import { loadMasterInstructions, saveMasterInstructions } from "@/lib/workspace-store";
import { QueueDialog } from "./queue-dialog";
import { completeBreakoutSession, confirmEpicRecommendation, recommendEpic, startEpicBreakout } from "@/lib/epic-store";
import { EpicBreakoutDialog, type BreakoutOutcome } from "./epic-breakout-dialog";
import type { EpicRecommendation, ProposedChild } from "@/lib/types";

const priorityClass = (priority: Ticket["priority"]) => `priority ${priority.toLowerCase()}`;

function Card({ ticket, agent, overlay = false, dragDisabled = false, onEdit, onDelete, onRun, onForceBreakout }: { ticket: Ticket; agent?: ColumnAgent; overlay?: boolean; dragDisabled?: boolean; onEdit?: () => void; onDelete?: () => void; onRun?: () => void; onForceBreakout?: () => void }) {
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
    <div className="card-top"><span className={priorityClass(ticket.priority)}><i/>{ticket.priority}</span>{ticket.itemType === "Epic" && <span className="epic-badge"><GitBranch size={11}/> Epic</span>}{ticket.isDraft && <span className="draft-badge">Draft</span>}<div className="card-tools" ref={menuRef}><button className="grip" {...sortable.listeners} disabled={dragDisabled} title={dragDisabled ? "Clear search to move items" : undefined} aria-label={`Move ${ticket.title}`}><GripVertical size={16}/></button><button className="more" onClick={() => setMenu(!menu)} aria-label="Ticket actions" aria-expanded={menu}><Ellipsis size={18}/></button>{menu && <div className="card-menu"><button onClick={() => { setMenu(false); onEdit?.(); }}>Edit</button><button onClick={() => { setMenu(false); onForceBreakout?.(); }}><Zap size={14}/> Force refinement breakout</button><button className="danger" onClick={() => { setMenu(false); onDelete?.(); }}><Trash2 size={14}/> Delete</button></div>}</div></div>
    <h3 onClick={onEdit}>{ticket.title}</h3>{ticket.description && <p>{ticket.description}</p>}
    {ticket.tags.length > 0 && <div className="tag-list compact">{ticket.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>}
    <div className="card-footer"><span className="ticket-id">FW-{ticket.id.replaceAll("-", "").slice(0, 8).toUpperCase()}</span><div className="card-footer-actions">{agent?.enabled && agent.startMode === "manual" && <button className="run-agent" onClick={onRun} title={`Run ${agent.name}`} aria-label={`Run ${agent.name}`}><Play size={11}/> Run agent</button>}{ticket.assignee ? <span className="assignee" title={ticket.assignee}>{ticket.assignee.slice(0, 2).toUpperCase()}</span> : <CircleUserRound size={21} className="unassigned"/>}</div></div>
  </article>;
}

function Column({ name, tickets, agent, dragDisabled, onAdd, onEdit, onDelete, onRun, onForceBreakout }: { name: ColumnId; tickets: Ticket[]; agent?: ColumnAgent; dragDisabled: boolean; onAdd: () => void; onEdit: (t: Ticket) => void; onDelete: (t: Ticket) => void; onRun: (t: Ticket) => void; onForceBreakout: (t: Ticket) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: name, data: { type: "column", status: name } });
  return <section className={`board-column ${isOver ? "over" : ""}`} ref={setNodeRef}>
    <header><div><span className="status-dot"/><h2>{name}</h2><span className="count">{tickets.length}</span>{agent?.enabled && <span className={`agent-mode ${agent.startMode}`} title={`${agent.name} · ${agent.startMode}`}><Bot size={11}/></span>}</div><button onClick={onAdd} aria-label={`Add item to ${name}`}><Plus size={18}/></button></header>
    <SortableContext items={tickets.map((ticket) => ticket.id)} strategy={verticalListSortingStrategy}><div className="column-cards">{tickets.map((ticket) => <Card key={ticket.id} ticket={ticket} agent={agent} dragDisabled={dragDisabled} onEdit={() => onEdit(ticket)} onDelete={() => onDelete(ticket)} onRun={() => onRun(ticket)} onForceBreakout={() => onForceBreakout(ticket)}/>)}{tickets.length === 0 && <button className="empty-column" onClick={onAdd}><Plus size={16}/> Add item</button>}</div></SortableContext>
  </section>;
}

function DeleteDialog({ ticket, onCancel, onConfirm }: { ticket?: Ticket; onCancel: () => void; onConfirm: () => void }) {
  if (!ticket) return null;
  return <div className="modal-backdrop" onMouseDown={onCancel} role="presentation"><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}><span className="delete-icon"><Trash2 size={20}/></span><h2 id="delete-title">Delete this item?</h2><p>“{ticket.title}” will be permanently removed from the board.</p><div className="form-actions"><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger-button" onClick={onConfirm}>Delete item</button></div></section></div>;
}

export function KanbanBoard({ userEmail, onSignOut }: { userEmail: string; onSignOut: () => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]); const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(""); const [formOpen, setFormOpen] = useState(false); const [setupOpen, setSetupOpen] = useState(false); const [repositoriesOpen, setRepositoriesOpen] = useState(false); const [instructionsOpen, setInstructionsOpen] = useState(false); const [headerMenu, setHeaderMenu] = useState(false); const [editing, setEditing] = useState<Ticket>(); const [deleting, setDeleting] = useState<Ticket>(); const [refining, setRefining] = useState<Ticket>(); const [formStatus, setFormStatus] = useState<ColumnId>("New"); const [active, setActive] = useState<Ticket>(); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [agents, setAgents] = useState<ColumnAgent[]>([]); const [repositories, setRepositories] = useState<GitHubRepository[]>([]); const [masterInstructions, setMasterInstructions] = useState("");
  const [queueOpen, setQueueOpen] = useState(false);
  const [epicCandidate, setEpicCandidate] = useState<{ ticket: Ticket; recommendation: EpicRecommendation }>();
  const [breakoutRunning, setBreakoutRunning] = useState(false); const [breakoutOutcome, setBreakoutOutcome] = useState<BreakoutOutcome>(); const [breakoutError, setBreakoutError] = useState("");
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => { Promise.all([loadTickets(), loadColumnAgents(), loadRepositories(), loadMasterInstructions()]).then(([loadedTickets, loadedAgents, loadedRepositories, loadedInstructions]) => { setTickets(loadedTickets); setAgents(loadedAgents); setRepositories(loadedRepositories); setMasterInstructions(loadedInstructions); }).catch(() => setError("Could not load your board. Make sure all database migrations are installed." )).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (!headerMenu) return; const dismiss = (event: PointerEvent) => { if (!headerMenuRef.current?.contains(event.target as Node)) setHeaderMenu(false); }; document.addEventListener("pointerdown", dismiss); return () => document.removeEventListener("pointerdown", dismiss); }, [headerMenu]);
  const visible = useMemo(() => { const term = query.toLowerCase(); return tickets.filter((t) => !term || [t.title, t.description, t.assignee, ...t.tags].some((value) => value.toLowerCase().includes(term))); }, [tickets, query]);
  const saveAll = async (next: Ticket[]) => { setTickets(next); try { await persistTickets(next); setError(""); } catch { setError("Your change could not be saved. Please try again."); } };
  const openNew = (status: ColumnId = "New") => { setEditing(undefined); setFormStatus(status); setFormOpen(true); };
  const save = (draft: TicketDraft) => { const now = new Date().toISOString(); const next = editing ? tickets.map((t) => t.id === editing.id ? { ...t, ...draft, updatedAt: now } : t) : [...tickets, { ...draft, id: crypto.randomUUID(), position: tickets.filter((t) => t.status === draft.status).length, createdAt: now, updatedAt: now, itemType: "Item" as const, parentEpicId: "", isDraft: false }]; setFormOpen(false); void saveAll(next); };
  const confirmDelete = async () => { if (!deleting) return; const ticket = deleting; const previous = tickets; const next = tickets.filter((item) => item.id !== ticket.id); setDeleting(undefined); setTickets(next); try { await removeTicket(ticket.id); } catch { setTickets(previous); setError("The item could not be deleted."); } };
  const runAgent = async (ticket: Ticket, trigger: "manual" | "automatic" = "manual") => { const agent = agents.find((item) => item.column === ticket.status); if (!agent?.enabled) return; if (ticket.status === "In Refinement" && trigger === "manual") { setRefining(ticket); return; } const isAfterRefinement = COLUMNS.indexOf(ticket.status) > COLUMNS.indexOf("In Refinement"); if (isAfterRefinement && !ticket.repositoryId) { setError("Select a GitHub repository on this work item before starting its agent."); return; } if (ticket.repositoryId && agent.repositoryAccess === "selected" && !agent.allowedRepositoryIds.includes(ticket.repositoryId)) { setError(`${agent.name} is not allowed to use this ticket’s repository.`); return; } try { await queueAgentRun(ticket.id, agent, trigger); setNotice(`${agent.name} queued for “${ticket.title}”.`); } catch { setError("The agent could not be started. Run the latest database migration and try again."); } };
  const submitRefinement = async (repositoryId: string, proposal: RefinementProposal, answers: RefinementAnswer[], rewrite: RefinedTicketContent) => {
    if (!refining) return;
    const agent = agents.find((item) => item.column === "In Refinement");
    if (!agent) throw new Error("The refinement agent is not configured.");
    if (repositoryId && agent.repositoryAccess === "selected" && !agent.allowedRepositoryIds.includes(repositoryId)) throw new Error(`${agent.name} is not allowed to use the selected repository.`);
    const { epicRecommendation, ...ticketRewrite } = rewrite;
    const updated = { ...refining, ...ticketRewrite, acceptanceCriteria: rewrite.acceptanceCriteria.split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text) => ({ id: crypto.randomUUID(), text, completed: false })), tags: rewrite.tags.slice(0, 3), repositoryId, baseBranch: repositories.find((repository) => repository.id === repositoryId)?.defaultBranch ?? "", updatedAt: new Date().toISOString() };
    await persistTickets(tickets.map((ticket) => ticket.id === updated.id ? updated : ticket));
    await queueAgentRun(updated.id, agent, "manual", { refinement: { repositoryId, repositoryReason: proposal.repositoryReason, answers, rewrittenTicket: rewrite } });
    setTickets((current) => current.map((ticket) => ticket.id === updated.id ? updated : ticket));
    if (epicRecommendation.recommended && updated.itemType !== "Epic") {
      const recommendation = await recommendEpic(updated.id, epicRecommendation.reason, agent.name);
      setBreakoutOutcome(undefined); setBreakoutError(""); setEpicCandidate({ ticket: updated, recommendation });
      setNotice(`“${updated.title}” was refined and recommended as an Epic.`);
    } else setNotice(`“${updated.title}” was rewritten and ${agent.name} was queued.`);
    setRefining(undefined);
  };
  const dragStart = (event: DragStartEvent) => setActive(tickets.find((t) => t.id === event.active.id));
  const dragEnd = async (event: DragEndEvent) => {
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
    const next = tickets.map((item) => updates.get(item.id) ?? item);
    await saveAll(next);
    const moved = next.find((item) => item.id === ticket.id);
    const destinationAgent = agents.find((item) => item.column === destination);
    if (moved && destinationAgent?.enabled && destinationAgent.startMode === "automatic" && destination !== ticket.status) await runAgent(moved, "automatic");
  };
  const updateAgent = async (agent: ColumnAgent) => { await saveColumnAgent(agent); setAgents((current) => current.map((item) => item.column === agent.column ? agent : item)); };
  const createRepository = async (repository: Omit<GitHubRepository, "id">) => { const created = await addRepository(repository); setRepositories((current) => [...current, created]); };
  const removeRepository = async (id: string) => { await deleteRepository(id); setRepositories((current) => current.filter((item) => item.id !== id)); };
  const updateMasterInstructions = async (instructions: string) => { await saveMasterInstructions(instructions); setMasterInstructions(instructions.trim()); };
  const runBreakout = async (ticket: Ticket, force = false) => {
    setBreakoutRunning(true); setBreakoutError("");
    if (force) setNotice(`Starting refinement breakout for “${ticket.title}”…`);
    const repository = repositories.find((item) => item.id === ticket.repositoryId);
    const domain = repository ? `${repository.owner}/${repository.name}` : "workspace application";
    const configuredAgent = agents.find((item) => item.column === "In Refinement") ?? agents.find((item) => item.enabled);
    const specializedAgent = { name: repository ? `${repository.name} Breakout Agent` : "Application Breakout Agent", modelName: configuredAgent?.modelName ?? "gpt-5.6-luna" };
    try {
      const started = force
        ? await startEpicBreakout(ticket, userEmail, specializedAgent, domain)
        : await confirmEpicRecommendation(ticket, epicCandidate!.recommendation, userEmail, specializedAgent, domain);
      const { epic, session } = started;
      await persistTicket(epic);
      setTickets((current) => current.map((item) => item.id === epic.id ? epic : item));
      const response = await fetch("/api/epic-breakout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ epic, domain, requesterEmail: userEmail, ...specializedAgent, instructions: configuredAgent?.instructions ?? "" }) });
      const proposal = await response.json() as { children?: ProposedChild[]; error?: string };
      if (!response.ok || !proposal.children) throw new Error(proposal.error || "The breakout agent did not return child items.");
      const created: Ticket[] = []; const failed: Array<{ title: string; error: string }> = [];
      for (const child of proposal.children) {
        const now = new Date().toISOString();
        const draft: Ticket = { id: crypto.randomUUID(), title: child.title, description: child.description, acceptanceCriteria: child.acceptanceCriteria.map((text) => ({ id: crypto.randomUUID(), text, completed: false })), priority: child.priority, tags: child.tags.slice(0, 3), assignee: "", repositoryId: epic.repositoryId, baseBranch: epic.baseBranch, status: "New", position: tickets.filter((item) => item.status === "New").length + created.length, createdAt: now, updatedAt: now, itemType: "Item", parentEpicId: epic.id, isDraft: true };
        try { await persistTicket(draft); created.push(draft); setTickets((current) => [...current, draft]); }
        catch (cause) { failed.push({ title: child.title, error: cause instanceof Error ? cause.message : "Could not save draft ticket." }); }
      }
      await completeBreakoutSession(session, failed);
      setBreakoutOutcome({ created, failed });
      if (force) setNotice(`${created.length} draft ${created.length === 1 ? "ticket" : "tickets"} created for “${epic.title}”${failed.length ? `; ${failed.length} failed` : ""}.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The Epic breakout could not be completed.";
      if (force) { setNotice(""); setError(message); } else setBreakoutError(message);
    }
    finally { setBreakoutRunning(false); }
  };
  const confirmAndRunBreakout = async () => { if (epicCandidate) await runBreakout(epicCandidate.ticket); };

  return <main>
    <nav><div className="brand"><span><LayoutGrid size={18}/></span><strong>Flowboard</strong></div><div className="nav-meta"><span className="connection"><i/>Synced</span><span className="user-email">{userEmail}</span><div className="header-menu-wrap" ref={headerMenuRef}><button className="header-menu-button" onClick={() => setHeaderMenu(!headerMenu)} aria-label="Open workspace menu" aria-expanded={headerMenu}><Menu size={19}/></button>{headerMenu && <div className="header-menu"><button onClick={() => { setHeaderMenu(false); setQueueOpen(true); }}><ListTodo size={16}/><span><strong>Agent queue</strong><small>View queued runs and their items</small></span></button><button onClick={() => { setHeaderMenu(false); setSetupOpen(true); }}><Settings2 size={16}/><span><strong>Column Setup</strong><small>Configure agents and automation</small></span></button><button onClick={() => { setHeaderMenu(false); setInstructionsOpen(true); }}><BookOpenText size={16}/><span><strong>Master instructions</strong><small>Shared context for every agent</small></span></button><button onClick={() => { setHeaderMenu(false); setRepositoriesOpen(true); }}><Github size={16}/><span><strong>GitHub repositories</strong><small>Manage workspace repositories</small></span></button><button onClick={onSignOut}><LogOut size={16}/><span><strong>Sign out</strong><small>{userEmail}</small></span></button></div>}</div></div></nav>
    <div className="workspace-header"><div><p className="eyebrow">Workspace / Product</p><h1>Delivery board</h1><p>Move every idea from first thought to live.</p></div><button className="button primary create" onClick={() => openNew()}><Plus size={18}/> Create item</button></div>
    <div className="toolbar"><label className="search"><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search work items…" aria-label="Search work items"/>{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={15}/></button>}</label><span className="result-count">{query ? "Clear search to move items" : `${visible.length} ${visible.length === 1 ? "item" : "items"}`}</span></div>
    {error && <div className="error-banner">{error}<button onClick={() => setError("")}><X size={15}/></button></div>}
    {notice && <div className="notice-banner"><Bot size={15}/><span>{notice}</span><button onClick={() => setNotice("")}><X size={15}/></button></div>}
    {loading ? <div className="loading-board">Loading your workspace…</div> : <DndContext sensors={sensors} onDragStart={dragStart} onDragEnd={(event) => void dragEnd(event)} onDragCancel={() => setActive(undefined)}><div className="board">{COLUMNS.map((column) => <Column key={column} name={column} tickets={visible.filter((t) => t.status === column).sort((a,b) => a.position-b.position)} agent={agents.find((agent) => agent.column === column)} dragDisabled={Boolean(query)} onAdd={() => openNew(column)} onEdit={(ticket) => { setEditing(ticket); setFormStatus(ticket.status); setFormOpen(true); }} onDelete={setDeleting} onRun={(ticket) => void runAgent(ticket)} onForceBreakout={(ticket) => void runBreakout(ticket, true)}/>)}</div><DragOverlay>{active ? <Card ticket={active} overlay/> : null}</DragOverlay></DndContext>}
    <TicketForm open={formOpen} ticket={editing} repositories={repositories} initialStatus={formStatus} onClose={() => setFormOpen(false)} onSave={save}/>
    <DeleteDialog ticket={deleting} onCancel={() => setDeleting(undefined)} onConfirm={() => void confirmDelete()}/>
    {setupOpen && <ColumnSetup open agents={agents} repositories={repositories} onClose={() => setSetupOpen(false)} onSave={updateAgent}/>}
    {repositoriesOpen && <RepositorySetup repositories={repositories} onClose={() => setRepositoriesOpen(false)} onAdd={createRepository} onDelete={removeRepository}/>}
    {instructionsOpen && <WorkspaceInstructions instructions={masterInstructions} onClose={() => setInstructionsOpen(false)} onSave={updateMasterInstructions}/>}
    {queueOpen && <QueueDialog tickets={tickets} onClose={() => setQueueOpen(false)}/>}
    {epicCandidate && <EpicBreakoutDialog
      ticket={epicCandidate.ticket}
      recommendation={epicCandidate.recommendation}
      agentName={repositories.find((item) => item.id === epicCandidate.ticket.repositoryId)?.name ? `${repositories.find((item) => item.id === epicCandidate.ticket.repositoryId)?.name} Breakout Agent` : "Application Breakout Agent"}
      domain={repositories.find((item) => item.id === epicCandidate.ticket.repositoryId) ? `${repositories.find((item) => item.id === epicCandidate.ticket.repositoryId)?.owner}/${repositories.find((item) => item.id === epicCandidate.ticket.repositoryId)?.name}` : "workspace application"}
      running={breakoutRunning} outcome={breakoutOutcome} error={breakoutError}
      onClose={() => { setEpicCandidate(undefined); setBreakoutOutcome(undefined); setBreakoutError(""); }}
      onConfirm={() => void confirmAndRunBreakout()}
    />}
    {refining && agents.find((agent) => agent.column === "In Refinement") && <RefinementDialog key={refining.id} ticket={refining} agent={agents.find((agent) => agent.column === "In Refinement")!} repositories={repositories.filter((repository) => { const agent = agents.find((item) => item.column === "In Refinement"); return !agent || agent.repositoryAccess === "all" || agent.allowedRepositoryIds.includes(repository.id); })} masterInstructions={masterInstructions} onClose={() => setRefining(undefined)} onSubmit={submitRefinement}/>}
  </main>;
}
