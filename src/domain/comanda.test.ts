// @vitest-environment node
// Spec: Linear EVL-124, slice [A]. Test names are the scenario titles.
import { describe, expect, it } from "vitest";
import {
  advancePreparation,
  hasUnsentLines,
  nextPreparationStatus,
  pendingComandas,
  sendComanda,
} from "./comanda.ts";
import { saveOrder } from "./commands.ts";
import { applyBatch, emptyState } from "./journal.ts";
import type { CommandBatch, OrderHeader, PosState } from "./journal.ts";
import type { OrderLine } from "./order.ts";
import {
  avena,
  brownie,
  latte,
  linesOf,
  luis,
  mesa,
  meta,
  recoger,
  rejectionOf,
  sofi,
} from "./testing.ts";

let counter = 0;
function id(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function saved(
  state: PosState,
  lines: OrderLine[],
  orderId = "o-1",
  header: OrderHeader = mesa(3),
  time = "10:00",
): PosState {
  return applyBatch(
    state,
    saveOrder(state, meta(id("save"), sofi, time), { orderId, header, lines }),
  );
}

function sent(
  state: PosState,
  comandaId: string,
  orderId = "o-1",
  time = "10:05",
): PosState {
  return applyBatch(
    state,
    sendComanda(state, meta(id("send"), sofi, time), { orderId, comandaId }),
  );
}

const latteAvena = () => linesOf([latte, 1, [avena], "extra caliente"]);

describe("EVL-124 [A] Comandas", () => {
  it("[A] La comanda copia las partidas sin precios", () => {
    // Dado la cuenta A-0001 en la mesa 3 con 1 Latte con Avena y la nota
    // "extra caliente", cuando envío la comanda, entonces muestra folio
    // A-0001, Mesa 3, 1 Latte, "Avena" y "extra caliente", queda "En cola"
    // y no incluye precios
    const state = sent(saved(emptyState(), latteAvena()), "c-1");
    expect(state.comandas["c-1"]).toEqual({
      comandaId: "c-1",
      orderId: "o-1",
      folio: "A-0001",
      header: mesa(3),
      lines: [
        {
          lineId: "l1",
          name: "Latte",
          quantity: 1,
          modifiers: ["Avena"],
          note: "extra caliente",
        },
      ],
      status: "queued",
      sentAt: "2026-11-15T10:05:00.000-06:00",
      sentBy: sofi,
      updatedAt: "2026-11-15T10:05:00.000-06:00",
    });
    expect(JSON.stringify(state.comandas["c-1"])).not.toMatch(/Cents/);
    expect(state.orders["o-1"].sentQuantities).toEqual({ l1: 1 });
    expect(hasUnsentLines(state, "o-1")).toBe(false);
  });

  it("[A] Enviar de nuevo sólo manda lo nuevo", () => {
    // Dado la cuenta A-0001 con 1 Latte ya enviado, cuando agrego 1 Brownie,
    // subo el Latte a 2 y envío la comanda, entonces se crea una segunda
    // comanda con 1 Brownie y 1 Latte, y la primera no cambia
    let state = sent(saved(emptyState(), latteAvena()), "c-1");
    const first = state.comandas["c-1"];
    const grown: OrderLine[] = [
      { ...latteAvena()[0], quantity: 2 },
      { ...linesOf([brownie])[0], lineId: "l2" },
    ];
    state = saved(state, grown);
    expect(hasUnsentLines(state, "o-1")).toBe(true);
    state = sent(state, "c-2", "o-1", "10:20");

    expect(state.comandas["c-1"]).toEqual(first);
    expect(
      state.comandas["c-2"].lines.map((line) => [line.name, line.quantity]),
    ).toEqual([
      ["Latte", 1],
      ["Brownie", 1],
    ]);
    expect(state.orders["o-1"].sentQuantities).toEqual({ l1: 2, l2: 1 });
  });

  it("[A] Sin productos nuevos no hay comanda", () => {
    // Dado la cuenta con todo ya enviado, cuando intento enviar la comanda,
    // entonces se rechaza indicando que no hay productos nuevos
    const state = sent(saved(emptyState(), latteAvena()), "c-1");
    expect(
      rejectionOf(() =>
        sendComanda(state, meta("op-x", sofi), {
          orderId: "o-1",
          comandaId: "c-2",
        }),
      ),
    ).toBe("nothing-new");
    expect(
      rejectionOf(() =>
        sendComanda(state, meta("op-x", sofi), {
          orderId: "nope",
          comandaId: "c-2",
        }),
      ),
    ).toBe("unknown-order");
  });

  it("[A] Lo enviado a cocina no se quita desde la estación", () => {
    // Dado la cuenta con 2 Lattes ya enviados, cuando intento bajar la
    // cantidad a 1 o eliminar la partida, entonces se rechaza porque quitar
    // lo enviado es una cancelación con motivo
    const two: OrderLine[] = [{ ...latteAvena()[0], quantity: 2 }];
    const state = sent(saved(emptyState(), two), "c-1");
    const resave = (lines: OrderLine[]) =>
      rejectionOf(() =>
        saveOrder(state, meta("op-x", luis), {
          orderId: "o-1",
          header: mesa(3),
          lines,
        }),
      );
    expect(resave([{ ...two[0], quantity: 1 }])).toBe("sent-to-kitchen");
    expect(resave([{ ...linesOf([brownie])[0], lineId: "l9" }])).toBe(
      "sent-to-kitchen",
    );
    // Changing what the kitchen was already told to make is also refused.
    expect(resave([{ ...two[0], note: "frío" }])).toBe("sent-to-kitchen");
    expect(resave([{ ...two[0], modifiers: [] }])).toBe("sent-to-kitchen");
    // Adding more is fine.
    expect(resave([{ ...two[0], quantity: 3 }])).toBe("not rejected");
  });

  it("[A] La preparación avanza un paso a la vez", () => {
    // Dado una comanda "En cola", cuando cocina la marca como empezada, lista
    // y entregada, entonces pasa por "Preparando", "Lista" y "Entregada", y
    // no puede saltar de "En cola" a "Lista"
    let state = sent(saved(emptyState(), latteAvena()), "c-1");
    expect(
      rejectionOf(() =>
        advancePreparation(state, meta("op-x", sofi), {
          comandaId: "c-1",
          to: "ready",
        }),
      ),
    ).toBe("invalid-preparation-step");
    const seen: string[] = [];
    for (const [to, time] of [
      ["preparing", "10:06"],
      ["ready", "10:10"],
      ["served", "10:12"],
    ] as const) {
      state = applyBatch(
        state,
        advancePreparation(state, meta(id("adv"), luis, time), {
          comandaId: "c-1",
          to,
        }),
      );
      seen.push(state.comandas["c-1"].status);
    }
    expect(seen).toEqual(["preparing", "ready", "served"]);
    expect(state.comandas["c-1"].updatedAt).toBe(
      "2026-11-15T10:12:00.000-06:00",
    );
    expect(nextPreparationStatus("queued")).toBe("preparing");
    expect(nextPreparationStatus("served")).toBeNull();
    expect(
      rejectionOf(() =>
        advancePreparation(state, meta("op-x", sofi), {
          comandaId: "c-1",
          to: "served",
        }),
      ),
    ).toBe("comanda-finished");
    expect(
      rejectionOf(() =>
        advancePreparation(state, meta("op-x", sofi), {
          comandaId: "nope",
          to: "preparing",
        }),
      ),
    ).toBe("unknown-comanda");
  });

  it("[A] Reintentar el envío no duplica la comanda", () => {
    // Dado una comanda enviada con el identificador op-200, cuando el mismo
    // envío op-200 se repite, entonces sigue habiendo una sola comanda
    const before = saved(emptyState(), latteAvena());
    const batch: CommandBatch = sendComanda(before, meta("op-200", sofi), {
      orderId: "o-1",
      comandaId: "c-1",
    });
    const once = applyBatch(before, batch);
    expect(applyBatch(once, batch)).toBe(once);
    expect(Object.keys(once.comandas)).toEqual(["c-1"]);
    expect(once.orders["o-1"].sentQuantities).toEqual({ l1: 1 });
  });

  it("lists pending comandas from oldest to newest", () => {
    let state = saved(emptyState(), latteAvena());
    state = saved(
      state,
      linesOf([brownie]),
      "o-2",
      recoger("Ana", "4421234567"),
    );
    state = sent(state, "c-ana", "o-2", "10:12");
    state = sent(state, "c-mesa", "o-1", "10:05");
    expect(pendingComandas(state).map((comanda) => comanda.comandaId)).toEqual([
      "c-mesa",
      "c-ana",
    ]);
    for (const to of ["preparing", "ready", "served"] as const) {
      state = applyBatch(
        state,
        advancePreparation(state, meta(id("adv"), luis), {
          comandaId: "c-mesa",
          to,
        }),
      );
    }
    expect(pendingComandas(state).map((comanda) => comanda.folio)).toEqual([
      "A-0002",
    ]);
  });
});
