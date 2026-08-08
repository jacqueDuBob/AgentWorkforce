"use client";

import { useEffect, useState } from "react";
import { Bot, ListTodo, RefreshCw, X } from "lucide-react";
import { loadAgentRuns } from "@/lib/agent-store";
import type { AgentRun, AgentRunStatus } from "@/lib/agent-types";
import type { Ticket } from "@/lib/types";

export function QueueDialog({ tickets, onClose }: { tickets: Ticket[]; onClose: () => void }) {
  const [runs, setRuns] = useState<AgentRun[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [status, setStatus] = useState<AgentRunStatus>("queued");
  const visibleRuns = runs.filter((run) => run.status === status);
  const refresh = async () => { setLoading(true); setError(""); try { setRuns(await loadAgentRuns()); } catch { setError("The agent queue could not be loaded."); } finally { setLoading(false); } };
  useEffect(() => { let active = true; loadAgentRuns().then((items) => { if (active) setRuns(items); }).catch(() => { if (active) setError("The agent queue could not be loaded."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="queue-dialog" role="dialog" aria-modal="true" aria-labelledby="queue-title" onMouseDown={(event) => event.stopPropagation()}>
    <header className="queue-header"><div><span><ListTodo size={19}/></span><div><p className="eyebrow">Agents</p><h2 id="queue-title">Run queue</h2></div></div><div><label className="queue-filter"><span className="sr-only">Filter runs by status</span><select value={status} onChange={(event) => setStatus(event.target.value as AgentRunStatus)}><option value="queued">Queued</option><option value="in_progress">In progress</option><option value="finished">Finished</option></select></label><button className="icon-button" onClick={() => void refresh()} aria-label="Refresh queue"><RefreshCw size={17}/></button><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></div></header>
    <div className="queue-body">{error && <div className="error-banner">{error}</div>}{loading ? <p className="queue-empty">Loading queue…</p> : visibleRuns.length === 0 ? <p className="queue-empty">No {status.replace("_", " ")} agent runs.</p> : <div className="queue-list">{visibleRuns.map((run) => { const ticket = tickets.find((item) => item.id === run.ticketId); return <article key={run.id}><span className={`queue-status ${run.status}`}>{run.status.replace("_", " ")}</span><div><strong>{ticket?.title ?? "Deleted work item"}</strong><p><Bot size={12}/>{run.agentName} · {run.column}</p></div><time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString()}</time>{run.error && <small>{run.error}</small>}</article>; })}</div>}</div>
  </section></div>;
}
