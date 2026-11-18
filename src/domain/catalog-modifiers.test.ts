// @vitest-environment node
import { describe, expect, it } from "vitest";
import rawCatalog from "../../catalog/catalog.json";
import { findProduct, modifierGroupsFor, parseCatalog } from "./catalog.ts";
import type { ModifierGroup } from "./catalog.ts";

const catalog = parseCatalog(rawCatalog);

function groupsOf(sku: string): ModifierGroup[] {
  const product = findProduct(catalog, sku);
  if (!product) throw new Error(`No product ${sku}`);
  return modifierGroupsFor(catalog, product);
}

function option(group: ModifierGroup, name: string) {
  const found = group.options.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No option ${name} in ${group.name}`);
  return found;
}

describe("EVL-112 [B] Grupos de modificadores", () => {
  it("[B] Un latte pide tipo de leche", () => {
    const [leche, shot] = groupsOf("52000822148");
    expect(leche.name).toBe("Tipo de leche");
    expect([leche.min, leche.max]).toEqual([1, 1]);
    expect(leche.defaultOptionId).toBe(option(leche, "Entera").id);
    expect(option(leche, "Entera").priceDeltaCents).toBe(0);
    expect(
      ["Deslactosada", "Coco", "Almendras", "Avena"].map(
        (name) => option(leche, name).priceDeltaCents,
      ),
    ).toEqual([1000, 1000, 1000, 1000]);
    expect(leche.options).toHaveLength(5);

    expect(shot.name).toBe("Shot de sabor");
    expect(shot.min).toBe(0);
    expect(shot.max).toBeGreaterThan(1);
    expect(shot.options.map((candidate) => candidate.name)).toEqual([
      "Amareto",
      "Avellana",
      "Caramelo",
      "Vainilla",
      "Chai",
      "Chocolate",
      "Crema irlandesa",
      "Vainilla Francesa",
    ]);
    expect(
      shot.options.every((candidate) => candidate.priceDeltaCents === 1000),
    ).toBe(true);
  });

  it("[B] Crepas, emparedados y croissants salados incluyen ensalada o papas", () => {
    for (const sku of ["52000822208", "52000822213", "52000822218"]) {
      const [side, dressing] = groupsOf(sku);
      expect(side.name).toBe("Acompañamiento");
      expect([side.min, side.max]).toEqual([1, 1]);
      expect(side.defaultOptionId).toBeUndefined();
      expect(side.options.map((candidate) => candidate.name)).toEqual([
        "Ensalada",
        "Papas",
      ]);
      expect(
        side.options.every((candidate) => candidate.priceDeltaCents === 0),
      ).toBe(true);

      expect(dressing.name).toBe("Aderezo extra");
      expect(dressing.min).toBe(0);
      expect(
        dressing.options.map((candidate) => [
          candidate.name,
          candidate.priceDeltaCents,
          candidate.sku,
        ]),
      ).toEqual([
        ["Aderezo Ranch", 1000, "52000822125"],
        ["Aderezo Mostaza Miel", 1000, "52000822126"],
        ["Aderezo Mayonesa Chipotle", 1000, "52000822127"],
      ]);
    }
  });

  it("[B] La ensalada exige proteína y aderezo", () => {
    const [protein, dressing] = groupsOf("52000822222");
    expect(protein.name).toBe("Proteína");
    expect(protein.options.map((candidate) => candidate.name)).toEqual([
      "Pollo",
      "Queso panela",
      "Jamón de pavo",
    ]);
    expect(dressing.name).toBe("Aderezo incluido");
    for (const group of [protein, dressing]) {
      expect([group.min, group.max]).toEqual([1, 1]);
      expect(
        group.options.every((candidate) => candidate.priceDeltaCents === 0),
      ).toBe(true);
    }
  });

  it("[B] Los extras dulces usan el precio del libro", () => {
    const [extras] = groupsOf("52000822193");
    expect(extras.name).toBe("Extras");
    expect(extras.min).toBe(0);
    expect(option(extras, "Bola de Helado")).toMatchObject({
      priceDeltaCents: 1300,
      sku: "52000822134",
    });
    expect(option(extras, "Fresas (Extra)")).toMatchObject({
      priceDeltaCents: 1000,
      sku: "52000822112",
    });
    for (const candidate of extras.options) {
      const product = findProduct(catalog, candidate.sku ?? "");
      expect(product?.priceCents).toBe(candidate.priceDeltaCents);
      expect(product?.categoryId).toBe("extras");
    }
  });

  it("[B] Un producto embotellado no tiene modificadores", () => {
    expect(groupsOf("52000822136")).toEqual([]);
    expect(groupsOf("52000822135")).toEqual([]);
  });
});
