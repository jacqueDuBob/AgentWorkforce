import { DemoStore } from "@/lib/store/demo-store";

declare global {
  var __agentboardStore: DemoStore | undefined;
}

export function getStore(): DemoStore {
  if (!globalThis.__agentboardStore) {
    globalThis.__agentboardStore = new DemoStore();
  }

  return globalThis.__agentboardStore;
}
