// @vitest-environment node
// Spec: Linear EVL-112, slice [C]. Test names are the scenario titles.
import { describe, expect, it } from "vitest";
import rawCatalog from "../../catalog/catalog.json";
import {
  findProduct,
  modifierGroupsFor,
  parseCatalog,
  productsInCategory,
} from "./catalog.ts";

const catalog = parseCatalog(rawCatalog);

function product(sku: string) {
  const found = findProduct(catalog, sku);
  if (!found) throw new Error(`No product ${sku}`);
  return found;
}

const sku = (suffix: number) => `52000822${suffix}`;

describe("EVL-112 [C] Precios del menú impreso", () => {
  it("[C] El catálogo no tiene productos repetidos", () => {
    // Entonces hay 112 productos (Bebidas 49, Extras 23, Postres 20,
    // Salado 17 y Café 3), sin los SKU …171, …169 ni …204, y ningún nombre
    // se repite sin importar mayúsculas
    expect(catalog.products).toHaveLength(112);
    const count = (id: string) => productsInCategory(catalog, id).length;
    expect(count("bebidas")).toBe(49);
    expect(count("extras")).toBe(23);
    expect(count("postres")).toBe(20);
    expect(count("salado")).toBe(17);
    expect(count("cafe")).toBe(3);
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
    const expected: Record<number, number> = {
      142: 3000, // Espresso
      143: 5500, // Espresso tonic
      191: 3000, // Muffin
      187: 4500, // Helado
      222: 5500, // Ensalada
      223: 5500, // Bowl de Fruta
      117: 1300, // Philadelphia (Extra)
      118: 1300, // Crema batida (Extra)
    };
    // Crepas saladas $60.00
    for (const s of [207, 208, 209, 210, 211, 212]) expected[s] = 6000;
    // Emparedados y croissants salados $70.00
    for (const s of [213, 214, 215, 216, 217, 218, 219, 220, 221]) {
      expected[s] = 7000;
    }
    // Crepas dulces $50.00
    for (const s of [193, 194, 195, 196, 197, 198, 199, 200])
      expected[s] = 5000;
    // Croissants dulces $60.00
    for (const s of [188, 201, 202, 203]) expected[s] = 6000;

    const actual = Object.fromEntries(
      Object.keys(expected).map((s) => [s, product(sku(Number(s))).priceCents]),
    );
    expect(actual).toEqual(expected);
  });

  it("[C] Lo que no aparece en el menú conserva el precio del libro", () => {
    // Coca Cola $25.00, Pan $35.00, café de 1kg $500.00, Smoothie de Fresa $65.00
    expect(product(sku(136)).priceCents).toBe(2500);
    expect(product(sku(206)).priceCents).toBe(3500);
    expect(product(sku(226)).priceCents).toBe(50000);
    expect(product(sku(172)).priceCents).toBe(6500);
  });

  it("[C] Los extras dulces cobran el precio del menú", () => {
    // Dado la Crepa de Nutella, Philadelphia y Crema batida cuestan +$13.00,
    // igual que el producto con su SKU
    const extras = modifierGroupsFor(catalog, product(sku(193))).find(
      (group) => group.name === "Extras",
    );
    const price = (s: number) =>
      extras?.options.find((option) => option.sku === sku(s))?.priceDeltaCents;
    expect(price(117)).toBe(1300);
    expect(price(118)).toBe(1300);
  });
});
