// @vitest-environment node
import { describe, expect, it } from "vitest";
import { can } from "./access.ts";
import { findProduct } from "./catalog.ts";
import type { Catalog, Product } from "./catalog.ts";
import { closeSale } from "./checkout.ts";
import { saveOrder } from "./commands.ts";
import { applyBatch, emptyState, replay } from "./journal.ts";
import type { Actor, CommandBatch, CommandMeta, PosState } from "./journal.ts";
import {
  editLabel,
  lastEdit,
  menuFor,
  setProductAvailability,
  setProductPrice,
} from "./menu.ts";
import { parsePesos } from "./money.ts";
import { OrderError, addLine } from "./order.ts";
import { daySummary } from "./sales.ts";
import {
  admin,
  americano,
  catalog,
  latte,
  linesOf,
  luis,
  mostrador,
  product,
  rejectionOf,
  sofi,
} from "./testing.ts";

const croissant = product("52000822188");

function at(commandId: string, actor: Actor, time: string): CommandMeta {
  return {
    commandId,
    at: `2026-11-17T${time}:00.000-06:00`,
    actor,
    deviceId: "caja-1",
  };
}

function run(
  state: PosState,
  decide: (state: PosState) => CommandBatch,
): PosState {
  return applyBatch(state, decide(state));
}

function inMenu(state: PosState, item: Product): Product {
  const found = findProduct(menuFor(catalog, state.menu), item.id);
  if (!found) throw new Error(`No product ${item.id} in the menu`);
  return found;
}

function priceOf(
  state: PosState,
  item: Product,
  cents: number,
  time = "18:40",
) {
  return run(state, (current) =>
    setProductPrice(
      current,
      at(`price-${item.id}-${cents}`, admin, time),
      { productId: item.id, priceCents: cents },
      catalog,
    ),
  );
}

function availability(
  state: PosState,
  actor: Actor,
  available: boolean,
  time = "19:05",
) {
  return run(state, (current) =>
    setProductAvailability(
      current,
      at(`available-${croissant.id}-${available}-${time}`, actor, time),
      { productId: croissant.id, available },
      catalog,
    ),
  );
}

describe("EVL-119 [A] Precio y Agotado", () => {
  it("[A] Admin cambia el precio de un producto", () => {
    expect(latte.priceCents).toBe(6500);
    const batch = setProductPrice(
      emptyState(),
      at("price-1", admin, "18:40"),
      { productId: latte.id, priceCents: 7000 },
      catalog,
    );
    expect(batch.events).toEqual([
      {
        type: "product-updated",
        productId: "52000822148",
        changes: { priceCents: 7000 },
      },
    ]);
    const state = applyBatch(emptyState(), batch);
    const updated = inMenu(state, latte);
    expect(updated.priceCents).toBe(7000);
    expect(updated.name).toBe("Latte");
    expect(updated.modifierGroupIds).toEqual(["leche", "shot"]);
    expect(addLine([], updated, { lineId: "l1" })[0].unitPriceCents).toBe(7000);
    expect(findProduct(catalog, latte.id)?.priceCents).toBe(6500);
    expect(inMenu(state, americano).priceCents).toBe(5000);
    expect(replay([batch])).toEqual(state);
  });

  it("[A] El cambio de precio no toca cuentas ya capturadas", () => {
    let state = run(emptyState(), (current) =>
      saveOrder(current, at("save-1", luis, "10:00"), {
        orderId: "o-1",
        header: mostrador,
        lines: linesOf([latte]),
      }),
    );
    state = run(state, (current) =>
      saveOrder(current, at("save-2", luis, "10:05"), {
        orderId: "o-2",
        header: mostrador,
        lines: linesOf([americano]),
      }),
    );
    state = run(state, (current) =>
      closeSale(
        current,
        at("pay-2", luis, "10:10"),
        {
          orderId: "o-2",
          tipCents: 0,
          payment: { method: "cash", receivedCents: 5000 },
        },
        catalog.taxRateBps,
      ),
    );
    const before = daySummary(state, "2026-11-17");

    state = priceOf(state, latte, 7000);
    state = priceOf(state, americano, 5500);

    expect(state.orders["o-1"].folio).toBe("A-0001");
    expect(state.orders["o-1"].lines[0].unitPriceCents).toBe(6500);
    expect(state.orders["o-2"].sale?.totals.totalCents).toBe(5000);
    expect(daySummary(state, "2026-11-17")).toEqual(before);
    expect(inMenu(state, latte).priceCents).toBe(7000);
    expect(inMenu(state, americano).priceCents).toBe(5500);
  });

  it("[A] Barra marca un producto como agotado y lo vuelve a habilitar", () => {
    expect(croissant.name).toBe("Croissant Dulce");
    const sold = availability(emptyState(), luis, false);
    expect(inMenu(sold, croissant).available).toBe(false);
    expect(() =>
      addLine([], inMenu(sold, croissant), { lineId: "l1" }),
    ).toThrow(OrderError);

    const back = availability(sold, luis, true, "19:30");
    expect(inMenu(back, croissant).available).toBe(true);
    expect(addLine([], inMenu(back, croissant), { lineId: "l1" })[0].name).toBe(
      "Croissant Dulce",
    );
    expect(inMenu(back, croissant).priceCents).toBe(croissant.priceCents);
  });

  it("[A] Un precio inválido no se guarda", () => {
    expect(["0", "", "abc", "12.345"].map(parsePesos)).toEqual([
      0,
      null,
      null,
      null,
    ]);
    for (const priceCents of [
      0,
      -100,
      12.5,
      Number.NaN,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        rejectionOf(() =>
          setProductPrice(
            emptyState(),
            at("bad", admin, "18:40"),
            { productId: latte.id, priceCents },
            catalog,
          ),
        ),
      ).toBe("invalid-price");
    }
    expect(inMenu(emptyState(), latte).priceCents).toBe(6500);
  });

  it("[A] Solo Admin cambia precios y Mesero no ve Menú", () => {
    for (const actor of [luis, sofi]) {
      expect(
        rejectionOf(() =>
          setProductPrice(
            emptyState(),
            at("price", actor, "18:40"),
            { productId: latte.id, priceCents: 7000 },
            catalog,
          ),
        ),
      ).toBe("not-allowed");
    }
    expect(
      rejectionOf(() =>
        setProductAvailability(
          emptyState(),
          at("sold-out", sofi, "18:40"),
          { productId: croissant.id, available: false },
          catalog,
        ),
      ),
    ).toBe("not-allowed");
    expect(can("barra", "set-availability")).toBe(true);
    expect(can("barra", "edit-menu")).toBe(false);
    expect(can("mesero", "set-availability")).toBe(false);
    expect(can("mesero", "edit-menu")).toBe(false);
  });

  it("[A] El producto muestra quién lo editó y cuándo", () => {
    expect(lastEdit(emptyState().menu, latte.id)).toBeNull();
    const priced = priceOf(emptyState(), latte, 7000, "18:40");
    const edit = lastEdit(priced.menu, latte.id);
    expect(edit).toEqual({ at: "2026-11-17T18:40:00.000-06:00", by: admin });
    expect(editLabel(edit!)).toBe("Editado por Admin · 17 nov, 18:40");
    expect(lastEdit(priced.menu, americano.id)).toBeNull();

    const both = run(priced, (current) =>
      setProductAvailability(
        current,
        at("sold-out-latte", luis, "19:05"),
        { productId: latte.id, available: false },
        catalog,
      ),
    );
    expect(editLabel(lastEdit(both.menu, latte.id)!)).toBe(
      "Editado por Luis · 17 nov, 19:05",
    );
    expect(inMenu(both, latte)).toMatchObject({
      priceCents: 7000,
      available: false,
    });
    expect(editLabel({ at: "2026-01-05T08:07:00.000-06:00", by: admin })).toBe(
      "Editado por Admin · 5 ene, 08:07",
    );
  });
});

