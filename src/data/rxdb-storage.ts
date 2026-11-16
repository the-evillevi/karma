import { createRxDatabase, RxError } from "rxdb";
import type { RxCollection, RxJsonSchema, RxStorage } from "rxdb";
import type { CommandBatch } from "../domain/journal.ts";
import type { JournalStorage } from "./pos-store.ts";

export type RxdbJournalStorage = JournalStorage & { close(): Promise<void> };

type BatchDocument = {
  commandId: string;
  seq: number;
  at: string;
  batch: CommandBatch;
};

const queues = new Map<string, Promise<void>>();

async function exclusive<T>(name: string, task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return await navigator.locks.request(`karma-journal:${name}`, task);
  }
  const result = (queues.get(name) ?? Promise.resolve()).then(task);
  const settled = result.then(
    () => {},
    () => {},
  );
  queues.set(name, settled);
  void settled.then(() => {
    if (queues.get(name) === settled) queues.delete(name);
  });
  return result;
}

const schema: RxJsonSchema<BatchDocument> = {
  version: 0,
  primaryKey: "commandId",
  type: "object",
  properties: {
    commandId: { type: "string", maxLength: 100 },
    seq: {
      type: "integer",
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      multipleOf: 1,
    },
    at: { type: "string" },
    batch: { type: "object", additionalProperties: true },
  },
  required: ["commandId", "seq", "at", "batch"],
  indexes: ["seq"],
};

export async function createRxdbStorage(options: {
  name: string;
  storage: RxStorage<unknown, unknown>;
  /** Only for test connections sharing a name in one process. */
  ignoreDuplicate?: boolean;
}): Promise<RxdbJournalStorage> {
  const database = await createRxDatabase<
    { command_batches: RxCollection<BatchDocument> },
    unknown,
    unknown
  >({ ...options, multiInstance: true });
  try {
    await database.addCollections({ command_batches: { schema } });
  } catch (error) {
    await database.close();
    throw error;
  }
  const collection = database.command_batches;
  return {
    exclusive: (task) => exclusive(options.name, task),
    load: async () => {
      const documents = await collection
        .find({ selector: {}, sort: [{ seq: "asc" }] })
        .exec();
      return documents.map((document) => document.toMutableJSON().batch);
    },
    append: async (batch) => {
      const snapshot = structuredClone(batch);
      if (await collection.findOne(snapshot.commandId).exec()) return;
      const [last] = await collection
        .find({ selector: {}, sort: [{ seq: "desc" }], limit: 1 })
        .exec();
      try {
        await collection.insert({
          commandId: snapshot.commandId,
          seq: last ? last.seq + 1 : 0,
          at: snapshot.at,
          batch: snapshot,
        });
      } catch (error) {
        if (!(error instanceof RxError && error.code === "CONFLICT"))
          throw error;
      }
    },
    subscribe: (listener) => {
      const subscription = collection.$.subscribe((event) => {
        if (event.operation === "INSERT")
          listener(structuredClone(event.documentData.batch));
      });
      return () => subscription.unsubscribe();
    },
    close: async () => {
      await database.close();
    },
  };
}
