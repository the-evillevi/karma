// @vitest-environment node
// Spec: Linear EVL-120, slice [A]. Test names are the scenario titles.
import { describe, expect, it } from "vitest";
import rawCatalog from "../../catalog/catalog.json";
import { findProduct, parseCatalog } from "./catalog.ts";
import type { Product } from "./catalog.ts";
import {
  ModifierError,
  defaultSelection,
  editLine,
  resolveModifiers,
} from "./modifiers.ts";
import type { ModifierSelection } from "./modifiers.ts";
import { OrderError, addLine, lineTotalCents, lineUnitCents } from "./order.ts";

const catalog = parseCatalog(rawCatalog);

function product(sku: string): Product {
  const found = findProduct(catalog, sku);
  if (!found) throw new Error(`No product ${sku}`);
  return found;
}

const americano = product("52000822146"); // $50.00, shots
const latte = product("52000822148"); // $65.00, milk + shots
const crepaPollo = product("52000822208"); // $60.00, side + dressing
const cocaCola = product("52000822136"); // $25.00, no modifiers

function capture(target: Product, selection: ModifierSelection, note = "") {
  return addLine([], target, {
    lineId: "l1",
    modifiers: resolveModifiers(catalog, target, selection),
    note,
  });
}

function refusal(target: Product, selection: ModifierSelection) {
  try {
    resolveModifiers(catalog, target, selection);
  } catch (error) {
    if (error instanceof ModifierError) {
      return {
        reason: error.reason,
        groupId: error.groupId,
        groupName: error.groupName,
      };
    }
    throw error;
  }
  throw new Error("selection was accepted");
}

