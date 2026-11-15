// @vitest-environment node
// Spec: Linear EVL-121, slice [A]. Test names are the scenario titles.
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

const americano = product("52000822146"); // $50.00
const latte = product("52000822148"); // $65.00
const brownie = product("52000822189"); // $38.00

const entera: LineModifier = {
  groupId: "leche",
  groupName: "Tipo de leche",
  optionId: "entera",
  name: "Entera",
  priceDeltaCents: 0,
};
const avena: LineModifier = {
  groupId: "leche",
  groupName: "Tipo de leche",
  optionId: "avena",
  name: "Avena",
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
    // Dado una orden vacía, cuando agrego un Americano de $50.00,
    // entonces la orden tiene 1 partida con cantidad 1 y el total es $50.00
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
    // Dado una orden con un Americano, cuando agrego otro igual,
    // entonces hay una sola partida con cantidad 2 y el total es $100.00
    const one = addLine([], americano, { lineId: "l1" });
    const two = addLine(one, americano, { lineId: "l2" });
    expect(two).toHaveLength(1);
    expect(two[0].lineId).toBe("l1");
    expect(two[0].quantity).toBe(2);
    expect(orderTotals(two, IVA).totalCents).toBe(10000);
    // The input array is never mutated.
    expect(one[0].quantity).toBe(1);
  });

  it("[A] El mismo producto con otros modificadores es otra partida", () => {
    // Dado un Latte con leche Entera ($65.00), cuando agrego un Latte con
    // leche de Avena ($75.00), entonces hay 2 partidas y el total es $140.00
    const one = addLine([], latte, { lineId: "l1", modifiers: [entera] });
    const two = addLine(one, latte, { lineId: "l2", modifiers: [avena] });
    expect(two.map((line) => line.lineId)).toEqual(["l1", "l2"]);
    expect(lineUnitCents(two[1])).toBe(7500);
    expect(orderTotals(two, IVA).totalCents).toBe(14000);

    // Same modifiers in a different order are still the same line.
    const a = addLine([], latte, { lineId: "a", modifiers: [avena, vainilla] });
    const b = addLine(a, latte, { lineId: "b", modifiers: [vainilla, avena] });
    expect(b).toHaveLength(1);
    expect(b[0].quantity).toBe(2);
    expect(lineTotalCents(b[0])).toBe(17000);
  });

  it("[A] Disminuir la cantidad hasta cero elimina la partida", () => {
    // Dado 2 Americanos, cuando disminuyo una vez y luego otra, entonces
    // primero queda 1 ($50.00) y después la orden queda vacía ($0.00)
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
    // Dado un Americano ($50.00) y un Brownie ($38.00), cuando elimino el
    // Brownie, entonces queda 1 partida y el total es $50.00
    const both = addLine(addLine([], americano, { lineId: "l1" }), brownie, {
      lineId: "l2",
    });
    expect(orderTotals(both, IVA).totalCents).toBe(8800);
    const rest = removeLine(both, "l2");
    expect(rest.map((line) => line.name)).toEqual(["Americano"]);
    expect(orderTotals(rest, IVA).totalCents).toBe(5000);
  });

  it("[A] El total desglosa el IVA incluido", () => {
    // Dado un Latte con Avena ($75.00) y un Brownie ($38.00), entonces el
    // total es $113.00: $97.41 de base y $15.59 de IVA (16 %)
    const lines = addLine(
      addLine([], latte, { lineId: "l1", modifiers: [avena] }),
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
    // 5 / 1.16 = 4.31…; 29 / 1.16 = 25 exactly; half a centavo rounds up.
    expect(taxBreakdown(5, 1600)).toEqual({ netCents: 4, taxCents: 1 });
    expect(taxBreakdown(29, 1600)).toEqual({ netCents: 25, taxCents: 4 });
    expect(taxBreakdown(3, 10000)).toEqual({ netCents: 2, taxCents: 1 });
    expect(taxBreakdown(0, 1600)).toEqual({ netCents: 0, taxCents: 0 });
  });

  it("[A] Un producto agotado no se agrega", () => {
    // Dado el Brownie marcado como agotado, cuando intento agregarlo,
    // entonces se rechaza y la orden no cambia
    const lines = addLine([], americano, { lineId: "l1" });
    const soldOut: Product = { ...brownie, available: false };
    expect(rejection(() => addLine(lines, soldOut, { lineId: "l2" }))).toBe(
      "product-unavailable",
    );
    expect(lines).toHaveLength(1);
  });

  it("[A] La partida conserva el precio capturado", () => {
    // Dado un Americano capturado a $50.00, cuando el precio del menú cambia
    // a $55.00, entonces la partida sigue en $50.00 y el total no cambia
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
