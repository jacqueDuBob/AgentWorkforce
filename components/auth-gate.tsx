"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowRight, CheckCircle2, LayoutGrid, LockKeyhole, Mail } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { KanbanBoard } from "./kanban-board";

type AuthMode = "signin" | "signup" | "forgot" | "recovery";

const copy = {
  signin: { eyebrow: "Welcome back", title: "Sign in to Flowboard", description: "Pick up your work exactly where you left it.", action: "Sign in" },
  signup: { eyebrow: "Create your workspace", title: "Start moving work forward", description: "Create an account to keep your board private and synced.", action: "Create account" },
  forgot: { eyebrow: "Password recovery", title: "Reset your password", description: "We’ll email you a secure link to choose a new password.", action: "Send reset link" },
  recovery: { eyebrow: "Choose a new password", title: "Secure your account", description: "Enter a new password with at least eight characters.", action: "Update password" },
};

function AuthScreen({ recovery, onRecovered }: { recovery: boolean; onRecovered: () => void }) {
  const [mode, setMode] = useState<AuthMode>(recovery ? "recovery" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const content = copy[mode];

  const changeMode = (next: AuthMode) => { setMode(next); setError(""); setMessage(""); setPassword(""); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "signin") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
      } else if (mode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (authError) throw authError;
        if (!data.session) setMessage("Check your inbox to confirm your email, then return here to sign in.");
      } else if (mode === "forgot") {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (authError) throw authError;
        setMessage("Password reset link sent. Check your inbox.");
      } else {
        const { error: authError } = await supabase.auth.updateUser({ password });
        if (authError) throw authError;
        setMessage("Password updated successfully.");
        onRecovered();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  };

  return <main className="auth-page"><section className="auth-brand-panel"><div className="auth-brand"><span><LayoutGrid size={21}/></span>Flowboard</div><div><p className="eyebrow">A calmer way to deliver</p><h1>From first thought<br/>to live.</h1><p>Keep every piece of work visible, focused, and moving in the right direction.</p></div><p className="auth-footnote">A private workspace for focused teams.</p></section><section className="auth-form-panel"><div className="auth-card"><p className="eyebrow">{content.eyebrow}</p><h2>{content.title}</h2><p className="auth-description">{content.description}</p>{message ? <div className="auth-success"><CheckCircle2 size={19}/><span>{message}</span></div> : <form onSubmit={submit}>{mode !== "recovery" && <label>Email address<div className="auth-input"><Mail size={17}/><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com"/></div></label>}{mode !== "forgot" && <label>{mode === "recovery" ? "New password" : "Password"}<div className="auth-input"><LockKeyhole size={17}/><input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters"/></div></label>}{error && <div className="auth-error" role="alert">{error}</div>}<button className="button primary auth-submit" disabled={busy}>{busy ? "Please wait…" : content.action}<ArrowRight size={17}/></button></form>}{mode === "signin" && <><button className="text-button forgot-link" onClick={() => changeMode("forgot")}>Forgot your password?</button><p className="auth-switch">New to Flowboard? <button onClick={() => changeMode("signup")}>Create an account</button></p></>}{mode === "signup" && <p className="auth-switch">Already have an account? <button onClick={() => changeMode("signin")}>Sign in</button></p>}{mode === "forgot" && <button className="text-button back-link" onClick={() => changeMode("signin")}>Back to sign in</button>}{message && mode !== "recovery" && <button className="text-button back-link" onClick={() => changeMode("signin")}>Back to sign in</button>}</div></section></main>;
}

export function AuthGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    client.auth.getSession().then(async ({ data }) => {
      if (data.session?.user.is_anonymous) await client.auth.signOut();
      else setSession(data.session);
    }).finally(() => setLoading(false));
    const { data: listener } = client.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") { setRecovery(true); setSession(null); }
      else if (!nextSession?.user.is_anonymous) setSession(nextSession);
      setLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (loading) return <main className="auth-loading"><span><LayoutGrid size={20}/></span><p>Opening your workspace…</p></main>;
  if (!supabase) return <main className="auth-loading"><span><LayoutGrid size={20}/></span><h1>Connect Supabase to continue</h1><p>Add the Supabase URL and publishable key to your environment, then restart the app.</p></main>;
  if (!session || recovery) return <AuthScreen recovery={recovery} onRecovered={() => setRecovery(false)}/>;
  const client = supabase;
  return <KanbanBoard key={session.user.id} userEmail={session.user.email ?? "User"} onSignOut={() => client.auth.signOut()}/>;
}
