// @vitest-environment node
import { describe, expect, it } from "vitest";
import rawCatalog from "../../catalog/catalog.json";
import { findProduct, modifierGroupsFor, parseCatalog } from "./catalog.ts";

const catalog = parseCatalog(rawCatalog);

function product(sku: string) {
  const found = findProduct(catalog, sku);
  if (!found) throw new Error(`No product ${sku}`);
  return found;
}

const sku = (suffix: number) => `52000822${suffix}`;

describe("EVL-112 [C] Precios del menú impreso", () => {
  it("[C] El catálogo no tiene productos repetidos", () => {
    for (const removed of [171, 169, 204]) {
      expect(findProduct(catalog, sku(removed))).toBeUndefined();
    }
    const names = catalog.products.map((p) => p.name.toLocaleLowerCase("es"));
    expect(new Set(names).size).toBe(names.length);
  });

  it("[C] Las erratas obvias están corregidas", () => {
    expect(product(sku(149)).name).toBe("Latte Honey");
    expect(product(sku(210)).name).toBe("Crepa Hawaiana");
    expect(product(sku(122)).name).toBe("Maple (Topping)");
  });

  it("[C] Los precios salen del menú impreso", () => {
    const singleProducts: [number, string, number][] = [
      [142, "Espresso", 3000],
      [143, "Espresso tonic", 5500],
      [191, "Muffin", 3000],
      [187, "Helado", 4500],
      [222, "Ensalada", 5500],
      [223, "Bowl de Fruta", 5500],
      [117, "Philadelphia (Extra)", 1300],
      [118, "Crema batida (Extra)", 1300],
    ];
    const singleActual = singleProducts.map(([s]) => {
      const found = product(sku(s));
      return [s, found.name, found.priceCents];
    });
    expect(singleActual).toEqual(singleProducts);

    const crepasSaladas = [207, 208, 209, 210, 211];
    const emparedadosYCroissantsSalados = [
      213, 214, 215, 216, 217, 218, 219, 220, 221,
    ];
    const crepasDulces = [193, 194, 195, 196, 197, 198, 199, 200];
    const croissantsDulces = [188, 201, 202, 203];
    const menuGroups: [string, number[], number][] = [
      ["crepas saladas", crepasSaladas, 6000],
      ["emparedados y croissants salados", emparedadosYCroissantsSalados, 7000],
      ["crepas dulces", crepasDulces, 5000],
      ["croissants dulces", croissantsDulces, 6000],
    ];
    for (const [group, skus, priceCents] of menuGroups) {
      const prices = skus.map((s) => product(sku(s)).priceCents);
      expect(prices, group).toEqual(skus.map(() => priceCents));
    }
  });

  it("[C] Lo que no aparece en el menú conserva el precio del libro", () => {
    const offMenu: [number, string, number][] = [
      [136, "Coca Cola", 2500],
      [206, "Pan", 3500],
      [226, "1kg", 50000],
      [172, "Smoothie de Fresa", 6500],
    ];
    const actual = offMenu.map(([s]) => {
      const found = product(sku(s));
      return [s, found.name, found.priceCents];
    });
    expect(actual).toEqual(offMenu);
  });

  it("[C] Los extras dulces cobran el precio del menú", () => {
    const crepaDeNutella = product(sku(193));
    expect(crepaDeNutella.name).toBe("Crepa de Nutella");
    const extras = modifierGroupsFor(catalog, crepaDeNutella).find(
      (group) => group.name === "Extras",
    );
    const price = (s: number) =>
      extras?.options.find((option) => option.sku === sku(s))?.priceDeltaCents;
    const philadelphia = 117;
    const cremaBatida = 118;
    expect(price(philadelphia)).toBe(product(sku(philadelphia)).priceCents);
    expect(price(cremaBatida)).toBe(product(sku(cremaBatida)).priceCents);
    expect(price(philadelphia)).toBe(1300);
    expect(price(cremaBatida)).toBe(1300);
  });
});
