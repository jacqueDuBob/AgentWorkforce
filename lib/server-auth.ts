import "server-only";

import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./supabase-admin";

export async function authenticatedUser(request: Request): Promise<User | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!accessToken) return null;
  const { data, error } = await getSupabaseAdmin().auth.getUser(accessToken);
  return error ? null : data.user;
}
