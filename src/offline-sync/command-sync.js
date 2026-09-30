const remoteColumns = "command_id,branch_id,aggregate_id,actor_id,device_id,lease_id,schema_version,occurred_at,events,received_at";

export async function captureCommandBatch(database, commandBatch, { beforeLocalInsert } = {}) {
  validateCommandBatch(commandBatch);
  const existing = await database.commandBatches.findOne(commandBatch.commandId).exec();
  if (existing) {
    if (!sameJson(existing.toJSON(), commandBatch)) throw new Error(`Local command ID reused with different content: ${commandBatch.commandId}`);
    return { batch: existing.toJSON(), duplicate: true };
  }
  if (beforeLocalInsert) await beforeLocalInsert(commandBatch);
  try {
    const inserted = await database.commandBatches.insert(commandBatch);
    return { batch: inserted.toJSON(), duplicate: false };
  } catch (error) {
    // Two same-device tabs may race between the first lookup and primary-key insert.
    const raced = await database.commandBatches.findOne(commandBatch.commandId).exec();
    if (!raced || !sameJson(raced.toJSON(), commandBatch)) throw error;
    return { batch: raced.toJSON(), duplicate: true };
  }
}

export async function syncPendingCommandBatches(database, supabase, { afterRemoteInsert, shouldInterruptAfterRemoteInsert } = {}) {
  const [batches, receiptDocs, blockDocs] = await Promise.all([
    database.commandBatches.find().sort({ occurredAt: "asc" }).exec(),
    database.syncReceipts.find().exec(),
    database.syncBlocks.find().exec(),
  ]);
  const receipts = new Set(receiptDocs.map((doc) => doc.commandId));
  const blocks = new Map(blockDocs.map((doc) => [doc.commandId, doc.code]));
  const outcomes = [];
  for (const batchDoc of batches) {
    const batch = batchDoc.toJSON();
    if (receipts.has(batch.commandId)) continue;
    if (blocks.has(batch.commandId)) {
      outcomes.push({ commandId: batch.commandId, state: "blocked", code: blocks.get(batch.commandId) });
      continue;
    }
    try {
      const { row, outcome } = await insertOrConfirmExisting(supabase, batch);
      if (afterRemoteInsert && (!shouldInterruptAfterRemoteInsert || shouldInterruptAfterRemoteInsert(batch, row))) await afterRemoteInsert(batch, row);
      await database.syncReceipts.insert({
        commandId: batch.commandId,
        serverReceivedAt: row.received_at,
        outcome,
      });
      receipts.add(batch.commandId);
      outcomes.push({ commandId: batch.commandId, state: "acknowledged", outcome, serverReceivedAt: row.received_at });
    } catch (error) {
      const code = error?.code ?? "LOCAL_OR_NETWORK_ERROR";
      const permanentlyBlocked = ["42501", "22023", "23503", "COMMAND_CONFLICT"].includes(code);
      if (permanentlyBlocked) {
        await database.syncBlocks.insert({ commandId: batch.commandId, code: String(code), blockedAt: new Date().toISOString() });
        blocks.set(batch.commandId, String(code));
      }
      outcomes.push({
        commandId: batch.commandId,
        state: permanentlyBlocked ? "blocked" : "pending",
        code,
      });
    }
  }
  return outcomes;
}

export async function createSupabaseClient() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Local Supabase configuration is missing. Run pnpm offline:local:up first.");
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
}

export function createDemoOrderBatch({ branchId, actorId, deviceId, leaseId, commandId = crypto.randomUUID(), occurredAt = new Date().toISOString() }) {
  const aggregateId = crypto.randomUUID();
  const event = {
    eventId: `${commandId}:0`,
    commandId,
    aggregateId,
    type: "OrderOpened",
    schemaVersion: 1,
    actorId,
    deviceId,
    occurredAt,
    payload: {
      orderId: aggregateId,
      currency: "MXN",
      lines: [{
        lineId: `${aggregateId}:line:0`,
        productId: "demo-latte-v1",
        productNameSnapshot: "Latte de prueba",
        unitPriceCents: 6900,
        quantity: 1,
        taxRateBasisPoints: 1600,
        priceIncludesTax: true,
        catalogPriceVersionId: "demo-latte-price-2026-09",
        modifierSnapshots: [{
          modifierId: "oat-milk-v1",
          nameSnapshot: "Leche de avena",
          priceDeltaCents: 1000,
          taxRateBasisPoints: 1600,
          priceIncludesTax: true,
        }],
      }],
    },
  };
  return {
    commandId,
    branchId,
    aggregateId,
    actorId,
    deviceId,
    leaseId,
    schemaVersion: 1,
    occurredAt,
    events: [event],
  };
}

function validateCommandBatch(batch) {
  if (!batch || !Array.isArray(batch.events) || batch.events.length < 1) throw new TypeError("A command batch needs at least one event");
  if (!batch.commandId || !batch.branchId || !batch.aggregateId || !batch.actorId || !batch.deviceId || !batch.leaseId) throw new TypeError("Command identity is incomplete");
  for (let index = 0; index < batch.events.length; index += 1) {
    const event = batch.events[index];
    if (event.eventId !== `${batch.commandId}:${index}`
      || event.commandId !== batch.commandId
      || event.aggregateId !== batch.aggregateId
      || event.actorId !== batch.actorId
      || event.deviceId !== batch.deviceId
      || event.occurredAt !== batch.occurredAt
      || event.schemaVersion !== batch.schemaVersion) {
      throw new Error("Event metadata must match the command batch and ordered event identity");
    }
  }
}

async function insertOrConfirmExisting(supabase, batch) {
  const rowToInsert = {
    command_id: batch.commandId,
    branch_id: batch.branchId,
    aggregate_id: batch.aggregateId,
    actor_id: batch.actorId,
    device_id: batch.deviceId,
    lease_id: batch.leaseId,
    schema_version: batch.schemaVersion,
    occurred_at: batch.occurredAt,
    events: batch.events,
  };
  const inserted = await supabase.from("command_batches").insert(rowToInsert).select(remoteColumns).single();
  if (!inserted.error) return { row: inserted.data, outcome: "inserted" };
  if (inserted.error.code !== "23505") throw inserted.error;
  const existing = await supabase.from("command_batches").select(remoteColumns).eq("command_id", batch.commandId).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data || !sameJson(normalizeBatchForComparison(remoteRowToBatch(existing.data)), normalizeBatchForComparison(rowToInsert))) {
    const conflict = new Error(`Remote command ID conflicts with a different batch: ${batch.commandId}`);
    conflict.code = "COMMAND_CONFLICT";
    throw conflict;
  }
  return { row: existing.data, outcome: "identical-retry" };
}

function remoteRowToBatch(row) {
  return {
    command_id: row.command_id,
    branch_id: row.branch_id,
    aggregate_id: row.aggregate_id,
    actor_id: row.actor_id,
    device_id: row.device_id,
    lease_id: row.lease_id,
    schema_version: row.schema_version,
    occurred_at: new Date(row.occurred_at).toISOString(),
    events: row.events,
  };
}

function normalizeBatchForComparison(batch) {
  return { ...batch, occurred_at: new Date(batch.occurred_at).toISOString() };
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
