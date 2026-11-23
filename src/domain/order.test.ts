// @vitest-environment node
import { describe, expect, it } from "vitest";
import rawCatalog from "../../catalog/catalog.json";
import { findProduct, parseCatalog } from "./catalog.ts";
import type { Product } from "./catalog.ts";
import { formatMXN, taxBreakdown } from "./money.ts";
import {
  OrderError,
  addLine,
  changeQuantity,
  lineTotalCents,
  lineUnitCents,
  orderTotals,
  removeLine,
} from "./order.ts";
import type { LineModifier, OrderLine, OrderRejection } from "./order.ts";

const catalog = parseCatalog(rawCatalog);
const IVA = catalog.taxRateBps;

function product(sku: string): Product {
  const found = findProduct(catalog, sku);
  if (!found) throw new Error(`No product ${sku}`);
  return found;
}

const americano = product("52000822146");
const latte = product("52000822148");
const brownie = product("52000822189");

const entera: LineModifier = {
  groupId: "leche",
  groupName: "Tipo de leche",
  optionId: "entera",
  name: "Entera",
  priceDeltaCents: 0,
};
const amareto: LineModifier = {
  groupId: "shot",
  groupName: "Shot de sabor",
  optionId: "amareto",
  name: "Amareto",
  priceDeltaCents: 1000,
};
const vainilla: LineModifier = {
  groupId: "shot",
  groupName: "Shot de sabor",
  optionId: "vainilla",
  name: "Vainilla",
  priceDeltaCents: 1000,
};

function rejection(action: () => unknown): OrderRejection | "not rejected" {
  try {
    action();
  } catch (error) {
    if (error instanceof OrderError) return error.reason;
    throw error;
  }
  return "not rejected";
}

describe("EVL-121 [A] Partidas y totales", () => {
  it("[A] Agregar un producto crea una partida", () => {
    const lines = addLine([], americano, { lineId: "l1" });
    expect(lines).toEqual<OrderLine[]>([
      {
        lineId: "l1",
        productId: "52000822146",
        name: "Americano",
        unitPriceCents: 5000,
        modifiers: [],
        note: "",
        quantity: 1,
      },
    ]);
    expect(orderTotals(lines, IVA).totalCents).toBe(5000);
  });

  it("[A] Agregar el mismo producto suma cantidad", () => {
    const one = addLine([], americano, { lineId: "l1" });
    const two = addLine(one, americano, { lineId: "l2" });
    expect(two).toHaveLength(1);
    expect(two[0].lineId).toBe("l1");
    expect(two[0].quantity).toBe(2);
    expect(orderTotals(two, IVA).totalCents).toBe(10000);
    expect(one[0].quantity).toBe(1);
  });

  it("[A] El mismo producto con otros modificadores es otra partida", () => {
    const one = addLine([], latte, { lineId: "l1", modifiers: [entera] });
    const two = addLine(one, latte, { lineId: "l2", modifiers: [amareto] });
    expect(two.map((line) => line.lineId)).toEqual(["l1", "l2"]);
    expect(lineUnitCents(two[1])).toBe(7500);
    expect(orderTotals(two, IVA).totalCents).toBe(14000);

    const a = addLine([], latte, {
      lineId: "a",
      modifiers: [amareto, vainilla],
    });
    const b = addLine(a, latte, {
      lineId: "b",
      modifiers: [vainilla, amareto],
    });
    expect(b).toHaveLength(1);
    expect(b[0].quantity).toBe(2);
    expect(lineTotalCents(b[0])).toBe(17000);
  });

  it("[A] Disminuir la cantidad hasta cero elimina la partida", () => {
    const two = addLine([], americano, { lineId: "l1", quantity: 2 });
    const one = changeQuantity(two, "l1", -1);
    expect(one[0].quantity).toBe(1);
    expect(orderTotals(one, IVA).totalCents).toBe(5000);
    const none = changeQuantity(one, "l1", -1);
    expect(none).toEqual([]);
    expect(orderTotals(none, IVA)).toEqual({
      itemCount: 0,
      totalCents: 0,
      netCents: 0,
      taxCents: 0,
    });
    expect(changeQuantity(one, "l1", 2)[0].quantity).toBe(3);
  });

  it("[A] Eliminar una partida recalcula el total", () => {
    const both = addLine(addLine([], americano, { lineId: "l1" }), brownie, {
      lineId: "l2",
    });
    expect(orderTotals(both, IVA).totalCents).toBe(8800);
    const rest = removeLine(both, "l2");
    expect(rest.map((line) => line.name)).toEqual(["Americano"]);
    expect(orderTotals(rest, IVA).totalCents).toBe(5000);
  });

  it("[A] El total desglosa el IVA incluido", () => {
    const lines = addLine(
      addLine([], latte, { lineId: "l1", modifiers: [amareto] }),
      brownie,
      { lineId: "l2" },
    );
    expect(orderTotals(lines, IVA)).toEqual({
      itemCount: 2,
      totalCents: 11300,
      netCents: 9741,
      taxCents: 1559,
    });
    expect(taxBreakdown(11600, 1600)).toEqual({
      netCents: 10000,
      taxCents: 1600,
    });
    expect(taxBreakdown(5, 1600)).toEqual({ netCents: 4, taxCents: 1 });
    expect(taxBreakdown(29, 1600)).toEqual({ netCents: 25, taxCents: 4 });
    expect(taxBreakdown(3, 10000)).toEqual({ netCents: 2, taxCents: 1 });
    expect(taxBreakdown(0, 1600)).toEqual({ netCents: 0, taxCents: 0 });
  });

  it("[A] Un producto agotado no se agrega", () => {
    const lines = addLine([], americano, { lineId: "l1" });
    const soldOut: Product = { ...brownie, available: false };
    expect(rejection(() => addLine(lines, soldOut, { lineId: "l2" }))).toBe(
      "product-unavailable",
    );
    expect(lines).toHaveLength(1);
  });

  it("[A] La partida conserva el precio capturado", () => {
    const menuProduct: Product = { ...americano };
    const lines = addLine([], menuProduct, { lineId: "l1" });
    menuProduct.priceCents = 5500;
    menuProduct.name = "Americano grande";
    expect(lines[0].unitPriceCents).toBe(5000);
    expect(lines[0].name).toBe("Americano");
    expect(orderTotals(lines, IVA).totalCents).toBe(5000);
  });

  it("rejects changes that do not make sense", () => {
    const lines = addLine([], americano, { lineId: "l1" });
    expect(rejection(() => changeQuantity(lines, "nope", 1))).toBe(
      "unknown-line",
    );
    expect(rejection(() => removeLine(lines, "nope"))).toBe("unknown-line");
    expect(rejection(() => changeQuantity(lines, "l1", 0.5))).toBe(
      "invalid-quantity",
    );
    expect(
      rejection(() => addLine([], americano, { lineId: "x", quantity: 0 })),
    ).toBe("invalid-quantity");
    expect(
      rejection(() => addLine([], americano, { lineId: "x", quantity: 1.5 })),
    ).toBe("invalid-quantity");
  });

  it("formats centavos as Mexican pesos", () => {
    expect(formatMXN(0)).toBe("$0.00");
    expect(formatMXN(5)).toBe("$0.05");
    expect(formatMXN(5000)).toBe("$50.00");
    expect(formatMXN(123450)).toBe("$1,234.50");
    expect(formatMXN(100000000)).toBe("$1,000,000.00");
    expect(formatMXN(-500)).toBe("-$5.00");
    expect(() => formatMXN(10.5)).toThrow(RangeError);
  });
});
