// @vitest-environment node
// Spec: Linear EVL-130, slice [A]. Test names are the scenario titles.
import { describe, expect, it } from "vitest";
import { closeSale } from "./checkout.ts";
import { saveOrder } from "./commands.ts";
import { applyBatch, emptyState } from "./journal.ts";
import type { CommandMeta, PosState } from "./journal.ts";
import type { PaymentInput } from "./payment.ts";
import { daySummary } from "./sales.ts";
import type { Product } from "./catalog.ts";
import {
  americano,
  brownie,
  catalog,
  linesOf,
  luis,
  meta,
  mostrador,
  sofi,
} from "./testing.ts";

function sale(
  state: PosState,
  orderId: string,
  item: Product,
  closing: CommandMeta,
  payment: PaymentInput,
  tipCents = 0,
): PosState {
  const open = applyBatch(
    state,
    saveOrder(
      state,
      { ...closing, commandId: `save-${orderId}`, actor: sofi },
      {
        orderId,
        header: mostrador,
        lines: linesOf([item]),
      },
    ),
  );
  return applyBatch(
    open,
    closeSale(
      open,
      closing,
      { orderId, tipCents, payment },
      catalog.taxRateBps,
    ),
  );
}

describe("EVL-130 [A] Ventas de hoy", () => {
  it("[A] La lista muestra las ventas cerradas hoy con sus totales", () => {
    // Dado tres ventas cerradas hoy: $50.00 en efectivo, $38.00 con tarjeta
    // con propina de $5.00 y $50.00 por transferencia, cuando abro Ventas de
    // hoy, entonces veo 3 ventas, $138.00 vendidos, $5.00 de propinas y los
    // cobros por método: efectivo $50.00, tarjeta $43.00, transferencia $50.00
    let state = emptyState();
    state = sale(state, "o-1", americano, meta("c-1", luis, "09:10"), {
      method: "cash",
      receivedCents: 10000,
    });
    state = sale(
      state,
      "o-2",
      brownie,
      meta("c-2", luis, "11:30"),
      { method: "card", receivedCents: 4300 },
      500,
    );
    state = sale(state, "o-3", americano, meta("c-3", luis, "13:45"), {
      method: "transfer",
      receivedCents: 5000,
    });

    const summary = daySummary(state, "2026-11-15");
    expect(summary.count).toBe(3);
    expect(summary.salesCents).toBe(13800);
    expect(summary.tipsCents).toBe(500);
    expect(summary.byMethod).toEqual({
      cash: 5000,
      card: 4300,
      transfer: 5000,
    });
    expect(summary.sales.map((order) => order.folio)).toEqual([
      "A-0003",
      "A-0002",
      "A-0001",
    ]);
  });

  it("[A] Las ventas de otros días y las cuentas abiertas no aparecen", () => {
    // Dado una venta cerrada ayer y una cuenta abierta hoy, cuando abro
    // Ventas de hoy, entonces la lista está vacía y los totales son $0.00
    let state = emptyState();
    state = sale(
      state,
      "o-1",
      americano,
      { ...meta("c-1", luis), at: "2026-11-14T23:59:00.000-06:00" },
      { method: "cash", receivedCents: 5000 },
    );
    state = applyBatch(
      state,
      saveOrder(state, meta("save-open", sofi, "10:00"), {
        orderId: "o-open",
        header: mostrador,
        lines: linesOf([brownie]),
      }),
    );
    expect(daySummary(state, "2026-11-15")).toEqual({
      sales: [],
      count: 0,
      salesCents: 0,
      tipsCents: 0,
      byMethod: { cash: 0, card: 0, transfer: 0 },
    });
    expect(daySummary(state, "2026-11-14").count).toBe(1);
  });
});
