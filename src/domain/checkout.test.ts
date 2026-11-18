// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PAYMENT_METHOD_LABELS, closeSale, closedSales } from "./checkout.ts";
import { pendingComandas, sendComanda } from "./comanda.ts";
import { saveOrder } from "./commands.ts";
import { applyBatch, emptyState, replay } from "./journal.ts";
import type { CommandBatch, PosState } from "./journal.ts";
import { PaymentRejectedError } from "./payment.ts";
import {
  admin,
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
  rejectionOf,
  sofi,
} from "./testing.ts";

const IVA = catalog.taxRateBps;

function fifty(orderId = "o-1"): { state: PosState; batches: CommandBatch[] } {
  const batch = saveOrder(emptyState(), meta("save-1", sofi, "10:00"), {
    orderId,
    header: mostrador,
    lines: linesOf([americano]),
  });
  return { state: applyBatch(emptyState(), batch), batches: [batch] };
}

describe("EVL-123 [C] Tarjeta manual y transferencia sin conexión", () => {
  it("[C] Tarjeta manual sin conexión", () => {
    const { state } = fifty();
    const batch = closeSale(
      state,
      meta("op-1", luis),
      {
        orderId: "o-1",
        tipCents: 0,
        payment: { method: "card", receivedCents: 5000 },
      },
      IVA,
    );
    const sale = applyBatch(state, batch).orders["o-1"].sale;
    expect(sale?.settlement.method).toBe("card");
    expect(PAYMENT_METHOD_LABELS.card).toBe("Tarjeta manual");
  });

  it("[C] Transferencia sin conexión", () => {
    const { state } = fifty();
    const next = applyBatch(
      state,
      closeSale(
        state,
        meta("op-1", luis),
        {
          orderId: "o-1",
          tipCents: 0,
          payment: { method: "transfer", receivedCents: 5000 },
        },
        IVA,
      ),
    );
    expect(next.orders["o-1"].status).toBe("paid");
    expect(PAYMENT_METHOD_LABELS.transfer).toBe("Transferencia");
    expect(PAYMENT_METHOD_LABELS.cash).toBe("Efectivo");
  });
});

