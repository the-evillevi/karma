import { describe, expect, it, vi } from "vitest";
import { saveOrder } from "../domain/commands.ts";
import { applyBatch, emptyState, replay } from "../domain/journal.ts";
import type { CommandBatch } from "../domain/journal.ts";
import {
  createModifierGroup,
  menuFor,
  setProductGroups,
} from "../domain/menu.ts";
import {
  admin,
  americano,
  brownie,
  catalog,
  linesOf,
  luis,
  mesa,
  meta,
  mostrador,
  sofi,
  withoutGroup,
} from "../domain/testing.ts";
import type { JournalStorage } from "./pos-store.ts";

export type StorageUnderTest = {
  storage: JournalStorage;
  reopen: () => Promise<JournalStorage>;
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

async function eventually(check: () => void): Promise<void> {
  await vi.waitFor(check, { timeout: 2000, interval: 10 });
}

export function describeJournalStorage(
  name: string,
  make: () => Promise<StorageUnderTest>,
): void {
  describe(`JournalStorage contract: ${name}`, () => {
    it("runs exclusive tasks one at a time across connections", async () => {
      const subject = await make();
      const other = await subject.secondTab();
      const events: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = subject.storage
        .exclusive(async () => {
          events.push("first-start");
          await gate;
          events.push("first-end");
          throw new Error("first failed");
        })
        .catch((error: unknown) =>
          error instanceof Error ? error.message : "unexpected",
        );
      const second = other.exclusive(async () => {
        events.push("second");
        return 2;
      });
      const third = subject.storage.exclusive(async () => {
        events.push("third");
        return 3;
      });
      await vi.waitFor(() => expect(events).toEqual(["first-start"]));
      release();
      expect(await first).toBe("first failed");
      expect(await second).toBe(2);
      expect(await third).toBe(3);
      expect(events).toEqual(["first-start", "first-end", "second", "third"]);
      await subject.cleanup();
    });

    it("starts empty", async () => {
      const subject = await make();
      expect(await subject.storage.load()).toEqual([]);
      await subject.cleanup();
    });

    it("returns batches exactly as stored, oldest first", async () => {
      const subject = await make();
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

    it("keeps a group created in the app and its assignment after the app is reopened", async () => {
      const subject = await make();
      const menuBeforeSabor = withoutGroup(catalog, "sabor");
      const created = createModifierGroup(
        emptyState(),
        meta("crear-sabor", admin),
        {
          groupId: "sabor-de-carlos",
          name: "Sabor",
          min: 1,
          max: 1,
          options: [
            {
              optionId: "fresa",
              name: "Mermelada de fresa",
              priceDeltaCents: 0,
            },
            {
              optionId: "zarzamora",
              name: "Mermelada de zarzamora c/ queso",
              priceDeltaCents: 0,
            },
          ],
        },
        menuBeforeSabor,
      );
      const assigned = setProductGroups(
        applyBatch(emptyState(), created),
        meta("asignar-sabor", admin, "10:01"),
        {
          productId: "52000822188",
          groupIds: ["sabor-de-carlos", "fruta-acompanamiento"],
        },
        menuBeforeSabor,
      );
      await subject.storage.append(created);
      await subject.storage.append(assigned);
      const reopened = await subject.reopen();
      const loaded = await reopened.load();
      expect(loaded).toEqual([created, assigned]);
      expect(menuFor(catalog, replay(loaded).menu)).toEqual(
        menuFor(catalog, replay([created, assigned]).menu),
      );
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
