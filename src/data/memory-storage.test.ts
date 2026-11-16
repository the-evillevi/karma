// @vitest-environment node
import { createMemoryStorage } from "./pos-store.ts";
import { describeJournalStorage } from "./storage-contract.ts";

describeJournalStorage("memory", async () => {
  const storage = createMemoryStorage();
  return {
    storage,
    reopen: async () => storage,
    secondTab: async () => storage,
    cleanup: async () => {},
  };
});
