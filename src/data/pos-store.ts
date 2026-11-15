// The app's single source of state: a journal kept in durable storage plus
// the state replayed from it. Screens read `getState()` and call `commit()`.
import type { CommandBatch, PosState } from "../domain/journal.ts";
import { applyBatch, replay } from "../domain/journal.ts";

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
  const batches = structuredClone([...initial]);
  const listeners = new Set<(batch: CommandBatch) => void>();
  return {
    load: async () => structuredClone(batches),
    append: async (batch) => {
      if (batches.some((stored) => stored.commandId === batch.commandId))
        return;
      const snapshot = structuredClone(batch);
      batches.push(snapshot);
      for (const listener of listeners) listener(structuredClone(snapshot));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export class PosStore {
  private readonly listeners = new Set<() => void>();
  private readonly batches: CommandBatch[];
  private unsubscribeStorage: () => void = () => {};

  private constructor(
    private readonly storage: JournalStorage,
    private state: PosState,
    batches: readonly CommandBatch[],
  ) {
    this.batches = [
      ...new Map(
        batches.map((batch) => [batch.commandId, structuredClone(batch)]),
      ).values(),
    ];
  }

  /** Loads the journal and replays it. */
  static async open(storage: JournalStorage): Promise<PosStore> {
    const batches = structuredClone(await storage.load());
    const store = new PosStore(storage, replay(batches), batches);
    store.unsubscribeStorage = storage.subscribe((batch) => {
      store.publish(batch, applyBatch(store.state, batch));
    });
    return store;
  }

  getState(): PosState {
    return this.state;
  }

  /** Every committed batch, oldest first. None is synced yet (EVL-126 [D]). */
  pendingBatches(): CommandBatch[] {
    return structuredClone(this.batches);
  }

  /**
   * Writes the batch to storage and only then applies it to the state.
   * If the write fails it throws StorageWriteError and the state is unchanged.
   */
  async commit(batch: CommandBatch): Promise<void> {
    const snapshot = structuredClone(batch);
    const before = this.state;
    const candidate = applyBatch(before, snapshot);
    if (candidate === before) return;
    try {
      await this.storage.append(snapshot);
    } catch (cause) {
      throw new StorageWriteError(cause);
    }
    this.publish(
      snapshot,
      this.state === before ? candidate : applyBatch(this.state, snapshot),
    );
  }

  /** Calls `listener` after every state change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stops listening to storage. */
  close(): void {
    this.unsubscribeStorage();
  }

  private publish(batch: CommandBatch, next: PosState): void {
    if (next === this.state) return;
    this.batches.push(structuredClone(batch));
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
