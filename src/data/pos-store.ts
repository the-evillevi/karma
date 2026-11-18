import type { CommandBatch, PosState } from "../domain/journal.ts";
import { applyBatch, replay } from "../domain/journal.ts";

export interface JournalStorage {
  load(): Promise<CommandBatch[]>;
  append(batch: CommandBatch): Promise<void>;
  subscribe(listener: (batch: CommandBatch) => void): () => void;
  exclusive<T>(task: () => Promise<T>): Promise<T>;
}

export class StorageWriteError extends Error {
  constructor(cause: unknown) {
    super("The operation could not be saved on this device", { cause });
    this.name = "StorageWriteError";
  }
}

export class StoreOutOfSyncError extends Error {
  constructor() {
    super("The store must be reloaded before another operation can be saved");
    this.name = "StoreOutOfSyncError";
  }
}

export function createMemoryStorage(
  initial: readonly CommandBatch[] = [],
): JournalStorage {
  const batches = structuredClone([...initial]);
  const listeners = new Set<(batch: CommandBatch) => void>();
  let queue = Promise.resolve();
  return {
    exclusive<T>(task: () => Promise<T>): Promise<T> {
      const result = queue.then(task);
      queue = result.then(
        () => {},
        () => {},
      );
      return result;
    },
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
  private batches: CommandBatch[] = [];
  private state: PosState = replay([]);
  private problem: Error | null = null;
  private recovery: Promise<void> | null = null;
  private buffered: CommandBatch[] = [];
  private unsubscribeStorage: () => void = () => {};

  private constructor(private readonly storage: JournalStorage) {}

  static async open(storage: JournalStorage): Promise<PosStore> {
    const store = new PosStore(storage);
    const buffer: CommandBatch[] = [];
    let loaded = false;
    store.unsubscribeStorage = storage.subscribe((batch) => {
      if (!loaded) buffer.push(structuredClone(batch));
      else store.receive(batch);
    });
    try {
      const batches = structuredClone(await storage.load());
      store.state = replay(batches);
      store.batches = store.uniqueBatches(batches);
      loaded = true;
      for (const batch of buffer) store.receive(batch);
      await store.recovery;
      return store;
    } catch (error) {
      store.close();
      throw error;
    }
  }

  getState(): PosState {
    return this.state;
  }

  getProblem(): Error | null {
    return this.problem;
  }

  pendingBatches(): CommandBatch[] {
    return structuredClone(this.batches);
  }

  async commit(batch: CommandBatch): Promise<void> {
    await this.run(() => batch);
  }

  run(decide: (state: PosState) => CommandBatch): Promise<PosState> {
    return this.storage.exclusive(async () => {
      await this.recovery;
      if (this.problem) throw new StoreOutOfSyncError();
      const batches = await this.storage.load();
      for (const batch of batches) {
        if (!Object.hasOwn(this.state.applied, batch.commandId)) {
          this.publish(batch, applyBatch(this.state, batch));
        }
      }
      await this.recovery;
      if (this.problem) throw new StoreOutOfSyncError();
      const snapshot = structuredClone(decide(this.state));
      const before = this.state;
      const candidate = applyBatch(before, snapshot);
      if (candidate === before) return this.state;
      try {
        await this.storage.append(snapshot);
      } catch (cause) {
        throw new StorageWriteError(cause);
      }
      await this.recovery;
      if (this.problem) throw new StoreOutOfSyncError();
      this.publish(
        snapshot,
        this.state === before ? candidate : applyBatch(this.state, snapshot),
      );
      return this.state;
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close(): void {
    this.unsubscribeStorage();
  }

  private publish(batch: CommandBatch, next: PosState): void {
    if (next === this.state) return;
    this.batches.push(structuredClone(batch));
    this.state = next;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private uniqueBatches(batches: readonly CommandBatch[]): CommandBatch[] {
    return [
      ...new Map(
        batches.map((batch) => [batch.commandId, structuredClone(batch)]),
      ).values(),
    ];
  }

  private receive(batch: CommandBatch): void {
    if (this.problem) return;
    if (this.recovery) {
      this.buffered.push(structuredClone(batch));
      return;
    }
    try {
      this.publish(batch, applyBatch(this.state, batch));
    } catch {
      this.recovery = this.resync().finally(() => {
        this.recovery = null;
      });
    }
  }

  private async resync(): Promise<void> {
    try {
      const batches = structuredClone(await this.storage.load());
      let next = replay(batches);
      for (const batch of this.buffered.splice(0)) {
        const applied = applyBatch(next, batch);
        if (applied !== next) batches.push(structuredClone(batch));
        next = applied;
      }
      this.state = next;
      this.batches = this.uniqueBatches(batches);
    } catch (cause) {
      this.problem = cause instanceof Error ? cause : new Error(String(cause));
    }
    this.notify();
  }
}
