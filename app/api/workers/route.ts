import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { hashWorkerToken } from "@/lib/worker-auth";

async function authenticatedUser(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!accessToken) return null;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user;
}

export async function POST(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const body = await request.json().catch(() => ({})) as { name?: string };
    const name = body.name?.trim() || "Local Codex worker";
    if (name.length > 80) return NextResponse.json({ error: "Worker name is too long." }, { status: 400 });

    const token = `fwk_${randomBytes(32).toString("base64url")}`;
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("local_codex_workers")
      .insert({ user_id: user.id, name, token_hash: hashWorkerToken(token) })
      .select("id,name,created_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ worker: data, token });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not create the worker.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
