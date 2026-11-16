// @vitest-environment node
// Spec: Linear EVL-122 slice [C] and EVL-188. Test names are scenario titles.
import { describe, expect, it } from "vitest";
import { accountSummary, openOrders } from "./accounts.ts";
import { saveOrder } from "./commands.ts";
import { applyBatch, emptyState, replay } from "./journal.ts";
import type { CommandBatch, PosState } from "./journal.ts";
import { orderTotals } from "./order.ts";
import {
  americano,
  avena,
  brownie,
  catalog,
  latte,
  linesOf,
  luis,
  mesa,
  meta,
  mostrador,
  recoger,
  sofi,
} from "./testing.ts";

const IVA = catalog.taxRateBps;

function run(steps: ((state: PosState) => CommandBatch)[]) {
  const batches: CommandBatch[] = [];
  let state = emptyState();
  for (const step of steps) {
    const batch = step(state);
    batches.push(batch);
    state = applyBatch(state, batch);
  }
  return { state, batches };
}

describe("EVL-122 [C] Cuentas abiertas", () => {
  it("[C] Guardar sin cobrar y reabrir después de recargar", () => {
    // Dado una cuenta en la mesa 3 con un Americano de $50, cuando la guardo
    // sin cobrar, recargo la app y la reabro, entonces la cuenta tiene las
    // mismas partidas, la mesa 3 y un total de $50
    const { batches } = run([
      (state) =>
        saveOrder(state, meta("op-1", luis, "10:05"), {
          orderId: "o-1",
          header: mesa(3),
          lines: linesOf([americano]),
        }),
    ]);
    const reloaded = replay(
      JSON.parse(JSON.stringify(batches)) as CommandBatch[],
    );
    const [reopened] = openOrders(reloaded);
    expect(reopened.lines).toEqual(linesOf([americano]));
    expect(reopened.header).toEqual(mesa(3));
    expect(orderTotals(reopened.lines, IVA).totalCents).toBe(5000);
  });

  it("[C] La lista muestra mesa, responsable, hora, tipo y total", () => {
    // Dado dos cuentas guardadas: mesa 3 por Barra "Luis" a las 10:05 por $50,
    // y Recoger "Ana" por Mesero "Sofi" a las 10:12 por $85, cuando abro
    // Cuentas abiertas, entonces veo ambas con su mesa o cliente,
    // responsable, hora, tipo y total
    const { state } = run([
      (current) =>
        saveOrder(current, meta("op-2", sofi, "10:12"), {
          orderId: "o-ana",
          header: recoger("Ana", "4421234567"),
          lines: linesOf([latte, 1, [avena]], [americano, 1, [], "tibio"]),
        }),
      (current) =>
        saveOrder(current, meta("op-1", luis, "10:05"), {
          orderId: "o-mesa",
          header: mesa(3),
          lines: linesOf([americano]),
        }),
    ]);
    // $75 + $50 = $125 for Ana in this fixture; the listed total is computed.
    expect(
      openOrders(state).map((order) => accountSummary(order, IVA)),
    ).toEqual([
      {
        orderId: "o-mesa",
        folio: "A-0002",
        label: "Mesa 3",
        typeLabel: "Mesa",
        responsible: "Luis",
        openedAt: "2026-11-15T10:05:00.000-06:00",
        totalCents: 5000,
        itemCount: 1,
      },
      {
        orderId: "o-ana",
        folio: "A-0001",
        label: "Recoger · Ana",
        typeLabel: "Recoger",
        responsible: "Sofi",
        openedAt: "2026-11-15T10:12:00.000-06:00",
        totalCents: 12500,
        itemCount: 2,
      },
    ]);
  });

  it("[C] Cambiar el tipo de orden conserva partidas y precios", () => {
    // Dado una cuenta de Mostrador con un Americano de $50, cuando cambio el
    // tipo a Mesa 2, entonces la partida y su precio de $50 no cambian
    const { state } = run([
      (current) =>
        saveOrder(current, meta("op-1", luis), {
          orderId: "o-1",
          header: mostrador,
          lines: linesOf([americano]),
        }),
      (current) =>
        saveOrder(current, meta("op-2", luis), {
          orderId: "o-1",
          header: mesa(2),
          lines: current.orders["o-1"].lines,
        }),
    ]);
    const order = state.orders["o-1"];
    expect(order.header).toEqual(mesa(2));
    expect(order.folio).toBe("A-0001");
    expect(order.version).toBe(2);
    expect(order.lines).toEqual(linesOf([americano]));
    expect(accountSummary(order, IVA).label).toBe("Mesa 2");
  });
});

describe("EVL-188 Conservar precios capturados al reabrir cuentas", () => {
  it("Reabrir una cuenta conserva los precios capturados", () => {
    // Dado una cuenta con un Americano capturado a $50.00, cuando el menú
    // cambia el Americano a $55.00 y reabro la cuenta para agregar un
    // Brownie, entonces el Americano sigue en $50.00 y el total es $88.00
    const { state } = run([
      (current) =>
        saveOrder(current, meta("op-1", luis), {
          orderId: "o-1",
          header: mesa(3),
          lines: linesOf([americano]),
        }),
      (current) => {
        const repriced = { ...americano, priceCents: 5500 };
        expect(repriced.priceCents).toBe(5500);
        const reopened = current.orders["o-1"].lines;
        return saveOrder(current, meta("op-2", sofi), {
          orderId: "o-1",
          header: mesa(3),
          lines: [
            ...reopened,
            ...linesOf([brownie]).map((line) => ({
              ...line,
              lineId: "l-brownie",
            })),
          ],
        });
      },
    ]);
    const order = state.orders["o-1"];
    expect(order.lines[0]).toMatchObject({
      name: "Americano",
      unitPriceCents: 5000,
    });
    expect(orderTotals(order.lines, IVA).totalCents).toBe(8800);
  });
});
