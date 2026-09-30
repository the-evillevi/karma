import { addRxPlugin, createRxDatabase } from "rxdb";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { RxDBQueryBuilderPlugin } from "rxdb/plugins/query-builder";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";

addRxPlugin(RxDBDevModePlugin);
addRxPlugin(RxDBQueryBuilderPlugin);

const eventSchema = {
  type: "object",
  properties: {
    eventId: { type: "string", maxLength: 200 },
    commandId: { type: "string", maxLength: 100 },
    aggregateId: { type: "string", maxLength: 100 },
    type: { type: "string", maxLength: 80 },
    schemaVersion: { type: "integer", minimum: 1 },
    actorId: { type: "string", maxLength: 80 },
    deviceId: { type: "string", maxLength: 100 },
    occurredAt: { type: "string", maxLength: 64, format: "date-time" },
    payload: { type: "object", additionalProperties: true },
  },
  required: ["eventId", "commandId", "aggregateId", "type", "schemaVersion", "actorId", "deviceId", "occurredAt", "payload"],
  additionalProperties: true,
};

export const commandBatchSchema = {
  title: "immutable order command batch",
  version: 0,
  primaryKey: "commandId",
  type: "object",
  properties: {
    commandId: { type: "string", maxLength: 100 },
    branchId: { type: "string", maxLength: 100 },
    aggregateId: { type: "string", maxLength: 100 },
    actorId: { type: "string", maxLength: 80 },
    deviceId: { type: "string", maxLength: 100 },
    leaseId: { type: "string", maxLength: 100 },
    schemaVersion: { type: "integer", minimum: 1 },
    occurredAt: { type: "string", maxLength: 64, format: "date-time" },
    events: { type: "array", minItems: 1, items: eventSchema },
  },
  required: ["commandId", "branchId", "aggregateId", "actorId", "deviceId", "leaseId", "schemaVersion", "occurredAt", "events"],
  additionalProperties: false,
  indexes: ["branchId", "occurredAt"],
};

export const syncReceiptSchema = {
  title: "server acknowledgement for immutable command batch",
  version: 0,
  primaryKey: "commandId",
  type: "object",
  properties: {
    commandId: { type: "string", maxLength: 100 },
    serverReceivedAt: { type: "string", maxLength: 64, format: "date-time" },
    outcome: { type: "string", enum: ["inserted", "identical-retry"] },
  },
  required: ["commandId", "serverReceivedAt", "outcome"],
  additionalProperties: false,
};

export const syncBlockSchema = {
  title: "command requiring manual synchronization review",
  version: 0,
  primaryKey: "commandId",
  type: "object",
  properties: {
    commandId: { type: "string", maxLength: 100 },
    code: { type: "string", maxLength: 80 },
    blockedAt: { type: "string", format: "date-time" },
  },
  required: ["commandId", "code", "blockedAt"],
  additionalProperties: false,
};

const openDatabases = new Map();

export function openOfflineDatabase(name = "karma-offline-demo-v1") {
  if (!openDatabases.has(name)) {
    openDatabases.set(name, createRxDatabase({
      name,
      storage: wrappedValidateAjvStorage({ storage: getRxStorageDexie() }),
      multiInstance: false,
      eventReduce: true,
    }).then(async (database) => {
      await database.addCollections({
        commandBatches: { schema: commandBatchSchema },
        syncReceipts: { schema: syncReceiptSchema },
        syncBlocks: { schema: syncBlockSchema },
      });
      return database;
    }));
  }
  return openDatabases.get(name);
}