describe("EVL-119 [A] Menú sobre el menú base", () => {
  it("rejects edits to a product that is not in the menu", () => {
    expect(
      rejectionOf(() =>
        setProductPrice(
          emptyState(),
          at("ghost", admin, "18:40"),
          { productId: "52000822999", priceCents: 7000 },
          catalog,
        ),
      ),
    ).toBe("unknown-product");
    expect(
      rejectionOf(() =>
        setProductAvailability(
          emptyState(),
          at("ghost", luis, "18:40"),
          { productId: "52000822999", available: false },
          catalog,
        ),
      ),
    ).toBe("unknown-product");
  });

  it("keeps base changes to fields nobody edited and ignores removed products", () => {
    const state = priceOf(emptyState(), latte, 7000);
    const renamedBase: Catalog = {
      ...catalog,
      products: catalog.products
        .filter((item) => item.id !== americano.id)
        .map((item) =>
          item.id === latte.id ? { ...item, name: "Latté" } : item,
        ),
    };
    const stateWithAmericano = priceOf(state, americano, 5500);
    const merged = menuFor(renamedBase, stateWithAmericano.menu);
    expect(findProduct(merged, latte.id)).toMatchObject({
      name: "Latté",
      priceCents: 7000,
    });
    expect(findProduct(merged, americano.id)).toBeUndefined();
    expect(merged.products).toHaveLength(renamedBase.products.length);
    expect(menuFor(catalog, emptyState().menu)).toEqual(catalog);
  });

  it("adds a product at its new price as a separate line after a price change", () => {
    const captured = linesOf([latte]);
    const state = priceOf(emptyState(), latte, 7000);
    const next = addLine(captured, inMenu(state, latte), { lineId: "l2" });
    expect(next.map((line) => [line.unitPriceCents, line.quantity])).toEqual([
      [6500, 1],
      [7000, 1],
    ]);
    expect(
      addLine(next, inMenu(state, latte), { lineId: "l3" }).map(
        (line) => line.quantity,
      ),
    ).toEqual([1, 2]);
  });

  it("does not duplicate an edit when the same command is applied twice", () => {
    const batch = setProductPrice(
      emptyState(),
      at("price-1", admin, "18:40"),
      { productId: latte.id, priceCents: 7000 },
      catalog,
    );
    const once = applyBatch(emptyState(), batch);
    expect(applyBatch(once, batch)).toBe(once);
    expect(replay([batch, batch])).toEqual(once);
  });
});
