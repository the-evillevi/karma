// @vitest-environment node
import { randomUUID } from "node:crypto";
import { addRxPlugin } from "rxdb";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";
import { afterEach } from "vitest";
import { createRxdbStorage } from "./rxdb-storage.ts";
import type { RxdbJournalStorage } from "./rxdb-storage.ts";
import { describeJournalStorage } from "./storage-contract.ts";

addRxPlugin(RxDBDevModePlugin);

const instances = new Set<RxdbJournalStorage>();

afterEach(async () => {
  await Promise.all([...instances].map((instance) => instance.close()));
  instances.clear();
});

describeJournalStorage("rxdb (memory engine)", async () => {
  const name = `journal${randomUUID().replaceAll("-", "")}`;
  const engine = wrappedValidateAjvStorage({ storage: getRxStorageMemory() });
  const opened: RxdbJournalStorage[] = [];
  async function open(ignoreDuplicate = false) {
    const instance = await createRxdbStorage({
      name,
      storage: engine,
      ignoreDuplicate,
    });
    opened.push(instance);
    instances.add(instance);
    return instance;
  }
  const storage = await open();
  return {
    storage,
    reopen: async () => {
      await storage.close();
      return open();
    },
    secondTab: () => open(true),
    cleanup: async () => {
      await Promise.all(opened.map((instance) => instance.close()));
      for (const instance of opened) instances.delete(instance);
    },
  };
});
