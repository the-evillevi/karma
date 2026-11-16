// Sending the journal to the server (EVL-126 [C]). One-way backup: this device
// pushes its batches; it never pulls. Supabase arrives in slice [D] as an
// implementation of SyncServer.
import type { CommandBatch } from "../domain/journal.ts";
import type { PushResult } from "../domain/sync.ts";

/** The server side of sync. Rejects when the network or the server fails. */
export interface SyncServer {
  push(batch: CommandBatch): Promise<PushResult>;
}

export type SyncReport = {
  /** commandIds the server confirmed in this run (accepted or duplicate). */
  acknowledged: string[];
  /**
   * Why the run ended before the queue was empty, or null if it emptied.
   * - "network": a push failed; the batch stays pending and is retried later.
   * - "conflict": the server holds different content for a commandId.
   */
  stoppedBy: "network" | "conflict" | null;
  /** The commandId that conflicted, when stoppedBy is "conflict". */
  conflictId: string | null;
  /** How many batches are still unacknowledged after this run. */
  remaining: number;
};

/**
 * Pushes every unacknowledged batch, one at a time, in journal order, and
 * stops at the first one the server does not confirm so that later batches
 * never overtake it. Never throws for network or server failures.
 */
export async function syncPending(input: {
  journal: readonly CommandBatch[];
  acknowledged: ReadonlySet<string>;
  server: SyncServer;
}): Promise<SyncReport> {
  void input;
  throw new Error("not implemented");
}
