import "server-only";

import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "./supabase-admin";

export const hashWorkerToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function authenticateWorker(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!/^fwk_[A-Za-z0-9_-]{40,}$/.test(token)) return null;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("local_codex_workers")
    .select("id,user_id,name")
    .eq("token_hash", hashWorkerToken(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}
