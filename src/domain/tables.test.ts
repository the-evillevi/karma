// @vitest-environment node
// Spec: Linear EVL-122, slice [A]. Test names are the scenario titles.
import { describe, expect, it } from "vitest";
import { saveOrder } from "./commands.ts";
import { applyBatch, emptyState, replay } from "./journal.ts";
import type { PosState } from "./journal.ts";
import { configureTables, tableLabel, tableNumbers } from "./tables.ts";
import {
  admin,
  americano,
  linesOf,
  luis,
  mesa,
  meta,
  mostrador,
  rejectionOf,
  sofi,
} from "./testing.ts";

function withTables(count: number, state: PosState = emptyState()): PosState {
  return applyBatch(
    state,
    configureTables(state, meta(`tables-${count}`, admin), { count }),
  );
}

describe("EVL-122 [A] Mesas", () => {
  it("[A] Admin configura la cantidad de mesas", () => {
    // Dado un Admin y 8 mesas configuradas, cuando cambia la cantidad a 10,
    // entonces las mesas 1–10 están disponibles para asignar
    const initial = emptyState();
    expect(tableNumbers(initial)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const batch = configureTables(initial, meta("op-1", admin), { count: 10 });
    expect(batch.events).toEqual([{ type: "tables-configured", count: 10 }]);
    const state = applyBatch(initial, batch);
    expect(state.tableCount).toBe(10);
    expect(tableNumbers(state)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(replay([batch])).toEqual(state);
    expect(
      rejectionOf(() =>
        saveOrder(state, meta("op-2", luis), {
          orderId: "o-1",
          header: mesa(10),
          lines: linesOf([americano]),
        }),
      ),
    ).toBe("not rejected");
  });

  it("[A] Reducir mesas conserva referencias históricas", () => {
    // Dado una cuenta en la mesa 10 y 10 mesas configuradas, cuando un Admin
    // reduce la cantidad a 8, entonces la mesa 10 ya no se puede asignar y la
    // cuenta existente sigue mostrando "Mesa 10"
    let state = withTables(10);
    state = applyBatch(
      state,
      saveOrder(state, meta("op-1", luis), {
        orderId: "o-1",
        header: mesa(10),
        lines: linesOf([americano]),
      }),
    );
    state = withTables(8, state);

    expect(tableNumbers(state)).not.toContain(10);
    expect(state.orders["o-1"].header.table).toBe(10);
    expect(tableLabel(state.orders["o-1"].header.table)).toBe("Mesa 10");
    expect(
      rejectionOf(() =>
        saveOrder(state, meta("op-2", luis), {
          orderId: "o-2",
          header: mesa(10),
          lines: linesOf([americano]),
        }),
      ),
    ).toBe("table-unavailable");
    // The existing account can still be saved again on its own table.
    expect(
      rejectionOf(() =>
        saveOrder(state, meta("op-3", luis), {
          orderId: "o-1",
          header: mesa(10),
          lines: linesOf([americano, 2]),
        }),
      ),
    ).toBe("not rejected");
  });

  it("[A] La mesa es opcional", () => {
    // Dado una venta en caja sin mesa, cuando Barra la guarda, entonces se
    // guarda sin mesa y se identifica por folio
    const state = emptyState();
    const next = applyBatch(
      state,
      saveOrder(state, meta("op-1", luis), {
        orderId: "o-1",
        header: mostrador,
        lines: linesOf([americano]),
      }),
    );
    expect(next.orders["o-1"].header.table).toBeNull();
    expect(next.orders["o-1"].folio).toBe("A-0001");
    expect(tableLabel(null)).toBe("");
    // An order of type "mesa" does need its table, and it must exist.
    const save = (header: ReturnType<typeof mesa>) =>
      rejectionOf(() =>
        saveOrder(state, meta("op-2", luis), {
          orderId: "o-2",
          header,
          lines: linesOf([americano]),
        }),
      );
    expect(save({ ...mesa(1), table: null })).toBe("table-required");
    expect(save(mesa(0))).toBe("table-unavailable");
    expect(save(mesa(9))).toBe("table-unavailable");
    expect(save(mesa(2.5))).toBe("table-unavailable");
    expect(save(mesa(8))).toBe("not rejected");
  });

  it("[A] Barra y Mesero no configuran mesas", () => {
    // Dado un usuario Barra o Mesero, cuando intenta cambiar la cantidad de
    // mesas, entonces la operación se rechaza y la cantidad no cambia
    const state = emptyState();
    for (const actor of [luis, sofi]) {
      expect(
        rejectionOf(() =>
          configureTables(state, meta("op-1", actor), { count: 10 }),
        ),
      ).toBe("not-allowed");
    }
    expect(state.tableCount).toBe(8);
    for (const count of [-1, 2.5, 100, Number.NaN]) {
      expect(
        rejectionOf(() =>
          configureTables(state, meta("op-1", admin), { count }),
        ),
      ).toBe("invalid-table-count");
    }
    expect(tableNumbers(withTables(0))).toEqual([]);
  });
});
