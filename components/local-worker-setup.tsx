"use client";

import { useState } from "react";
import { Check, Copy, Laptop, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

export function LocalWorkerSetup({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("My Mac");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "https://your-app.vercel.app" : window.location.origin;
  const command = `FLOWBOARD_URL=${JSON.stringify(origin)} \\\n+FLOWBOARD_WORKER_TOKEN=${JSON.stringify(token || "paste-token-here")} \\\n+FLOWBOARD_REPOSITORIES='{"owner/repository":"/absolute/path/to/repository"}' \\\n+npm run worker`;

  const create = async () => {
    setBusy(true); setError("");
    try {
      const session = await supabase?.auth.getSession();
      const accessToken = session?.data.session?.access_token;
      if (!accessToken) throw new Error("Your session has expired. Sign in again.");
      const response = await fetch("/api/workers", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await response.json() as { token?: string; error?: string };
      if (!response.ok || !result.token) throw new Error(result.error || "Could not create a worker token.");
      setToken(result.token);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the worker."); }
    finally { setBusy(false); }
  };

  const copy = async () => { await navigator.clipboard.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return <div className="modal-backdrop" onMouseDown={onClose} role="presentation"><section className="worker-modal" role="dialog" aria-modal="true" aria-labelledby="worker-title" onMouseDown={(event) => event.stopPropagation()}>
    <div className="modal-header"><div><p className="eyebrow">Codex SDK</p><h2 id="worker-title">Connect a local worker</h2><p>The worker polls Flowboard and runs Codex inside repositories on this computer.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></div>
    {!token ? <><label className="worker-name">Computer name<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>{error && <div className="auth-error">{error}</div>}<button className="button primary" disabled={busy || !name.trim()} onClick={() => void create()}><Laptop size={16}/>{busy ? "Creating…" : "Create worker token"}</button></> : <>
      <div className="worker-warning"><strong>Copy this command now.</strong><span>The token is shown once and cannot be recovered later.</span></div>
      <pre className="worker-command"><code>{command}</code></pre>
      <button className="button secondary" onClick={() => void copy()}>{copied ? <Check size={16}/> : <Copy size={16}/>} {copied ? "Copied" : "Copy startup command"}</button>
    </>}
  </section></div>;
}
