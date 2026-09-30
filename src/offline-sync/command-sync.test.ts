import test from "node:test";
import assert from "node:assert/strict";
import {
  captureCommandBatch,
  createDemoOrderBatch,
  syncPendingCommandBatches,
  type SyncBlock,
  type SyncReceipt,
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

test("secure sync uses the actor-bound RPC and keeps session rebinding out of the immutable batch", async () => {
  const batch = createDemoOrderBatch({
    branchId: "branch-test",
    actorId: "actor-test",
    deviceId: "device-test",
    leaseId: "lease-test",
    commandId: "command-secure",
  });
  const database = await syncDatabase([batch]);
  const retryDatabase = await syncDatabase([batch]);
  const calls: Array<{ sessionId: string; args: Record<string, unknown> }> = [];
  const accepted = new Map<string, string>();
  const client = {
    rpc: async (_functionName: string, args: Record<string, unknown>) => {
      calls.push({ sessionId: args.p_session_id as string, args });
      const commandId = args.p_command_id as string;
      const receivedAt = accepted.get(commandId) ?? new Date().toISOString();
      accepted.set(commandId, receivedAt);
      return {
        data: [{ command_id: commandId, received_at: receivedAt }],
        error: null,
      };
    },
  };

  const first = await syncPendingCommandBatches(database, client, {
    sessionId: "session-before-rebind",
  });
  const retry = await syncPendingCommandBatches(retryDatabase, client, {
    sessionId: "session-after-rebind",
  });

  assert.equal(first[0]?.state, "acknowledged");
  assert.equal(retry[0]?.state, "acknowledged");
  assert.deepEqual(
    calls.map((call) => call.sessionId),
    ["session-before-rebind", "session-after-rebind"],
  );
  assert.deepEqual(calls[0]?.args.p_events, batch.events);
  assert.equal(calls[0]?.args.p_command_id, batch.commandId);
  assert.equal(calls[0]?.args.p_session_id, "session-before-rebind");
  assert.equal(calls[1]?.args.p_session_id, "session-after-rebind");
  assert.equal(accepted.size, 1);
  assert.equal(database.receipts.size, 1);
  assert.equal(retryDatabase.receipts.size, 1);
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

async function syncDatabase(batches: OfflineCommandBatch[]) {
  const commandBatches = memoryCollection<OfflineCommandBatch>();
  const syncReceipts = memoryCollection<SyncReceipt>();
  const syncBlocks = memoryCollection<SyncBlock>();
  for (const batch of batches) await commandBatches.insert(batch);
  return {
    commandBatches,
    syncReceipts,
    syncBlocks,
    receipts: syncReceipts,
  } as unknown as Parameters<typeof syncPendingCommandBatches>[0] & {
    receipts: typeof syncReceipts;
  };
}
