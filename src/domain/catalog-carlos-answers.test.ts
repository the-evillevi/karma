// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  findProduct,
  modifierGroupsFor,
  productsInCategory,
} from "./catalog.ts";
import type { ModifierGroup } from "./catalog.ts";
import { ModifierError, resolveModifiers } from "./modifiers.ts";
import { addLine, lineUnitCents } from "./order.ts";
import { catalog, latte, product } from "./testing.ts";

const sku = (suffix: number) => `52000822${suffix}`;

function groupsOf(suffix: number): ModifierGroup[] {
  return modifierGroupsFor(catalog, product(sku(suffix)));
}

function optionsOf(group: ModifierGroup): [string, number][] {
  return group.options.map((option) => [option.name, option.priceDeltaCents]);
}

function between(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

const bottled = between(135, 139);
const savoury = [...between(207, 211), ...between(213, 221)];

describe("EVL-112 [D] Respuestas de Carlos", () => {
  it("[D] La leche vegetal y deslactosada no cuestan extra", () => {
    expect(latte.priceCents).toBe(6500);
    const [leche] = modifierGroupsFor(catalog, latte);
    expect(leche.name).toBe("Tipo de leche");
    expect(leche.defaultOptionId).toBe("entera");
    expect(optionsOf(leche)).toEqual([
      ["Entera", 0],
      ["Deslactosada", 0],
      ["Coco", 0],
      ["Almendras", 0],
      ["Avena", 0],
    ]);
    const [line] = addLine([], latte, {
      lineId: "l1",
      modifiers: resolveModifiers(catalog, latte, { leche: ["avena"] }),
    });
    expect(lineUnitCents(line)).toBe(6500);
  });

  it("[D] Toda bebida preparada acepta shot de sabor", () => {
    for (const suffix of [175, 181, 172]) {
      const shot = groupsOf(suffix).find((group) => group.id === "shot");
      expect(shot?.name, sku(suffix)).toBe("Shot de sabor");
      expect(shot?.min).toBe(0);
      expect(
        shot?.options.every((option) => option.priceDeltaCents === 1000),
      ).toBe(true);
    }
    for (const suffix of bottled) {
      expect(product(sku(suffix)).modifierGroupIds, sku(suffix)).toEqual([]);
    }
    const prepared = productsInCategory(catalog, "bebidas").filter(
      (item) => !bottled.map(sku).includes(item.id),
    );
    expect(prepared).toHaveLength(44);
    for (const item of prepared) {
      expect(item.modifierGroupIds, item.name).toContain("shot");
    }
  });

  it("[D] Los salados incluyen un aderezo de cortesía", () => {
    for (const suffix of [208, 213, 221]) {
      const [side, included, extra] = groupsOf(suffix);
      expect(
        groupsOf(suffix).map((group) => group.name),
        sku(suffix),
      ).toEqual(["Acompañamiento", "Aderezo incluido", "Aderezo extra"]);
      expect([side.min, side.max]).toEqual([1, 1]);
      expect(optionsOf(side)).toEqual([
        ["Ensalada", 0],
        ["Papas", 0],
      ]);
      expect([included.min, included.max]).toEqual([1, 1]);
      expect(included.defaultOptionId).toBeUndefined();
      expect(optionsOf(included)).toEqual([
        ["Ranch", 0],
        ["Mostaza Miel", 0],
        ["Mayonesa Chipotle", 0],
      ]);
      expect(extra.min).toBe(0);
      expect(optionsOf(extra)).toEqual([
        ["Aderezo Ranch", 1000],
        ["Aderezo Mostaza Miel", 1000],
        ["Aderezo Mayonesa Chipotle", 1000],
      ]);
    }
    for (const suffix of savoury) {
      expect(product(sku(suffix)).modifierGroupIds, sku(suffix)).toEqual([
        "acompanamiento",
        "aderezo-incluido",
        "aderezo-extra",
      ]);
    }
  });

  it("[D] Los nombres llevan acento", () => {
    const expected: [number, string][] = [
      [174, "Smoothie de Plátano"],
      [116, "Plátano (Extra)"],
      [207, "Crepa de Jamón c/Queso"],
      [214, "Emparedado de Jamón c/Queso"],
      [219, "Croissant de Jamón c/Queso"],
      [184, "Paraíso Azul (Tisana)"],
      [156, "Frappé de Chocolate"],
      [160, "Frappé Caramel Macchiato"],
    ];
    expect(
      expected.map(([suffix]) => [suffix, product(sku(suffix)).name]),
    ).toEqual(expected);
    const names = [
      ...catalog.products.map((item) => item.name),
      ...catalog.modifierGroups.flatMap((group) =>
        group.options.map((option) => option.name),
      ),
    ].map((name) => name.normalize("NFC"));
    expect(
      names.filter((name) => /Platano|Jamon|Paraiso|Frappe/.test(name)),
    ).toEqual([]);
  });

  it("[D] La Crepa de Champiñones c/Queso ya no se vende", () => {
    expect(catalog.products).toHaveLength(111);
    const count = (id: string) => productsInCategory(catalog, id).length;
    expect(
      ["bebidas", "extras", "postres", "salado", "cafe"].map(count),
    ).toEqual([49, 23, 20, 16, 3]);
    expect(findProduct(catalog, sku(212))).toBeUndefined();
  });

  it("[D] El Croissant Dulce pide sabor", () => {
    const croissant = product(sku(188));
    expect(croissant.priceCents).toBe(6000);
    const groups = groupsOf(188);
    expect(groups.map((group) => group.name)).toEqual([
      "Sabor",
      "Fruta de acompañamiento",
      "Extras",
    ]);
    const [sabor] = groups;
    expect([sabor.min, sabor.max]).toEqual([1, 1]);
    expect(sabor.defaultOptionId).toBeUndefined();
    expect(optionsOf(sabor)).toEqual([
      ["Mermelada de fresa", 0],
      ["Mermelada de frutos rojos", 0],
      ["Mermelada de zarzamora c/ queso", 0],
    ]);
    expect(() =>
      resolveModifiers(catalog, croissant, {
        "fruta-acompanamiento": ["durazno"],
      }),
    ).toThrow(ModifierError);
    const [line] = addLine([], croissant, {
      lineId: "l1",
      modifiers: resolveModifiers(catalog, croissant, {
        sabor: ["mermelada-fresa"],
        "fruta-acompanamiento": ["durazno"],
      }),
    });
    expect(lineUnitCents(line)).toBe(6000);
  });
});
