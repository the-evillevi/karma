import test from "node:test";
import assert from "node:assert/strict";
import {
  captureCommandBatch,
  createDemoOrderBatch,
  type OfflineCommandBatch,
} from "./command-sync.ts";

test("local command capture commits once, accepts an identical retry and rejects changed content", async () => {
  const collection = memoryCollection<OfflineCommandBatch>();
  const database = { commandBatches: collection } as unknown as Parameters<
    typeof captureCommandBatch
  >[0];
  const batch = createDemoOrderBatch({
    branchId: "branch-test",
    actorId: "actor-test",
    deviceId: "device-test",
    leaseId: "lease-test",
    commandId: "command-test",
    occurredAt: "2026-09-29T12:00:00.000Z",
  });

  assert.equal((await captureCommandBatch(database, batch)).duplicate, false);
  assert.equal((await captureCommandBatch(database, batch)).duplicate, true);
  assert.equal(collection.size, 1);

  const altered: OfflineCommandBatch = {
    ...batch,
    events: batch.events.map((event) => ({
      ...event,
      payload: { ...event.payload, changed: true },
    })),
  };
  await assert.rejects(
    captureCommandBatch(database, altered),
    /reused with different content/,
  );
  assert.equal(collection.size, 1);
});

test("a local persistence failure leaves no partial command and permits a later retry", async () => {
  const collection = memoryCollection<OfflineCommandBatch>();
  const database = { commandBatches: collection } as unknown as Parameters<
    typeof captureCommandBatch
  >[0];
  const batch = createDemoOrderBatch({
    branchId: "branch-test",
    actorId: "actor-test",
    deviceId: "device-test",
    leaseId: "lease-test",
    commandId: "command-retry",
  });

  await assert.rejects(
    captureCommandBatch(database, batch, {
      beforeLocalInsert: async () => {
        throw new Error("synthetic storage failure");
      },
    }),
    /synthetic storage failure/,
  );
  assert.equal(collection.size, 0);
  assert.equal((await captureCommandBatch(database, batch)).duplicate, false);
  assert.equal(collection.size, 1);
});

function memoryCollection<T extends { commandId: string }>() {
  const documents = new Map<string, { toJSON(): T }>();
  return {
    get size(): number {
      return documents.size;
    },
    findOne(id: string) {
      return { exec: async () => documents.get(id) ?? null };
    },
    find() {
      const query = {
        exec: async () => [...documents.values()],
        sort: () => query,
      };
      return query;
    },
    async insert(value: T) {
      if (documents.has(value.commandId))
        throw new Error("duplicate primary key");
      const document = { toJSON: () => structuredClone(value) };
      documents.set(value.commandId, document);
      return document;
    },
  };
}
