"use client";

import { useEffect, useMemo, useState } from "react";
import { DndContext, DragEndEvent, DragStartEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import clsx from "clsx";
import type { BoardState, Card, ReviewFinding, StageId, TransitionPolicy, TransitionPolicyMode } from "@/lib/domain/types";

const stageOrder: StageId[] = [
  "inbox",
  "classification",
  "refinement",
  "planning",
  "development",
  "code_review",
  "testing",
  "human_approval",
  "merge",
  "done",
];

type LoadState = "idle" | "loading" | "ready" | "error";

function unresolvedCount(snapshot: BoardState, cardId: string): number {
  return snapshot.reviewFindings.filter((finding) => finding.cardId === cardId && finding.status === "open").length;
}

function latestTestPass(snapshot: BoardState, cardId: string): boolean {
  const latest = [...snapshot.testRuns].reverse().find((run) => run.cardId === cardId);
  return Boolean(latest?.mandatoryChecksPassed);
}

function hasMergeApproval(snapshot: BoardState, cardId: string): boolean {
  return snapshot.approvals.some((approval) => approval.cardId === cardId && approval.kind === "merge" && approval.approved);
}

function policyAllows(
  snapshot: BoardState,
  card: Card,
  toStageId: StageId,
  modeOverride?: TransitionPolicyMode,
): { allowed: boolean; reason: string; policy?: TransitionPolicy } {
  const policy = snapshot.policies.find((item) => item.fromStageId === card.stageId && item.toStageId === toStageId);
  if (!policy) {
    return { allowed: false, reason: "No policy configured." };
  }

  const mode = modeOverride ?? policy.mode;
  const unresolved = unresolvedCount(snapshot, card.id);

  switch (policy.condition.kind) {
    case "always":
      return { allowed: true, reason: `${mode} policy`, policy };
    case "unresolved_findings_and_loop_available":
      if (unresolved === 0) {
        return { allowed: false, reason: "No unresolved findings.", policy };
      }
      if (card.autoReviewLoopCount < 3 || card.manualRemediationCredits > 0) {
        return { allowed: true, reason: "Remediation allowed.", policy };
      }
      return { allowed: false, reason: "Manual remediation approval required.", policy };
    case "zero_unresolved_findings":
      return unresolved === 0
        ? { allowed: true, reason: "No unresolved findings.", policy }
        : { allowed: false, reason: "Unresolved findings block testing.", policy };
    case "all_mandatory_checks_pass":
      return latestTestPass(snapshot, card.id)
        ? { allowed: true, reason: "Mandatory checks passed.", policy }
        : { allowed: false, reason: "Mandatory checks are not passing.", policy };
    case "merge_approval_recorded":
      return hasMergeApproval(snapshot, card.id)
        ? { allowed: true, reason: "Merge approval recorded.", policy }
        : { allowed: false, reason: "Merge approval required.", policy };
    default:
      return { allowed: false, reason: "Unknown condition.", policy };
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json()) as T | { error: string };
  if (!response.ok) {
    throw new Error((payload as { error: string }).error ?? "Request failed.");
  }

  return payload as T;
}

function DraggableCard(props: {
  card: Card;
  selected: boolean;
  onSelect: (cardId: string) => void;
  unresolved: number;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: props.card.id, data: { type: "card" } });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <button
      ref={setNodeRef}
      style={style}
      type="button"
      className={clsx("card", props.selected && "selected", isDragging && "dragging")}
      onClick={() => props.onSelect(props.card.id)}
      {...listeners}
      {...attributes}
    >
      <div className="card-topline">
        <strong>{props.card.title}</strong>
      </div>
      <p>{props.card.description.slice(0, 120)}</p>
      <div className="chip-row">
        <span className="chip chip-risk">Risk {props.card.classification?.risk ?? "n/a"}</span>
        <span className="chip chip-type">{props.card.classification?.taskType ?? "unclassified"}</span>
      </div>
      <div className="meta-row">
        <span>Loops {props.card.autoReviewLoopCount}/3</span>
        <span>Unresolved {props.unresolved}</span>
      </div>
    </button>
  );
}

