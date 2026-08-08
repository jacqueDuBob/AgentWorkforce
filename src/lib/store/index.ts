import { getEnv } from "@/lib/server/env";
import { DemoStore } from "@/lib/store/demo-store";
import { SupabaseBoardStore } from "@/lib/store/supabase-board-store";
import type { BoardStore } from "@/lib/store/board-store";

declare global {
  var __agentboardStore: BoardStore | undefined;
}

export function getStore(): BoardStore {
  if (!globalThis.__agentboardStore) {
    const env = getEnv();
    if (!env.demoMode && env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      globalThis.__agentboardStore = new SupabaseBoardStore(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    } else {
      globalThis.__agentboardStore = new DemoStore();
    }
  }

  return globalThis.__agentboardStore;
}
