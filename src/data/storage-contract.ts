// The behaviour every JournalStorage must have. Each implementation runs this
// same suite from its own test file. Not imported by app code.
import { describe, expect, it, vi } from "vitest";
import { saveOrder } from "../domain/commands.ts";
import { emptyState } from "../domain/journal.ts";
import type { CommandBatch } from "../domain/journal.ts";
import {
  americano,
  brownie,
  linesOf,
  luis,
  mesa,
  meta,
  mostrador,
  sofi,
} from "../domain/testing.ts";
import type { JournalStorage } from "./pos-store.ts";

export type StorageUnderTest = {
  storage: JournalStorage;
  /** Simulates closing the app and opening it again on the same device. */
  reopen: () => Promise<JournalStorage>;
  /** A second connection to the same data, like another browser tab. */
  secondTab: () => Promise<JournalStorage>;
  cleanup: () => Promise<void>;
};

function batchOf(commandId: string, time: string): CommandBatch {
  return saveOrder(emptyState(), meta(commandId, luis, time), {
    orderId: `order-${commandId}`,
    header: mesa(3),
    lines: linesOf([americano, 2], [brownie]),
  });
}

/** Waits until `check` stops throwing, for storages that notify asynchronously. */
async function eventually(check: () => void): Promise<void> {
  await vi.waitFor(check, { timeout: 2000, interval: 10 });
}

export function describeJournalStorage(
  name: string,
  make: () => Promise<StorageUnderTest>,
): void {
  describe(`JournalStorage contract: ${name}`, () => {
    it("starts empty", async () => {
      const subject = await make();
      expect(await subject.storage.load()).toEqual([]);
      await subject.cleanup();
    });

    it("returns batches exactly as stored, oldest first", async () => {
      const subject = await make();
      // Appended in this order even though the clock went backwards: the
      // journal order is the append order, not the timestamp order.
      const batches = [
        batchOf("op-c", "10:30"),
        batchOf("op-a", "10:05"),
        batchOf("op-b", "10:10"),
      ];
      for (const batch of batches) await subject.storage.append(batch);
      const loaded = await subject.storage.load();
      expect(loaded).toEqual(batches);
      expect(loaded[0]).not.toBe(batches[0]);
      await subject.cleanup();
    });

    it("keeps the batches after the app is reopened", async () => {
      const subject = await make();
      const batch = batchOf("op-1", "10:05");
      await subject.storage.append(batch);
      const reopened = await subject.reopen();
      expect(await reopened.load()).toEqual([batch]);
      await subject.cleanup();
    });

    it("stores a retried command once", async () => {
      const subject = await make();
      const batch = batchOf("op-1", "10:05");
      await subject.storage.append(batch);
      await subject.storage.append(batch);
      await subject.storage.append(structuredClone(batch));
      expect(await subject.storage.load()).toEqual([batch]);
      await subject.cleanup();
    });

    it("does not let callers change what is stored", async () => {
      const subject = await make();
      const batch = saveOrder(emptyState(), meta("op-1", sofi), {
        orderId: "o-1",
        header: mostrador,
        lines: linesOf([americano]),
      });
      const original = structuredClone(batch);
      await subject.storage.append(batch);
      batch.actor.name = "changed after append";
      const [loaded] = await subject.storage.load();
      loaded.actor.name = "changed after load";
      expect(await subject.storage.load()).toEqual([original]);
      await subject.cleanup();
    });

    it("notifies subscribers of batches appended in another tab", async () => {
      const subject = await make();
      const other = await subject.secondTab();
      const heard: CommandBatch[] = [];
      const unsubscribe = subject.storage.subscribe((batch) =>
        heard.push(batch),
      );
      const first = batchOf("op-1", "10:05");
      await other.append(first);
      await eventually(() => expect(heard).toEqual([first]));

      unsubscribe();
      await other.append(batchOf("op-2", "10:06"));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(heard).toEqual([first]);
      await eventually(async () =>
        expect(await subject.storage.load()).toHaveLength(2),
      );
      await subject.cleanup();
    });
  });
}
