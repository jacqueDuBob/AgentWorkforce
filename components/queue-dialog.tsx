"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Bot, Clock3, ListTodo, RefreshCw, X } from "lucide-react";
import { loadAgentRuns } from "@/lib/agent-store";
import type { AgentRun, AgentRunStatus } from "@/lib/agent-types";
import type { Ticket } from "@/lib/types";

function elapsed(run: AgentRun, now: number) {
  const started = new Date(run.startedAt ?? run.createdAt).getTime();
  const ended = run.status === "in_progress" ? now : new Date(run.finishedAt ?? run.updatedAt).getTime();
  const seconds = Math.max(0, Math.floor((ended - started) / 1000));
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}s`
    : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

export function QueueDialog({ tickets, onClose }: { tickets: Ticket[]; onClose: () => void }) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [status, setStatus] = useState<AgentRunStatus>("queued");
  const [selectedId, setSelectedId] = useState("");
  const selected = runs.find((run) => run.id === selectedId);
  const selectedTicket = selected ? tickets.find((ticket) => ticket.id === selected.ticketId) : undefined;
  const visibleRuns = runs.filter((run) => run.status === status);

  const refresh = async () => {
    setLoading(true); setError("");
    try { setRuns(await loadAgentRuns()); }
    catch { setError("The agent queue could not be loaded."); }
    finally { setLoading(false); }
  };
  useEffect(() => { let active = true; loadAgentRuns().then((items) => { if (active) setRuns(items); }).catch(() => { if (active) setError("The agent queue could not be loaded."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="queue-dialog" role="dialog" aria-modal="true" aria-labelledby="queue-title" onMouseDown={(event) => event.stopPropagation()}>
    <header className="queue-header">
      <div>{selected && <button className="icon-button" onClick={() => setSelectedId("")} aria-label="Back to run queue"><ArrowLeft size={18}/></button>}<span><ListTodo size={19}/></span><div><p className="eyebrow">Agents</p><h2 id="queue-title">{selected ? "Run details" : "Run queue"}</h2></div></div>
      <div>{!selected && <><label className="queue-filter"><span className="sr-only">Filter runs by status</span><select value={status} onChange={(event) => setStatus(event.target.value as AgentRunStatus)}><option value="queued">Queued</option><option value="in_progress">In progress</option><option value="finished">Finished</option></select></label><button className="icon-button" onClick={() => void refresh()} aria-label="Refresh queue"><RefreshCw size={17}/></button></>}<button className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></div>
    </header>
    <div className="queue-body">{error && <div className="error-banner">{error}</div>}
      {selected ? <div className="queue-detail">
        <section className="queue-detail-summary">
          <span className={`queue-status ${selected.status}`}>{selected.status.replace("_", " ")}</span>
          <div><h3>{selectedTicket?.title ?? "Deleted work item"}</h3><p>{selected.agentName} · {selected.column}</p></div>
        </section>
        <dl className="queue-detail-facts">
          <div><dt>Status</dt><dd>{selected.status.replace("_", " ")}</dd></div>
          <div><dt>Trigger</dt><dd>{selected.trigger}</dd></div>
          <div><dt>Model</dt><dd>{selected.modelName || "Default model"}</dd></div>
          <div><dt>Duration</dt><dd>{selected.status === "queued" ? "Waiting" : elapsed(selected, now)}</dd></div>
          <div><dt>Queued</dt><dd>{new Date(selected.createdAt).toLocaleString()}</dd></div>
          <div><dt>Run ID</dt><dd>{selected.id}</dd></div>
        </dl>
        {selectedTicket && <section className="queue-detail-section"><h4>Ticket</h4><dl className="queue-ticket-facts"><div><dt>Current status</dt><dd>{selectedTicket.status}</dd></div><div><dt>Priority</dt><dd>{selectedTicket.priority}</dd></div><div><dt>Tags</dt><dd>{selectedTicket.tags.join(", ") || "None"}</dd></div><div><dt>Repository</dt><dd>{selectedTicket.repositoryId || "None"}</dd></div></dl><h5>Description</h5><p className="queue-detail-copy">{selectedTicket.description || "No description."}</p><h5>Acceptance criteria</h5>{selectedTicket.acceptanceCriteria.length ? <ul>{selectedTicket.acceptanceCriteria.map((criterion) => <li key={criterion.id}>{criterion.completed ? "✓ " : ""}{criterion.text}</li>)}</ul> : <p className="queue-detail-copy">No acceptance criteria.</p>}</section>}
        <section className="queue-detail-section"><h4>Instruction snapshot</h4><p className="queue-detail-help">Exact rendered prompt stored when this run was queued.</p><pre>{selected.renderedPrompt || "No prompt snapshot is available for this run."}</pre></section>
        {selected.error && <section className="queue-detail-section"><h4>Error</h4><pre className="queue-detail-error">{selected.error}</pre></section>}
        {selected.output && <section className="queue-detail-section"><h4>Output</h4><pre>{JSON.stringify(selected.output, null, 2)}</pre></section>}
      </div> : loading ? <p className="queue-empty">Loading queue…</p> : visibleRuns.length === 0 ? <p className="queue-empty">No {status.replace("_", " ")} agent runs.</p> : <div className="queue-list">{visibleRuns.map((run) => { const ticket = tickets.find((item) => item.id === run.ticketId); return <article key={run.id}><button className="queue-item-button" onClick={() => setSelectedId(run.id)}><span className={`queue-status ${run.status}`}>{run.status.replace("_", " ")}</span><div><strong>{ticket?.title ?? "Deleted work item"}</strong><p><Bot size={12}/>{run.agentName} · {run.column}</p><p><Clock3 size={12}/>{run.status === "queued" ? "Waiting" : elapsed(run, now)}</p></div><time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString()}</time>{run.error && <small>{run.error}</small>}</button></article>; })}</div>}
    </div>
  </section></div>;
}