function StageColumn(props: {
  stageId: StageId;
  label: string;
  cards: Card[];
  selectedCardId: string | null;
  onSelectCard: (cardId: string) => void;
  activeCard: Card | null;
  canDrop: (card: Card, target: StageId) => boolean;
  snapshot: BoardState;
}) {
  const disabled = props.activeCard ? !props.canDrop(props.activeCard, props.stageId) : false;
  const { setNodeRef, isOver } = useDroppable({ id: props.stageId, disabled });

  return (
    <section ref={setNodeRef} className={clsx("column", isOver && !disabled && "drop-ok", isOver && disabled && "drop-no")}> 
      <header>
        <h3>{props.label}</h3>
        <span>{props.cards.length}</span>
      </header>
      <div className="column-body">
        {props.cards.map((card) => (
          <DraggableCard
            key={card.id}
            card={card}
            selected={props.selectedCardId === card.id}
            onSelect={props.onSelectCard}
            unresolved={unresolvedCount(props.snapshot, card.id)}
          />
        ))}
      </div>
    </section>
  );
}

function FindingsTable(props: {
  findings: ReviewFinding[];
  onDismiss: (findingId: string) => void;
}) {
  if (props.findings.length === 0) {
    return <p className="empty">No findings recorded yet.</p>;
  }

  return (
    <div className="table-like">
      {props.findings.map((finding) => (
        <div key={finding.id} className="finding-row">
          <div>
            <strong>{finding.title}</strong>
            <p>{finding.description}</p>
            <small>
              {finding.severity} | {finding.category} | {finding.filePath ?? "n/a"}
              {finding.lineNumber ? `:${finding.lineNumber}` : ""}
            </small>
          </div>
          <div className="finding-actions">
            <span className={clsx("status", `status-${finding.status}`)}>{finding.status}</span>
            {finding.status === "open" ? (
              <button type="button" onClick={() => props.onDismiss(finding.id)}>
                Dismiss
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AgentBoard() {
  const [snapshot, setSnapshot] = useState<BoardState | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createForm, setCreateForm] = useState({ title: "", description: "", repositoryId: "" });

  const load = async () => {
    try {
      const payload = await requestJson<BoardState>("/api/board");
      setSnapshot(payload);
      setState("ready");
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load board.");
      setState("error");
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedCardId) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedCardId(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedCardId]);

  const selectedCard = useMemo(() => snapshot?.cards.find((card) => card.id === selectedCardId) ?? null, [snapshot, selectedCardId]);

  const cardsByStage = useMemo(() => {
    if (!snapshot) {
      return new Map<StageId, Card[]>();
    }
    const map = new Map<StageId, Card[]>();
    for (const stage of stageOrder) {
      map.set(stage, snapshot.cards.filter((card) => card.stageId === stage));
    }
    return map;
  }, [snapshot]);

  const canDrop = (card: Card, target: StageId) => {
    if (!snapshot || card.stageId === target) {
      return false;
    }
    return policyAllows(snapshot, card, target).allowed;
  };

  const mutateSnapshot = async (action: () => Promise<BoardState>) => {
    setSaving(true);
    try {
      const next = await action();
      setSnapshot(next);
      if (!next.cards.some((card) => card.id === selectedCardId)) {
        setSelectedCardId(null);
      }
      setError(null);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Action failed.");
    } finally {
      setSaving(false);
    }
  };

  const transition = async (cardId: string, targetStageId: StageId) => {
    await mutateSnapshot(() =>
      requestJson<BoardState>(`/api/cards/${cardId}/transition`, {
        method: "POST",
        body: JSON.stringify({
          targetStageId,
          idempotencyKey: `${cardId}-${targetStageId}-${Date.now()}`,
        }),
      }),
    );
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveCardId(String(event.active.id));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveCardId(null);
    if (!snapshot || !event.over) {
      return;
    }

    const cardId = String(event.active.id);
    const stageId = String(event.over.id) as StageId;
    const card = snapshot.cards.find((item) => item.id === cardId);
    if (!card) {
      return;
    }

    if (!canDrop(card, stageId)) {
      return;
    }

    void transition(cardId, stageId);
  };

  const createCard = async () => {
    await mutateSnapshot(async () => {
      await requestJson<{ card: Card }>("/api/cards", {
        method: "POST",
        body: JSON.stringify({
          title: createForm.title,
          description: createForm.description,
          repositoryId: createForm.repositoryId || null,
        }),
      });
      const board = await requestJson<BoardState>("/api/board");
      return board;
    });

    setCreateForm({ title: "", description: "", repositoryId: "" });
  };

  const saveCard = async () => {
    if (!selectedCard) {
      return;
    }

    await mutateSnapshot(async () => {
      await requestJson<{ card: Card }>(`/api/cards/${selectedCard.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: selectedCard.title,
          description: selectedCard.description,
          repositoryId: selectedCard.repositoryId,
          demoResolveFindingsOnAttempt: selectedCard.demoResolveFindingsOnAttempt,
        }),
      });
      return requestJson<BoardState>("/api/board");
    });
  };

  const updatePolicy = async (policyId: string, mode: TransitionPolicyMode) => {
    await mutateSnapshot(() =>
      requestJson<BoardState>(`/api/policies/${policyId}`, {
        method: "PATCH",
        body: JSON.stringify({ mode }),
      }),
    );
  };

  const approve = async (kind: "remediation" | "merge", justification: string) => {
    if (!selectedCard) {
      return;
    }

    await mutateSnapshot(() =>
      requestJson<BoardState>(`/api/cards/${selectedCard.id}/approvals`, {
        method: "POST",
        body: JSON.stringify({ kind, approved: true, justification }),
      }),
    );
  };

  const dismiss = async (findingId: string) => {
    if (!selectedCard) {
      return;
    }

    const justification = prompt("Dismissal justification");
    if (!justification) {
      return;
    }

    await mutateSnapshot(() =>
      requestJson<BoardState>(`/api/cards/${selectedCard.id}/findings`, {
        method: "PATCH",
        body: JSON.stringify({ findingId, justification }),
      }),
    );
  };

  if (state === "loading") {
    return <p className="status-line">Loading AgentBoard command center...</p>;
  }

  if (state === "error" || !snapshot) {
    return (
      <div className="status-shell">
        <p className="status-line">Failed to load board: {error}</p>
        <button type="button" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  const currentFindings = selectedCard
    ? snapshot.reviewFindings.filter((finding) => finding.cardId === selectedCard.id)
    : [];

  const currentRuns = selectedCard ? snapshot.agentRuns.filter((run) => run.cardId === selectedCard.id) : [];
  const currentArtifacts = selectedCard ? snapshot.artifacts.filter((artifact) => artifact.cardId === selectedCard.id) : [];
  const currentApprovals = selectedCard ? snapshot.approvals.filter((approval) => approval.cardId === selectedCard.id) : [];
  const currentTransitions = selectedCard ? snapshot.transitions.filter((transitionItem) => transitionItem.cardId === selectedCard.id) : [];
  const currentGitHubOps = selectedCard
    ? snapshot.githubOperations.filter((operation) => operation.cardId === selectedCard.id)
    : [];
  const currentTests = selectedCard ? snapshot.testRuns.filter((testRun) => testRun.cardId === selectedCard.id) : [];

  const handleSelectCard = (cardId: string) => {
    setSelectedCardId((prev) => (prev === cardId ? null : cardId));
  };

  const activeCard = activeCardId ? snapshot.cards.find((card) => card.id === activeCardId) ?? null : null;

  return (
    <div className="shell">
      <div className="topbar">
        <div>
          <h1>AgentBoard</h1>
          <p>Single-user AI workforce Kanban command center</p>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={() => void requestJson<BoardState>("/api/board", { method: "POST" }).then(setSnapshot)}>
            Reset Demo Data
          </button>
          <span className="mode-badge">Demo Mode</span>
        </div>
      </div>

      <div className="create-panel">
        <input
          placeholder="New task title"
          value={createForm.title}
          onChange={(event) => setCreateForm((prev) => ({ ...prev, title: event.target.value }))}
        />
        <textarea
          placeholder="Task description"
          value={createForm.description}
          onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.target.value }))}
        />
        <select
          value={createForm.repositoryId}
          onChange={(event) => setCreateForm((prev) => ({ ...prev, repositoryId: event.target.value }))}
        >
          <option value="">No repository</option>
          {snapshot.repositories.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.fullName}
            </option>
          ))}
        </select>
        <button type="button" disabled={saving} onClick={() => void createCard()}>
          Create Card
        </button>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      <DndContext onDragEnd={onDragEnd} onDragStart={onDragStart}>
        <main className="layout">
          <section className="board">
            {snapshot.stages
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((stage) => (
                <StageColumn
                  key={stage.id}
                  stageId={stage.id}
                  label={stage.label}
                  cards={cardsByStage.get(stage.id) ?? []}
                  selectedCardId={selectedCardId}
                  onSelectCard={handleSelectCard}
                  activeCard={activeCard}
                  canDrop={canDrop}
                  snapshot={snapshot}
                />
              ))}
          </section>

          {selectedCard ? (
            <>
              <button
                type="button"
                className="detail-backdrop"
                aria-label="Close card detail"
                onClick={() => setSelectedCardId(null)}
              />
              <aside className="detail detail-overlay" role="dialog" aria-modal="false" aria-label="Card detail">
                <div className="detail-header">
                  <h2>Card Detail</h2>
                  <button type="button" onClick={() => setSelectedCardId(null)}>
                    Close
                  </button>
                </div>

                <label>
                  Title
                  <input
                    value={selectedCard.title}
                    onChange={(event) => {
                      setSnapshot((prev) => {
                        if (!prev) {
                          return prev;
                        }
                        return {
                          ...prev,
                          cards: prev.cards.map((card) =>
                            card.id === selectedCard.id ? { ...card, title: event.target.value } : card,
                          ),
                        };
                      });
                    }}
                  />
                </label>
                <label>
                  Description
                  <textarea
                    value={selectedCard.description}
                    onChange={(event) => {
                      setSnapshot((prev) => {
                        if (!prev) {
                          return prev;
                        }
                        return {
                          ...prev,
                          cards: prev.cards.map((card) =>
                            card.id === selectedCard.id ? { ...card, description: event.target.value } : card,
                          ),
                        };
                      });
                    }}
                  />
                </label>
                <label>
                  Repository
                  <select
                    value={selectedCard.repositoryId ?? ""}
                    onChange={(event) => {
                      setSnapshot((prev) => {
                        if (!prev) {
                          return prev;
                        }
                        return {
                          ...prev,
                          cards: prev.cards.map((card) =>
                            card.id === selectedCard.id
                              ? { ...card, repositoryId: event.target.value || null }
                              : card,
                          ),
                        };
                      });
                    }}
                  >
                    <option value="">No repository</option>
                    {snapshot.repositories.map((repo) => (
                      <option key={repo.id} value={repo.id}>
                        {repo.fullName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Demo Resolve Attempt
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={selectedCard.demoResolveFindingsOnAttempt}
                    onChange={(event) => {
                      const next = Number(event.target.value || "1");
                      setSnapshot((prev) => {
                        if (!prev) {
                          return prev;
                        }
                        return {
                          ...prev,
                          cards: prev.cards.map((card) =>
                            card.id === selectedCard.id
                              ? { ...card, demoResolveFindingsOnAttempt: next }
                              : card,
                          ),
                        };
                      });
                    }}
                  />
                </label>

                <div className="meta-list">
                  <span>Stage: {selectedCard.stageId}</span>
                  <span>Review cycles: {selectedCard.reviewCycleCount}</span>
                  <span>Auto loops: {selectedCard.autoReviewLoopCount}/3</span>
                  <span>Manual credits: {selectedCard.manualRemediationCredits}</span>
                  <span>Token usage: {selectedCard.tokenUsage}</span>
                  <span>Estimated cost: ${selectedCard.estimatedCostUsd.toFixed(4)}</span>
                  {selectedCard.blockedReason ? <span className="blocked">Blocked: {selectedCard.blockedReason}</span> : null}
                </div>

                <div className="row-actions">
                  <button type="button" disabled={saving} onClick={() => void saveCard()}>
                    Save Card
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      void mutateSnapshot(() =>
                        requestJson<BoardState>(`/api/cards/${selectedCard.id}/classify`, {
                          method: "POST",
                        }),
                      )
                    }
                  >
                    Classify
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      void mutateSnapshot(() =>
                        requestJson<BoardState>(`/api/cards/${selectedCard.id}/merge`, {
                          method: "POST",
                        }),
                      )
                    }
                  >
                    Merge via GitHub
                  </button>
                  {stageOrder
                    .filter((stage) => stage !== selectedCard.stageId)
                    .map((stage) => {
                      const check = policyAllows(snapshot, selectedCard, stage);
                      return (
                        <button
                          key={stage}
                          type="button"
                          disabled={!check.allowed || saving}
                          title={check.reason}
                          onClick={() => void transition(selectedCard.id, stage)}
                        >
                          Move to {stage}
                        </button>
                      );
                    })}
                </div>

                <div className="row-actions">
                  <button type="button" onClick={() => void approve("remediation", "Approved one extra remediation attempt")}>
                    Approve Remediation Attempt
                  </button>
                  <button type="button" onClick={() => void approve("merge", "Approved merge after test evidence review")}>
                    Approve Merge
                  </button>
                </div>

                <section>
                  <h3>Transition Policies</h3>
                  <div className="table-like">
                    {snapshot.policies.map((policy) => (
                      <div key={policy.id} className="policy-row">
                        <span>
                          {policy.fromStageId} → {policy.toStageId}
                        </span>
                        <select
                          value={policy.mode}
                          onChange={(event) => void updatePolicy(policy.id, event.target.value as TransitionPolicyMode)}
                        >
                          <option value="automatic">Automatic</option>
                          <option value="manual">Manual</option>
                          <option value="conditional">Conditional</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h3>Review Findings</h3>
                  <FindingsTable findings={currentFindings} onDismiss={dismiss} />
                </section>

                <section>
                  <h3>Run History</h3>
                  <div className="table-like">
                    {currentRuns.length === 0 ? (
                      <p className="empty">No run history yet.</p>
                    ) : (
                      currentRuns.map((run) => (
                        <div key={run.id} className="run-row">
                          <span>
                            {run.role} @ {run.stageId} cycle {run.cycleNumber}
                          </span>
                          <small>
                            tokens {run.tokenUsage} | cost ${run.estimatedCostUsd.toFixed(4)}
                          </small>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section>
                  <h3>Artifacts</h3>
                  <div className="table-like">
                    {currentArtifacts.length === 0 ? (
                      <p className="empty">No artifacts yet.</p>
                    ) : (
                      currentArtifacts.map((artifact) => (
                        <a key={artifact.id} href={artifact.url} target="_blank" rel="noreferrer" className="artifact-link">
                          {artifact.type}: {artifact.label}
                        </a>
                      ))
                    )}
                  </div>
                </section>

                <section>
                  <h3>Test Evidence</h3>
                  <div className="table-like">
                    {currentTests.length === 0 ? (
                      <p className="empty">No tests recorded.</p>
                    ) : (
                      currentTests.map((testRun) => (
                        <div key={testRun.id} className="run-row">
                          <span>
                            cycle {testRun.cycleNumber} | {testRun.status}
                          </span>
                          <small>{testRun.evidence}</small>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section>
                  <h3>GitHub Operations</h3>
                  <div className="table-like">
                    {currentGitHubOps.length === 0 ? (
                      <p className="empty">No GitHub operations recorded.</p>
                    ) : (
                      currentGitHubOps.map((operation) => (
                        <div key={operation.id} className="run-row">
                          <span>
                            {operation.operationType} | {operation.status}
                          </span>
                          <small>{JSON.stringify(operation.metadata)}</small>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section>
                  <h3>Approvals</h3>
                  <div className="table-like">
                    {currentApprovals.length === 0 ? (
                      <p className="empty">No approvals recorded.</p>
                    ) : (
                      currentApprovals.map((approval) => (
                        <div key={approval.id} className="approval-row">
                          <span>
                            {approval.kind} | {approval.approved ? "approved" : "rejected"}
                          </span>
                          <small>{approval.justification}</small>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section>
                  <h3>Workflow Timeline</h3>
                  <div className="table-like">
                    {currentTransitions.length === 0 ? (
                      <p className="empty">No transitions yet.</p>
                    ) : (
                      currentTransitions
                        .slice()
                        .reverse()
                        .map((transitionItem) => (
                          <div key={transitionItem.id} className="timeline-row">
                            <span>
                              {transitionItem.fromStageId} → {transitionItem.toStageId}
                            </span>
                            <small>
                              {transitionItem.decision} | {transitionItem.reason}
                            </small>
                          </div>
                        ))
                    )}
                  </div>
                </section>
              </aside>
            </>
          ) : null}
        </main>
      </DndContext>
    </div>
  );
}
