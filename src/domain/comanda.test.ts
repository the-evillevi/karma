// @vitest-environment node
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
import { resolveModifiers } from "./modifiers.ts";
import { addLine, lineUnitCents } from "./order.ts";
import type { OrderLine } from "./order.ts";
import {
  amareto,
  brownie,
  catalog,
  latte,
  linesOf,
  luis,
  mesa,
  meta,
  product,
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

const latteAmareto = () => linesOf([latte, 1, [amareto], "extra caliente"]);

describe("EVL-124 [A] Comandas", () => {
  it("[A] La comanda copia las partidas sin precios", () => {
    const state = sent(saved(emptyState(), latteAmareto()), "c-1");
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
          modifiers: ["Amareto"],
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
    let state = sent(saved(emptyState(), latteAmareto()), "c-1");
    const first = state.comandas["c-1"];
    const grown: OrderLine[] = [
      { ...latteAmareto()[0], quantity: 2 },
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
    const state = sent(saved(emptyState(), latteAmareto()), "c-1");
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
    const two: OrderLine[] = [{ ...latteAmareto()[0], quantity: 2 }];
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
    expect(resave([{ ...two[0], note: "frío" }])).toBe("sent-to-kitchen");
    expect(resave([{ ...two[0], modifiers: [] }])).toBe("sent-to-kitchen");
    expect(resave([{ ...two[0], quantity: 3 }])).toBe("not rejected");
  });

  it("[A] La preparación avanza un paso a la vez", () => {
    let state = sent(saved(emptyState(), latteAmareto()), "c-1");
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
    const before = saved(emptyState(), latteAmareto());
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
    let state = saved(emptyState(), latteAmareto());
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

describe("EVL-112 [D] Respuestas de Carlos en la comanda", () => {
  it("[D] El aderezo de cortesía aparece en la comanda", () => {
    const crepa = product("52000822208");
    const lines = addLine([], crepa, {
      lineId: "l1",
      modifiers: resolveModifiers(catalog, crepa, {
        acompanamiento: ["papas"],
        "aderezo-incluido": ["ranch"],
      }),
    });
    const state = sent(saved(emptyState(), lines), "c-1");
    expect(state.comandas["c-1"].lines[0]).toMatchObject({
      name: "Crepa de Pollo",
      modifiers: ["Papas", "Ranch"],
    });
    expect(lineUnitCents(state.orders["o-1"].lines[0])).toBe(6000);
  });
});