describe("EVL-120 [A] Modificadores y nota", () => {
  it("[A] La opción predeterminada viene elegida", () => {
    // Dado el Latte ($65.00) con "Tipo de leche" obligatorio y Entera por
    // defecto, entonces Entera está elegida y el precio es $65.00
    const selection = defaultSelection(catalog, latte);
    expect(selection).toEqual({ leche: ["entera"], shot: [] });
    const [line] = capture(latte, selection);
    expect(line.modifiers.map((modifier) => modifier.name)).toEqual(["Entera"]);
    expect(lineUnitCents(line)).toBe(6500);
    expect(defaultSelection(catalog, cocaCola)).toEqual({});
    expect(defaultSelection(catalog, crepaPollo)).toEqual({
      acompanamiento: [],
      "aderezo-extra": [],
    });
  });

  it("[A] Un modificador con costo suma al precio", () => {
    // Dado el Latte ($65.00), cuando elijo Avena (+$10.00) y un shot de
    // Vainilla (+$10.00), entonces el precio unitario es $85.00
    const [line] = capture(latte, { leche: ["avena"], shot: ["vainilla"] });
    expect(line.modifiers).toEqual([
      {
        groupId: "leche",
        groupName: "Tipo de leche",
        optionId: "avena",
        name: "Avena",
        priceDeltaCents: 1000,
      },
      {
        groupId: "shot",
        groupName: "Shot de sabor",
        optionId: "vainilla",
        name: "Vainilla",
        priceDeltaCents: 1000,
      },
    ]);
    expect(lineUnitCents(line)).toBe(8500);
  });

  it("[A] Varias opciones de un grupo múltiple se suman", () => {
    // Dado el Americano ($50.00), cuando elijo los shots Caramelo y Vainilla,
    // entonces el precio unitario es $70.00 y la partida lista ambos shots
    const [line] = capture(americano, { shot: ["vainilla", "caramelo"] });
    // Catalog order, not click order.
    expect(line.modifiers.map((modifier) => modifier.name)).toEqual([
      "Caramelo",
      "Vainilla",
    ]);
    expect(lineUnitCents(line)).toBe(7000);
    // A group left out of the selection counts as nothing chosen.
    expect(resolveModifiers(catalog, americano, {})).toEqual([]);
  });

  it("[A] No se agrega sin la elección obligatoria", () => {
    // Dado la Crepa de Pollo, cuyo "Acompañamiento" es obligatorio y sin
    // opción por defecto, cuando no elijo Ensalada o Papas, entonces se
    // rechaza indicando que falta "Acompañamiento"
    expect(refusal(crepaPollo, defaultSelection(catalog, crepaPollo))).toEqual({
      reason: "missing-required",
      groupId: "acompanamiento",
      groupName: "Acompañamiento",
    });
    expect(refusal(crepaPollo, {}).reason).toBe("missing-required");
    const [line] = capture(crepaPollo, { acompanamiento: ["papas"] });
    expect(lineUnitCents(line)).toBe(6000);
  });

  it("[A] No se excede el máximo del grupo", () => {
    // Dado el Latte, cuando elijo Avena y Coco a la vez, entonces se rechaza
    // indicando que "Tipo de leche" admite máximo 1
    expect(refusal(latte, { leche: ["avena", "coco"] })).toEqual({
      reason: "too-many",
      groupId: "leche",
      groupName: "Tipo de leche",
    });
    // Choosing the same option twice is not a way around the limit.
    expect(refusal(latte, { leche: ["avena", "avena"] }).reason).toBe(
      "too-many",
    );
  });

  it("[A] Una opción ajena al producto se rechaza", () => {
    // Dado la Coca Cola, que no tiene modificadores, cuando intento agregarla
    // con leche de Avena, entonces se rechaza
    expect(refusal(cocaCola, { leche: ["avena"] })).toEqual({
      reason: "unknown-group",
      groupId: "leche",
      groupName: "",
    });
    expect(refusal(latte, { leche: ["papas"] })).toEqual({
      reason: "unknown-option",
      groupId: "leche",
      groupName: "Tipo de leche",
    });
  });

  it("[A] La nota de preparación viaja con la partida", () => {
    // Dado un Americano, cuando lo agrego con la nota "sin azúcar", entonces
    // la partida conserva la nota y un Americano sin nota es otra partida
    const noted = capture(americano, {}, "  sin azúcar ");
    expect(noted[0].note).toBe("sin azúcar");
    const both = addLine(noted, americano, { lineId: "l2" });
    expect(both.map((line) => [line.lineId, line.note])).toEqual([
      ["l1", "sin azúcar"],
      ["l2", ""],
    ]);
    const same = addLine(both, americano, { lineId: "l3", note: "sin azúcar" });
    expect(same.map((line) => line.quantity)).toEqual([2, 1]);
  });

  it("[A] Reeditar una partida conserva su cantidad", () => {
    // Dado 2 Lattes con leche Entera ($130.00), cuando la reedito a leche de
    // Coco (+$10.00), entonces sigue siendo la misma partida con cantidad 2
    // y su importe es $150.00
    const lines = addLine([], latte, {
      lineId: "l1",
      quantity: 2,
      modifiers: resolveModifiers(catalog, latte, { leche: ["entera"] }),
    });
    expect(lineTotalCents(lines[0])).toBe(13000);
    const edited = editLine(lines, "l1", {
      modifiers: resolveModifiers(catalog, latte, { leche: ["coco"] }),
      note: " tibio ",
    });
    expect(edited).toHaveLength(1);
    expect(edited[0]).toMatchObject({
      lineId: "l1",
      quantity: 2,
      unitPriceCents: 6500,
      note: "tibio",
    });
    expect(lineTotalCents(edited[0])).toBe(15000);
    // The original array and line are untouched.
    expect(lineTotalCents(lines[0])).toBe(13000);
    // Changing only the note keeps the modifiers.
    const noteOnly = editLine(edited, "l1", { note: "" });
    expect(noteOnly[0].note).toBe("");
    expect(lineTotalCents(noteOnly[0])).toBe(15000);
    expect(() => editLine(lines, "nope", { note: "x" })).toThrow(OrderError);
  });
});
