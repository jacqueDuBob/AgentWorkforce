import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = url && key ? createClient(url, key) : null;

if (process.env.NODE_ENV === "development" && (!url || !key)) {
  console.info("Flowboard is using local browser storage. Add the Supabase environment values to enable sync.");
}

export async function ensureSupabaseSession() {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session || session.user.is_anonymous) throw new Error("You must sign in to access the board.");
  return session;
}
