// @vitest-environment node
// Spec: Linear EVL-112, slice [A]. Test names are the scenario titles.
import { describe, expect, it } from "vitest";
import rawCatalog from "../../catalog/catalog.json";
import {
  CatalogError,
  findProduct,
  parseCatalog,
  productsInCategory,
} from "./catalog.ts";
import type { CatalogProblem } from "./catalog.ts";

function minimalCatalog() {
  return {
    schema: "karma.catalog/v2",
    currency: "MXN",
    taxRateBps: 1600,
    pricesIncludeTax: true,
    categories: [{ id: "bebidas", name: "Bebidas", sortOrder: 0 }],
    modifierGroups: [] as unknown[],
    products: [
      {
        id: "52000822142",
        sku: "52000822142",
        name: "Espresso",
        categoryId: "bebidas",
        priceCents: 2900,
        available: true,
        modifierGroupIds: [] as string[],
      },
    ],
  };
}

function refusal(raw: unknown): {
  problem: CatalogProblem;
  subjectId?: string;
} {
  try {
    parseCatalog(raw);
  } catch (error) {
    if (error instanceof CatalogError) {
      return { problem: error.problem, subjectId: error.subjectId };
    }
    throw error;
  }
  throw new Error("catalog was accepted");
}

describe("EVL-112 [A] Catálogo del libro de Carlos", () => {
  it("[A] El catálogo contiene los 115 productos del libro de Carlos", () => {
    // Entonces hay 115 productos en 5 categorías:
    // Bebidas 51, Extras 23, Postres 21, Salado 17 y Café 3
    const catalog = parseCatalog(rawCatalog);
    expect(catalog.products).toHaveLength(115);
    expect(catalog.categories.map((category) => category.name)).toEqual([
      "Bebidas",
      "Salado",
      "Postres",
      "Extras",
      "Café",
    ]);
    const count = (id: string) => productsInCategory(catalog, id).length;
    expect(count("bebidas")).toBe(51);
    expect(count("extras")).toBe(23);
    expect(count("postres")).toBe(21);
    expect(count("salado")).toBe(17);
    expect(count("cafe")).toBe(3);
  });

  it("[A] Los precios se guardan en centavos", () => {
    // Dado el Espresso a $29.00 y el café de 1kg a $500.00,
    // entonces sus precios son 2900 y 50000 centavos
    const catalog = parseCatalog(rawCatalog);
    const espresso = findProduct(catalog, "52000822142");
    expect(espresso?.name).toBe("Espresso");
    expect(espresso?.priceCents).toBe(2900);
    expect(findProduct(catalog, "52000822226")?.priceCents).toBe(50000);
    expect(
      catalog.products.every(
        (product) =>
          Number.isSafeInteger(product.priceCents) && product.priceCents > 0,
      ),
    ).toBe(true);
  });

  it("[A] Los precios incluyen IVA del 16 %", () => {
    const catalog = parseCatalog(rawCatalog);
    expect(catalog.currency).toBe("MXN");
    expect(catalog.taxRateBps).toBe(1600);
    expect(catalog.pricesIncludeTax).toBe(true);
  });

  it("[A] Todos los productos inician disponibles", () => {
    // Dado el Croissant de Jamon c/Queso, marcado "Disponible? = N" en el libro,
    // entonces está disponible para vender, igual que los otros 114
    const catalog = parseCatalog(rawCatalog);
    const croissant = findProduct(catalog, "52000822219");
    expect(croissant?.name).toBe("Croissant de Jamon c/Queso");
    expect(croissant?.available).toBe(true);
    expect(catalog.products.every((product) => product.available)).toBe(true);
  });

  it("[A] Los nombres repetidos conservan SKU distintos", () => {
    // "Frappe de Chocolate" aparece con los SKU 52000822156 y 52000822171
    const catalog = parseCatalog(rawCatalog);
    const frappes = catalog.products.filter(
      (product) => product.name === "Frappe de Chocolate",
    );
    expect(frappes.map((product) => product.sku)).toEqual([
      "52000822156",
      "52000822171",
    ]);
    expect(frappes.map((product) => product.id)).toEqual([
      "52000822156",
      "52000822171",
    ]);
  });

  it("[A] Un catálogo inválido no se carga", () => {
    // Un precio de 29.5 centavos, un SKU repetido o una categoría inexistente
    // rechazan la carga indicando el producto y el motivo
    const fractional = minimalCatalog();
    fractional.products[0].priceCents = 29.5;
    expect(refusal(fractional)).toEqual({
      problem: "invalid-price",
      subjectId: "52000822142",
    });

    const negative = minimalCatalog();
    negative.products[0].priceCents = -100;
    expect(refusal(negative).problem).toBe("invalid-price");

    const duplicated = minimalCatalog();
    duplicated.products.push({ ...duplicated.products[0], name: "Otro" });
    expect(refusal(duplicated)).toEqual({
      problem: "duplicate-sku",
      subjectId: "52000822142",
    });

    const orphan = minimalCatalog();
    orphan.products[0].categoryId = "no-existe";
    expect(refusal(orphan)).toEqual({
      problem: "unknown-category",
      subjectId: "52000822142",
    });

    const missingGroup = minimalCatalog();
    missingGroup.products[0].modifierGroupIds = ["leche"];
    expect(refusal(missingGroup)).toEqual({
      problem: "unknown-modifier-group",
      subjectId: "52000822142",
    });

    expect(refusal(null).problem).toBe("malformed");
    expect(refusal({ products: "nope" }).problem).toBe("malformed");
  });

  it("returns a copy that does not alias the raw input", () => {
    const raw = minimalCatalog();
    const catalog = parseCatalog(raw);
    raw.products[0].priceCents = 1;
    expect(catalog.products[0].priceCents).toBe(2900);
  });
});
