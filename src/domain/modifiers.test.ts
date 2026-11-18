// @vitest-environment node
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

const americano = product("52000822146");
const latte = product("52000822148");
const crepaPollo = product("52000822208");
const cocaCola = product("52000822136");

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
    const [line] = capture(americano, { shot: ["vainilla", "caramelo"] });
    expect(line.modifiers.map((modifier) => modifier.name)).toEqual([
      "Caramelo",
      "Vainilla",
    ]);
    expect(lineUnitCents(line)).toBe(7000);
    expect(resolveModifiers(catalog, americano, {})).toEqual([]);
  });

  it("[A] No se agrega sin la elección obligatoria", () => {
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
    expect(refusal(latte, { leche: ["avena", "coco"] })).toEqual({
      reason: "too-many",
      groupId: "leche",
      groupName: "Tipo de leche",
    });
    expect(refusal(latte, { leche: ["avena", "avena"] }).reason).toBe(
      "too-many",
    );
  });

  it("[A] Una opción ajena al producto se rechaza", () => {
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
    expect(lineTotalCents(lines[0])).toBe(13000);
    const noteOnly = editLine(edited, "l1", { note: "" });
    expect(noteOnly[0].note).toBe("");
    expect(lineTotalCents(noteOnly[0])).toBe(15000);
    expect(() => editLine(lines, "nope", { note: "x" })).toThrow(OrderError);
  });
});
