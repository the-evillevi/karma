// @vitest-environment node
import { randomUUID } from "node:crypto";
import { addRxPlugin } from "rxdb";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";
import { afterEach, expect, it, vi } from "vitest";
import { PosStore } from "./pos-store.ts";
import { saveOrder } from "../domain/commands.ts";
import { replay } from "../domain/journal.ts";
import { americano, linesOf, luis, mesa, meta } from "../domain/testing.ts";
import { createRxdbStorage } from "./rxdb-storage.ts";
import type { RxdbJournalStorage } from "./rxdb-storage.ts";
import { describeJournalStorage } from "./storage-contract.ts";

addRxPlugin(RxDBDevModePlugin);

const instances = new Set<RxdbJournalStorage>();

it("concurrent appends replay in the order they were applied live", async () => {
  vi.stubGlobal("navigator", undefined);
  const name = `ordered${randomUUID().replaceAll("-", "")}`;
  const engine = wrappedValidateAjvStorage({ storage: getRxStorageMemory() });
  const a = await createRxdbStorage({ name, storage: engine });
  const b = await createRxdbStorage({
    name,
    storage: engine,
    ignoreDuplicate: true,
  });
  instances.add(a);
  instances.add(b);
  const left = await PosStore.open(a);
  const right = await PosStore.open(b);
  try {
    await left.run((state) =>
      saveOrder(state, meta("seed", luis), {
        orderId: "o",
        header: mesa(3),
        lines: linesOf([americano]),
      }),
    );
    await Promise.all([
      left.run((state) =>
        saveOrder(state, meta("z", luis), {
          orderId: "o",
          header: mesa(3),
          lines: linesOf([americano, 2]),
        }),
      ),
      right.run((state) =>
        saveOrder(state, meta("a", luis), {
          orderId: "o",
          header: mesa(3),
          lines: linesOf([americano, 3]),
        }),
      ),
    ]);
    const loaded = await a.load();
    expect(loaded.map((batch) => batch.commandId)).toEqual(["seed", "z", "a"]);
    await vi.waitFor(() => expect(right.getState()).toEqual(left.getState()));
    expect(replay(loaded)).toEqual(left.getState());
    expect(replay(loaded)).toEqual(right.getState());
  } finally {
    left.close();
    right.close();
    vi.unstubAllGlobals();
  }
});

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
