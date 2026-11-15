// The app's single source of state: a journal kept in durable storage plus
// the state replayed from it. Screens read `getState()` and call `commit()`.
import type { CommandBatch, PosState } from "../domain/journal.ts";

/** Where batches are kept. Implementations: memory (tests) and RxDB (browser). */
export interface JournalStorage {
  /** Every stored batch, oldest first. */
  load(): Promise<CommandBatch[]>;
  /** Stores one batch durably. Rejects if the write fails. */
  append(batch: CommandBatch): Promise<void>;
  /** Calls `listener` for batches appended elsewhere (another tab). */
  subscribe(listener: (batch: CommandBatch) => void): () => void;
}

/** Thrown by `commit` when the batch could not be written. */
export class StorageWriteError extends Error {
  constructor(cause: unknown) {
    super("The operation could not be saved on this device", { cause });
    this.name = "StorageWriteError";
  }
}

export function createMemoryStorage(
  initial: readonly CommandBatch[] = [],
): JournalStorage {
  void initial;
  throw new Error("not implemented");
}

export class PosStore {
  /** Loads the journal and replays it. */
  static async open(storage: JournalStorage): Promise<PosStore> {
    void storage;
    throw new Error("not implemented");
  }

  getState(): PosState {
    throw new Error("not implemented");
  }

  /** Every committed batch, oldest first. None is synced yet (EVL-126 [D]). */
  pendingBatches(): CommandBatch[] {
    throw new Error("not implemented");
  }

  /**
   * Writes the batch to storage and only then applies it to the state.
   * If the write fails it throws StorageWriteError and the state is unchanged.
   */
  async commit(batch: CommandBatch): Promise<void> {
    void batch;
    throw new Error("not implemented");
  }

  /** Calls `listener` after every state change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    void listener;
    throw new Error("not implemented");
  }

  /** Stops listening to storage. */
  close(): void {
    throw new Error("not implemented");
  }
}
