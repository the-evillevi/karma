import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommandBatchDocument } from "../domain/contracts.ts";
import { validateEvent, type DomainEvent } from "../domain/order-domain.ts";

const remoteColumns =
  "command_id,branch_id,aggregate_id,actor_id,device_id,lease_id,schema_version,occurred_at,events,received_at";

export interface OfflineCommandBatch extends CommandBatchDocument<DomainEvent> {
  branchId: string;
  leaseId: string;
}

interface Document<T> {
  toJSON(): T;
}

interface Collection<T extends { commandId: string }> {
  findOne(id: string): { exec(): Promise<Document<T> | null> };
  find(): {
    exec(): Promise<Document<T>[]>;
    sort(criteria: Record<string, "asc" | "desc">): {
      exec(): Promise<Document<T>[]>;
    };
  };
  insert(value: T): Promise<Document<T>>;
}

interface OfflineDatabase {
  commandBatches: Collection<OfflineCommandBatch>;
  syncReceipts: Collection<SyncReceipt>;
  syncBlocks: Collection<SyncBlock>;
}

export interface SyncReceipt {
  commandId: string;
  serverReceivedAt: string;
  outcome: "inserted" | "identical-retry";
}

export interface SyncBlock {
  commandId: string;
  code: string;
  blockedAt: string;
}

interface RemoteCommandBatch {
  command_id: string;
  branch_id: string;
  aggregate_id: string;
  actor_id: string;
  device_id: string;
  lease_id: string;
  schema_version: number;
  occurred_at: string;
  events: readonly DomainEvent[];
}

interface RemoteRow extends RemoteCommandBatch {
  received_at: string;
}

interface RemoteError {
  code?: string;
  message?: string;
  details?: string;
}

interface RemoteResult<T> {
  data: T | null;
  error: RemoteError | null;
}

interface SupabaseLike {
  rpc?: (
    functionName: "append_command_batch",
    args: {
      p_command_id: string;
      p_branch_id: string;
      p_aggregate_id: string;
      p_device_id: string;
      p_session_id: string;
      p_lease_id: string;
      p_schema_version: number;
      p_occurred_at: string;
      p_events: readonly DomainEvent[];
    },
  ) => PromiseLike<RemoteResult<{ command_id: string; received_at: string }[]>>;
  from?(table: "command_batches"): {
    insert(value: RemoteCommandBatch): {
      select(columns: string): {
        single(): PromiseLike<RemoteResult<RemoteRow>>;
      };
    };
    select(columns: string): {
      eq(
        column: "command_id",
        value: string,
      ): { maybeSingle(): PromiseLike<RemoteResult<RemoteRow>> };
    };
  };
}

export interface SyncHooks {
  afterRemoteInsert?: (
    batch: OfflineCommandBatch,
    row: RemoteRow,
  ) => Promise<void>;
  shouldInterruptAfterRemoteInsert?: (
    batch: OfflineCommandBatch,
    row: RemoteRow,
  ) => boolean;
}

export interface SyncOptions extends SyncHooks {
  /**
   * Session returned by bind_register_session. Passing it selects the EVL-118
   * RPC boundary; omitting it is retained only for the isolated EVL-114 proof.
   */
  sessionId?: string;
}

export type SyncOutcome =
  | { commandId: string; state: "blocked"; code: string | undefined }
  | {
      commandId: string;
      state: "acknowledged";
      outcome: "inserted" | "identical-retry";
      serverReceivedAt: string;
    }
  | { commandId: string; state: "pending"; code: string };

interface ErrorWithCode extends Error {
  code?: string;
}

export async function captureCommandBatch(
  database: OfflineDatabase,
  commandBatch: OfflineCommandBatch,
  {
    beforeLocalInsert,
  }: { beforeLocalInsert?: (batch: OfflineCommandBatch) => Promise<void> } = {},
): Promise<{ batch: OfflineCommandBatch; duplicate: boolean }> {
  validateCommandBatch(commandBatch);
  const existing = await database.commandBatches
    .findOne(commandBatch.commandId)
    .exec();
  if (existing) {
    if (!sameJson(existing.toJSON(), commandBatch))
      throw new Error(
        `Local command ID reused with different content: ${commandBatch.commandId}`,
      );
    return { batch: existing.toJSON(), duplicate: true };
  }
  if (beforeLocalInsert) await beforeLocalInsert(commandBatch);
  try {
    const inserted = await database.commandBatches.insert(commandBatch);
    return { batch: inserted.toJSON(), duplicate: false };
  } catch (error) {
    // Two same-device tabs may race between the first lookup and primary-key insert.
    const raced = await database.commandBatches
      .findOne(commandBatch.commandId)
      .exec();
    if (!raced || !sameJson(raced.toJSON(), commandBatch)) throw error;
    return { batch: raced.toJSON(), duplicate: true };
  }
}

