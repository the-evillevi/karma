// @vitest-environment node
// Spec: Linear EVL-126, slice [A]. Test names are the scenario titles.
import { describe, expect, it } from "vitest";
import { CommandRejectedError, saveOrder } from "./commands.ts";
import type { CommandRejection } from "./commands.ts";
import {
  DEFAULT_TABLE_COUNT,
  JournalConflictError,
  applyBatch,
  emptyState,
  folioFor,
  replay,
} from "./journal.ts";
import type { Actor, CommandBatch } from "./journal.ts";
import { orderTotals } from "./order.ts";
import {
  americano,
  brownie,
  catalog,
  linesOf,
  luis,
  mesa,
  meta,
  mostrador,
  sofi,
} from "./testing.ts";

function rejection(action: () => unknown): CommandRejection | "not rejected" {
  try {
    action();
  } catch (error) {
    if (error instanceof CommandRejectedError) return error.reason;
    throw error;
  }
  return "not rejected";
}

/** What storage does to a batch: it comes back as plain JSON. */
function stored(batches: CommandBatch[]): CommandBatch[] {
  return JSON.parse(JSON.stringify(batches)) as CommandBatch[];
}

describe("EVL-126 [A] Diario de operaciones", () => {
  it("[A] Una cuenta abierta sobrevive a recargar", () => {
    // Dado una cuenta guardada en la mesa 3 con un Americano de $50, cuando
    // cierro y vuelvo a abrir la app, entonces la cuenta sigue ahí con la
    // misma partida, total y folio
    const batch = saveOrder(emptyState(), meta("op-1", luis, "10:05"), {
      orderId: "o-1",
      header: mesa(3),
      lines: linesOf([americano]),
    });
    const before = applyBatch(emptyState(), batch);

    const after = replay(stored([batch]));

    expect(after).toEqual(before);
    const order = after.orders["o-1"];
    expect(order.folio).toBe("A-0001");
    expect(order.header).toEqual(mesa(3));
    expect(order.status).toBe("open");
    expect(order.version).toBe(1);
    expect(order.sale).toBeNull();
    expect(order.sentQuantities).toEqual({});
    expect(order.lines).toEqual(linesOf([americano]));
    expect(orderTotals(order.lines, catalog.taxRateBps).totalCents).toBe(5000);
  });

  it("[A] Las operaciones pendientes conservan actor y hora", () => {
    // Dado Barra "Luis" registra una operación a las 10:05 sin conexión,
    // cuando recargo la app, entonces la operación conserva su identificador,
    // a "Luis" y las 10:05
    const batch = saveOrder(emptyState(), meta("op-123", luis, "10:05"), {
      orderId: "o-1",
      header: mostrador,
      lines: linesOf([americano]),
    });
    const [reloaded] = stored([batch]);
    expect(reloaded).toMatchObject({
      commandId: "op-123",
      at: "2026-11-15T10:05:00.000-06:00",
      actor: { userId: "u-luis", name: "Luis", role: "barra" },
      deviceId: "caja-1",
    });
    expect(reloaded.events).toHaveLength(1);

    const order = replay([reloaded]).orders["o-1"];
    expect(order.openedBy.name).toBe("Luis");
    expect(order.openedAt).toBe("2026-11-15T10:05:00.000-06:00");
    expect(order.updatedBy.name).toBe("Luis");
    expect(order.updatedAt).toBe("2026-11-15T10:05:00.000-06:00");
  });

  it("starts empty with the default table count", () => {
    expect(emptyState()).toEqual({
      orders: {},
      comandas: {},
      tableCount: DEFAULT_TABLE_COUNT,
      lastFolioNumber: 0,
      applied: {},
    });
    expect(DEFAULT_TABLE_COUNT).toBe(8);
    expect(replay([])).toEqual(emptyState());
    expect(folioFor(1)).toBe("A-0001");
    expect(folioFor(42)).toBe("A-0042");
    expect(folioFor(12345)).toBe("A-12345");
  });

  it("gives each new order the next folio and keeps it on later saves", () => {
    let state = emptyState();
    state = applyBatch(
      state,
      saveOrder(state, meta("op-1", luis, "10:05"), {
        orderId: "o-1",
        header: mesa(3),
        lines: linesOf([americano]),
      }),
    );
    state = applyBatch(
      state,
      saveOrder(state, meta("op-2", sofi, "10:12"), {
        orderId: "o-2",
        header: mostrador,
        lines: linesOf([brownie]),
      }),
    );
    state = applyBatch(
      state,
      saveOrder(state, meta("op-3", sofi, "10:20"), {
        orderId: "o-1",
        header: mesa(3),
        lines: linesOf([americano], [brownie]),
      }),
    );
    expect(state.lastFolioNumber).toBe(2);
    expect(state.orders["o-2"].folio).toBe("A-0002");
    expect(state.orders["o-1"]).toMatchObject({
      folio: "A-0001",
      version: 2,
      openedAt: "2026-11-15T10:05:00.000-06:00",
      updatedAt: "2026-11-15T10:20:00.000-06:00",
    });
    const names = (actor: Actor) => actor.name;
    expect(names(state.orders["o-1"].openedBy)).toBe("Luis");
    expect(names(state.orders["o-1"].updatedBy)).toBe("Sofi");
    expect(state.orders["o-1"].lines.map((line) => line.name)).toEqual([
      "Americano",
      "Brownie",
    ]);
  });

  it("applies a retried command only once", () => {
    const batch = saveOrder(emptyState(), meta("op-1", luis), {
      orderId: "o-1",
      header: mostrador,
      lines: linesOf([americano]),
    });
    const once = applyBatch(emptyState(), batch);
    const twice = applyBatch(once, stored([batch])[0]);
    expect(twice).toBe(once);
    expect(replay([batch, batch, batch])).toEqual(once);
    expect(Object.keys(once.orders)).toEqual(["o-1"]);
    expect(once.lastFolioNumber).toBe(1);
  });

  it("refuses a command ID reused with different content", () => {
    const first = saveOrder(emptyState(), meta("op-1", luis), {
      orderId: "o-1",
      header: mostrador,
      lines: linesOf([americano]),
    });
    const state = applyBatch(emptyState(), first);
    const forged = saveOrder(emptyState(), meta("op-1", luis), {
      orderId: "o-1",
      header: mostrador,
      lines: linesOf([americano, 3]),
    });
    expect(() => applyBatch(state, forged)).toThrow(JournalConflictError);
    expect(state.orders["o-1"].lines[0].quantity).toBe(1);
  });

  it("never mutates the state or the batch it is given", () => {
    const state = emptyState();
    const batch = saveOrder(state, meta("op-1", luis), {
      orderId: "o-1",
      header: mesa(3),
      lines: linesOf([americano]),
    });
    const frozenBatch = structuredClone(batch);
    const next = applyBatch(state, batch);
    expect(state).toEqual(emptyState());
    expect(batch).toEqual(frozenBatch);
    // The order must not alias the batch: editing one leaves the other intact.
    next.orders["o-1"].lines[0].quantity = 99;
    expect(batch).toEqual(frozenBatch);
  });

  it("rejects saves that break the rules", () => {
    const state = emptyState();
    const input = {
      orderId: "o-1",
      header: mostrador,
      lines: linesOf([americano]),
    };
    expect(
      rejection(() =>
        saveOrder(
          state,
          meta("op-1", { userId: "x", name: "X", role: "invitado" as never }),
          input,
        ),
      ),
    ).toBe("not-allowed");
    expect(
      rejection(() =>
        saveOrder(state, meta("op-1", luis), { ...input, lines: [] }),
      ),
    ).toBe("empty-order");
    // All three roles may capture and save.
    expect(rejection(() => saveOrder(state, meta("op-1", sofi), input))).toBe(
      "not rejected",
    );
  });
});
