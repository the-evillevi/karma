// Sync rules (EVL-126 [C]). What travels to the server is the journal itself:
// command batches, unchanged, in journal order. These pure functions define
// the contract both sides must keep; `src/data/sync.ts` drives the sending.
import type { CommandBatch } from "./journal.ts";

/**
 * What the server answers to one pushed batch:
 * - "accepted": stored now.
 * - "duplicate": this exact batch was already stored. Safe to treat as stored.
 * - "conflict": the commandId exists with different content. Nothing changed.
 */
export type PushResult = "accepted" | "duplicate" | "conflict";

/**
 * The server's rule for an incoming batch, as a pure function over its log.
 * The Supabase table must behave exactly like this (unique `commandId`).
 * Never mutates `log`; returns the same array when nothing was stored.
 */
export function receiveBatch(
  log: readonly CommandBatch[],
  batch: CommandBatch,
): { log: readonly CommandBatch[]; result: PushResult } {
  void log;
  void batch;
  throw new Error("not implemented");
}

/**
 * The batches still to send: those whose commandId is not acknowledged, in
 * journal order. Order matters because the server replays them in sequence.
 */
export function nextToSync(
  journal: readonly CommandBatch[],
  acknowledged: ReadonlySet<string>,
): CommandBatch[] {
  void journal;
  void acknowledged;
  throw new Error("not implemented");
}