export async function syncPendingCommandBatches(
  database: OfflineDatabase,
  supabase: SupabaseLike,
  {
    afterRemoteInsert,
    shouldInterruptAfterRemoteInsert,
    sessionId,
  }: SyncOptions = {},
): Promise<SyncOutcome[]> {
  const [batches, receiptDocs, blockDocs] = await Promise.all([
    database.commandBatches.find().sort({ occurredAt: "asc" }).exec(),
    database.syncReceipts.find().exec(),
    database.syncBlocks.find().exec(),
  ]);
  const receipts = new Set(receiptDocs.map((doc) => doc.toJSON().commandId));
  const blocks = new Map(
    blockDocs.map((doc) => [doc.toJSON().commandId, doc.toJSON().code]),
  );
  const outcomes: SyncOutcome[] = [];
  for (const batchDoc of batches) {
    const batch = batchDoc.toJSON();
    if (receipts.has(batch.commandId)) continue;
    if (blocks.has(batch.commandId)) {
      outcomes.push({
        commandId: batch.commandId,
        state: "blocked",
        code: blocks.get(batch.commandId),
      });
      continue;
    }
    try {
      const { row, outcome } = await insertOrConfirmExisting(
        supabase,
        batch,
        sessionId,
      );
      if (
        afterRemoteInsert &&
        (!shouldInterruptAfterRemoteInsert ||
          shouldInterruptAfterRemoteInsert(batch, row))
      )
        await afterRemoteInsert(batch, row);
      await database.syncReceipts.insert({
        commandId: batch.commandId,
        serverReceivedAt: row.received_at,
        outcome,
      });
      receipts.add(batch.commandId);
      outcomes.push({
        commandId: batch.commandId,
        state: "acknowledged",
        outcome,
        serverReceivedAt: row.received_at,
      });
    } catch (error) {
      const candidate =
        typeof error === "object" && error !== null
          ? (error as { code?: unknown })
          : {};
      const code =
        typeof candidate.code === "string"
          ? candidate.code
          : "LOCAL_OR_NETWORK_ERROR";
      const permanentlyBlocked = [
        "42501",
        "22023",
        "23503",
        "23505",
        "COMMAND_CONFLICT",
      ].includes(code);
      if (permanentlyBlocked) {
        await database.syncBlocks.insert({
          commandId: batch.commandId,
          code: String(code),
          blockedAt: new Date().toISOString(),
        });
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

export async function createSupabaseClient(): Promise<SupabaseClient> {
  const { createClient } = await import("@supabase/supabase-js");
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey)
    throw new Error(
      "Local Supabase configuration is missing. Run pnpm offline:local:up first.",
    );
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export function createDemoOrderBatch({
  branchId,
  actorId,
  deviceId,
  leaseId,
  commandId = crypto.randomUUID(),
  occurredAt = new Date().toISOString(),
}: {
  branchId: string;
  actorId: string;
  deviceId: string;
  leaseId: string;
  commandId?: string;
  occurredAt?: string;
}): OfflineCommandBatch {
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
      lines: [
        {
          lineId: `${aggregateId}:line:0`,
          productId: "demo-latte-v1",
          productNameSnapshot: "Latte de prueba",
          unitPriceCents: 6900,
          quantity: 1,
          taxRateBasisPoints: 1600,
          priceIncludesTax: true,
          catalogPriceVersionId: "demo-latte-price-2026-09",
          modifierSnapshots: [
            {
              modifierId: "oat-milk-v1",
              nameSnapshot: "Leche de avena",
              priceDeltaCents: 1000,
              taxRateBasisPoints: 1600,
              priceIncludesTax: true,
            },
          ],
        },
      ],
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

export function validateCommandBatch(batch: OfflineCommandBatch): void {
  if (
    !Array.isArray(batch.events) ||
    batch.events.length < 1 ||
    batch.events.length > 100
  )
    throw new TypeError(
      "A command batch needs between one and one hundred events",
    );
  if (
    [
      batch.commandId,
      batch.branchId,
      batch.aggregateId,
      batch.actorId,
      batch.deviceId,
      batch.leaseId,
    ].some((value) => typeof value !== "string" || !value.trim())
  )
    throw new TypeError("Command identity is incomplete");
  if (!Number.isSafeInteger(batch.schemaVersion) || batch.schemaVersion < 1)
    throw new TypeError("Command schemaVersion must be a positive integer");
  if (Number.isNaN(Date.parse(batch.occurredAt)))
    throw new TypeError(
      "Command occurredAt must be an ISO-compatible timestamp",
    );
  for (let index = 0; index < batch.events.length; index += 1) {
    const event = batch.events[index];
    validateEvent(event);
    if (
      event.eventId !== `${batch.commandId}:${index}` ||
      event.commandId !== batch.commandId ||
      event.aggregateId !== batch.aggregateId ||
      event.actorId !== batch.actorId ||
      event.deviceId !== batch.deviceId ||
      event.occurredAt !== batch.occurredAt ||
      event.schemaVersion !== batch.schemaVersion
    ) {
      throw new Error(
        "Event metadata must match the command batch and ordered event identity",
      );
    }
  }
}

async function insertOrConfirmExisting(
  supabase: SupabaseLike,
  batch: OfflineCommandBatch,
  sessionId?: string,
): Promise<{ row: RemoteRow; outcome: "inserted" | "identical-retry" }> {
  if (sessionId) {
    if (!supabase.rpc) {
      const unsupported: ErrorWithCode = new Error(
        "The configured client cannot call the secure command endpoint.",
      );
      unsupported.code = "SECURE_RPC_UNAVAILABLE";
      throw unsupported;
    }
    const response = await supabase.rpc("append_command_batch", {
      p_command_id: batch.commandId,
      p_branch_id: batch.branchId,
      p_aggregate_id: batch.aggregateId,
      p_device_id: batch.deviceId,
      p_session_id: sessionId,
      p_lease_id: batch.leaseId,
      p_schema_version: batch.schemaVersion,
      p_occurred_at: batch.occurredAt,
      p_events: batch.events,
    });
    if (response.error) throw response.error;
    const confirmation = Array.isArray(response.data)
      ? response.data[0]
      : undefined;
    if (
      !confirmation ||
      confirmation.command_id !== batch.commandId ||
      typeof confirmation.received_at !== "string"
    ) {
      throw new Error("Secure command endpoint returned no acknowledgement.");
    }
    return {
      row: {
        command_id: batch.commandId,
        branch_id: batch.branchId,
        aggregate_id: batch.aggregateId,
        actor_id: batch.actorId,
        device_id: batch.deviceId,
        lease_id: batch.leaseId,
        schema_version: batch.schemaVersion,
        occurred_at: batch.occurredAt,
        events: batch.events,
        received_at: confirmation.received_at,
      },
      // The RPC intentionally treats inserted and identical retry as one
      // accepted receipt. It does not expose mutable transport-session state.
      outcome: "inserted",
    };
  }

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
  if (!supabase.from) {
    const unsupported: ErrorWithCode = new Error(
      "The configured client cannot use the legacy proof endpoint.",
    );
    unsupported.code = "LEGACY_ENDPOINT_UNAVAILABLE";
    throw unsupported;
  }
  const from = supabase.from.bind(supabase);
  const inserted = await from("command_batches")
    .insert(rowToInsert)
    .select(remoteColumns)
    .single();
  if (!inserted.error) {
    if (!inserted.data)
      throw new Error("Remote insert returned no command receipt.");
    return { row: inserted.data, outcome: "inserted" };
  }
  if (inserted.error.code !== "23505") throw inserted.error;
  const existing = await supabase
    .from("command_batches")
    .select(remoteColumns)
    .eq("command_id", batch.commandId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (
    !existing.data ||
    !sameJson(
      normalizeBatchForComparison(remoteRowToBatch(existing.data)),
      normalizeBatchForComparison(rowToInsert),
    )
  ) {
    const conflict: ErrorWithCode = new Error(
      `Remote command ID conflicts with a different batch: ${batch.commandId}`,
    );
    conflict.code = "COMMAND_CONFLICT";
    throw conflict;
  }
  return { row: existing.data, outcome: "identical-retry" };
}

function remoteRowToBatch(row: RemoteRow): RemoteCommandBatch {
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

function normalizeBatchForComparison(
  batch: RemoteCommandBatch,
): RemoteCommandBatch {
  return { ...batch, occurred_at: new Date(batch.occurred_at).toISOString() };
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string | undefined {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
