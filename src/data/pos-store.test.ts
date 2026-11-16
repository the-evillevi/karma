// @vitest-environment node
// Spec: Linear EVL-126, slice [A]. Test names are the scenario titles.
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
} from "../domain/testing.ts";
import {
  PosStore,
  StorageWriteError,
  createMemoryStorage,
} from "./pos-store.ts";
import type { JournalStorage } from "./pos-store.ts";

function mesa3(store: PosStore, commandId = "op-1"): CommandBatch {
  return saveOrder(store.getState(), meta(commandId, luis, "10:05"), {
    orderId: "o-1",
    header: mesa(3),
    lines: linesOf([americano]),
  });
}

describe("EVL-126 [A] Guardar en el dispositivo", () => {
  it("[A] Una cuenta abierta sobrevive a recargar", async () => {
    // Dado una cuenta guardada en la mesa 3 con un Americano de $50, cuando
    // cierro y vuelvo a abrir la app, entonces la cuenta sigue ahí
    const storage = createMemoryStorage();
    const first = await PosStore.open(storage);
    await first.commit(mesa3(first));
    const saved = first.getState();
    first.close();

    const reopened = await PosStore.open(storage);
    expect(reopened.getState()).toEqual(saved);
    expect(reopened.getState().orders["o-1"]).toMatchObject({
      folio: "A-0001",
      header: mesa(3),
    });
  });

  it("[A] Las operaciones pendientes conservan actor y hora", async () => {
    // Dado Barra "Luis" registra una operación a las 10:05 sin conexión,
    // cuando recargo la app, entonces la operación pendiente conserva su
    // identificador, a "Luis" y las 10:05
    const storage = createMemoryStorage();
    const first = await PosStore.open(storage);
    await first.commit(mesa3(first, "op-123"));
    first.close();

    const reopened = await PosStore.open(storage);
    expect(reopened.pendingBatches()).toHaveLength(1);
    expect(reopened.pendingBatches()[0]).toMatchObject({
      commandId: "op-123",
      at: "2026-11-15T10:05:00.000-06:00",
      actor: { name: "Luis", role: "barra" },
    });
  });

  it("[A] Un fallo de guardado no se reporta como éxito", async () => {
    // Dado el almacenamiento local rechaza la escritura, cuando guardo una
    // cuenta, entonces veo un error y la app no muestra "Guardado"
    const failing: JournalStorage = {
      load: async () => [],
      append: async () => {
        throw new Error("QuotaExceededError");
      },
      subscribe: () => () => {},
    };
    const store = await PosStore.open(failing);
    const listener = vi.fn();
    store.subscribe(listener);

    await expect(store.commit(mesa3(store))).rejects.toBeInstanceOf(
      StorageWriteError,
    );
    expect(store.getState()).toEqual(emptyState());
    expect(store.pendingBatches()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies subscribers after each committed change", async () => {
    const store = await PosStore.open(createMemoryStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    await store.commit(mesa3(store));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await store.commit(
      saveOrder(store.getState(), meta("op-2", luis), {
        orderId: "o-2",
        header: mostrador,
        lines: linesOf([brownie]),
      }),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(Object.keys(store.getState().orders)).toEqual(["o-1", "o-2"]);
  });

  it("commits a retried command once", async () => {
    const storage = createMemoryStorage();
    const store = await PosStore.open(storage);
    const batch = mesa3(store);
    await store.commit(batch);
    await store.commit(batch);
    expect(store.pendingBatches()).toHaveLength(1);
    expect(await storage.load()).toHaveLength(1);
  });

  it("follows batches appended from another tab", async () => {
    // The kitchen view runs in a second tab over the same storage.
    const storage = createMemoryStorage();
    const caja = await PosStore.open(storage);
    const cocina = await PosStore.open(storage);
    const listener = vi.fn();
    cocina.subscribe(listener);

    await caja.commit(mesa3(caja));

    expect(cocina.getState()).toEqual(caja.getState());
    expect(listener).toHaveBeenCalledTimes(1);
    cocina.close();
    await caja.commit(
      saveOrder(caja.getState(), meta("op-2", luis), {
        orderId: "o-2",
        header: mostrador,
        lines: linesOf([brownie]),
      }),
    );
    expect(Object.keys(cocina.getState().orders)).toEqual(["o-1"]);
  });

  it("returns copies from memory storage, like a real database", async () => {
    const storage = createMemoryStorage();
    const store = await PosStore.open(storage);
    const batch = mesa3(store);
    await store.commit(batch);
    const [loaded] = await storage.load();
    expect(loaded).toEqual(batch);
    expect(loaded).not.toBe(batch);
  });
});