describe("EVL-123 [D] Cierre de la venta", () => {
  it("refuses to close an account that changed since it was previewed", () => {
    const { state } = fifty();
    const changed = applyBatch(
      state,
      saveOrder(state, meta("edit", luis), {
        orderId: "o-1",
        header: mostrador,
        lines: linesOf([americano, 2]),
      }),
    );
    const input = {
      orderId: "o-1",
      expectedVersion: 1,
      tipCents: 0,
      payment: { method: "cash" as const, receivedCents: 10000 },
    };
    expect(() =>
      closeSale(changed, meta("close-old", luis), input, IVA),
    ).toThrow(expect.objectContaining({ reason: "account-changed" }));
    expect(changed.orders["o-1"].status).toBe("open");
    expect(() =>
      closeSale(
        changed,
        meta("close-current", luis),
        { ...input, expectedVersion: 2 },
        IVA,
      ),
    ).not.toThrow();
  });

  it("[D] El cierre conserva pagos, propina y cambio", () => {
    const { state, batches } = fifty();
    const close = closeSale(
      state,
      meta("op-2", luis, "10:30"),
      {
        orderId: "o-1",
        tipCents: 0,
        payment: { method: "cash", receivedCents: 10000 },
      },
      IVA,
    );
    const reloaded = replay(
      JSON.parse(JSON.stringify([...batches, close])) as CommandBatch[],
    );
    const order = reloaded.orders["o-1"];
    expect(order.status).toBe("paid");
    expect(order.sale).toEqual({
      closedAt: "2026-11-15T10:30:00.000-06:00",
      closedBy: luis,
      tipCents: 0,
      settlement: {
        method: "cash",
        amountDueCents: 5000,
        receivedCents: 10000,
        changeCents: 5000,
        netCents: 5000,
        pendingCents: 0,
        canConfirm: true,
      },
      totals: { itemCount: 1, totalCents: 5000, netCents: 4310, taxCents: 690 },
    });
    expect(closedSales(reloaded).map((sale) => sale.folio)).toEqual(["A-0001"]);
  });

  it("charges the order plus tip and keeps the tip apart", () => {
    let state = applyBatch(
      emptyState(),
      saveOrder(emptyState(), meta("save-1", sofi), {
        orderId: "o-1",
        header: mesa(3),
        lines: linesOf([latte, 1, [avena]], [brownie]),
      }),
    );
    state = applyBatch(
      state,
      closeSale(
        state,
        meta("op-2", luis),
        {
          orderId: "o-1",
          tipCents: 1130,
          payment: { method: "cash", receivedCents: 15000 },
        },
        IVA,
      ),
    );
    expect(state.orders["o-1"].sale).toMatchObject({
      tipCents: 1130,
      settlement: {
        amountDueCents: 12430,
        receivedCents: 15000,
        changeCents: 2570,
        netCents: 12430,
      },
      totals: { totalCents: 11300, netCents: 9741, taxCents: 1559 },
    });
  });

  it("[D] Una venta cerrada no se puede volver a cobrar", () => {
    const { state } = fifty();
    const input = {
      orderId: "o-1",
      tipCents: 0,
      payment: { method: "cash" as const, receivedCents: 5000 },
    };
    const closed = applyBatch(
      state,
      closeSale(state, meta("op-2", luis), input, IVA),
    );
    expect(
      rejectionOf(() => closeSale(closed, meta("op-3", luis), input, IVA)),
    ).toBe("order-closed");
    expect(
      rejectionOf(() =>
        saveOrder(closed, meta("op-4", luis), {
          orderId: "o-1",
          header: mostrador,
          lines: linesOf([americano, 2]),
        }),
      ),
    ).toBe("order-closed");
    expect(closed.orders["o-1"].sale?.settlement.netCents).toBe(5000);
    expect(closedSales(closed)).toHaveLength(1);
  });

  it("[D] Mesero no cobra", () => {
    const { state } = fifty();
    const input = {
      orderId: "o-1",
      tipCents: 0,
      payment: { method: "cash" as const, receivedCents: 5000 },
    };
    expect(
      rejectionOf(() => closeSale(state, meta("op-2", sofi), input, IVA)),
    ).toBe("not-allowed");
    expect(
      rejectionOf(() => closeSale(state, meta("op-2", admin), input, IVA)),
    ).toBe("not rejected");
    expect(state.orders["o-1"].status).toBe("open");
  });

  it("refuses to close with a pending balance or bad amounts", () => {
    const { state } = fifty();
    const attempt = (tipCents: number, method: "cash" | "card", paid: number) =>
      rejectionOf(() =>
        closeSale(
          state,
          meta("op-2", luis),
          {
            orderId: "o-1",
            tipCents,
            payment: { method, receivedCents: paid },
          },
          IVA,
        ),
      );
    expect(attempt(0, "card", 4000)).toBe("pending-balance");
    expect(attempt(500, "cash", 5000)).toBe("pending-balance");
    expect(attempt(-1, "cash", 5000)).toBe("invalid-tip");
    expect(attempt(1.5, "cash", 5000)).toBe("invalid-tip");
    expect(
      rejectionOf(() =>
        closeSale(
          state,
          meta("op-2", luis),
          {
            orderId: "nope",
            tipCents: 0,
            payment: { method: "cash", receivedCents: 5000 },
          },
          IVA,
        ),
      ),
    ).toBe("unknown-order");
    expect(() =>
      closeSale(
        state,
        meta("op-2", luis),
        {
          orderId: "o-1",
          tipCents: 0,
          payment: { method: "card", receivedCents: 9000 },
        },
        IVA,
      ),
    ).toThrow(PaymentRejectedError);
  });
});

describe("EVL-185 Conservar comandas pendientes después del cobro", () => {
  it("Cobrar no elimina la comanda pendiente", () => {
    let { state } = fifty();
    state = applyBatch(
      state,
      sendComanda(state, meta("send-1", sofi, "10:05"), {
        orderId: "o-1",
        comandaId: "c-1",
      }),
    );
    state = applyBatch(
      state,
      closeSale(
        state,
        meta("op-2", luis, "10:06"),
        {
          orderId: "o-1",
          tipCents: 0,
          payment: { method: "cash", receivedCents: 5000 },
        },
        IVA,
      ),
    );
    expect(state.orders["o-1"].status).toBe("paid");
    expect(state.comandas["c-1"].status).toBe("queued");
    expect(pendingComandas(state).map((comanda) => comanda.comandaId)).toEqual([
      "c-1",
    ]);
  });
});
