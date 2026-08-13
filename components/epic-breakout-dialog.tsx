"use client";

import { Bot, CheckCircle2, GitBranch, TriangleAlert, X } from "lucide-react";
import type { EpicRecommendation, Ticket } from "@/lib/types";

export interface BreakoutOutcome { created: Ticket[]; failed: Array<{ title: string; error: string }>; }

export function EpicBreakoutDialog({ ticket, recommendation, forced = false, agentName, domain, running, outcome, error, onClose, onConfirm }: {
  ticket: Ticket; recommendation?: EpicRecommendation; forced?: boolean; agentName: string; domain: string; running: boolean; outcome?: BreakoutOutcome; error: string; onClose: () => void; onConfirm: () => void;
}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={running ? undefined : onClose}><section className="epic-dialog" role="dialog" aria-modal="true" aria-labelledby="epic-title" onMouseDown={(event) => event.stopPropagation()}>
    <header className="refinement-header"><span><GitBranch size={20}/></span><div><p className="eyebrow">{forced ? "Epic structuring" : "Epic candidate"}</p><h2 id="epic-title">{ticket.title}</h2></div><button className="icon-button" disabled={running} onClick={onClose} aria-label="Close"><X size={19}/></button></header>
    <div className="epic-body">
      {!outcome && !running && <><div className="epic-recommendation"><Bot size={18}/><div><strong>{forced ? "Structure this item as an Epic" : `${recommendation?.recommendedBy ?? "The refinement agent"} recommends converting this item to an Epic`}</strong><p>{forced ? "The breakout agent will analyze this item and create linked draft child tickets." : recommendation?.reason}</p></div></div><dl className="breakout-facts"><div><dt>Breakout agent</dt><dd>{agentName}</dd></div><div><dt>Repository / app domain</dt><dd>{domain}</dd></div><div><dt>Participant</dt><dd>You (requesting user)</dd></div></dl><p className="epic-warning">Confirmation updates this existing item in place, preserving its ID and history, and immediately starts one breakout session.</p></>}
      {running && <div className="refinement-loading"><Bot size={21}/><strong>Breaking the Epic into draft child items…</strong><span>Each proposed child is saved independently.</span></div>}
      {error && <div className="error-banner refinement-error"><TriangleAlert size={16}/>{error}</div>}
      {outcome && <div className="breakout-result"><CheckCircle2 size={28}/><h3>{outcome.created.length} draft {outcome.created.length === 1 ? "ticket" : "tickets"} created</h3><p>Successful drafts remain linked to this Epic.</p>{outcome.created.map((child) => <div className="child-result" key={child.id}><strong>{child.title}</strong><span>Draft</span></div>)}{outcome.failed.length > 0 && <div className="failed-children"><strong>{outcome.failed.length} child {outcome.failed.length === 1 ? "creation" : "creations"} failed</strong>{outcome.failed.map((failure) => <p key={failure.title}><b>{failure.title}:</b> {failure.error}</p>)}</div>}</div>}
    </div>
    <footer className="refinement-actions"><button className="button secondary" disabled={running} onClick={onClose}>{outcome ? "Close" : "Cancel"}</button>{!outcome && <button className="button primary" disabled={running} onClick={onConfirm}>{running ? "Structuring Epic…" : "Confirm Epic & start structuring"}</button>}</footer>
  </section></div>;
}
