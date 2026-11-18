// @vitest-environment node
import { describe, expect, it } from "vitest";
import { productsInCategory } from "./catalog.ts";
import type { Catalog } from "./catalog.ts";
import { saveOrder } from "./commands.ts";
import { applyBatch, emptyState, replay } from "./journal.ts";
import type { Actor, CommandBatch, CommandMeta, PosState } from "./journal.ts";
import {
  createCategory,
  createProduct,
  forSale,
  menuFor,
  moveCategory,
  moveProduct,
  updateCategory,
  updateProduct,
} from "./menu.ts";
import type { MoveDirection } from "./menu.ts";
import {
  admin,
  catalog,
  linesOf,
  luis,
  mostrador,
  product,
  rejectionOf,
  sofi,
} from "./testing.ts";

const brownie = product("52000822189");
const affogato = product("52000822186");
const fresas = product("52000822112");
const mango = product("52000822113");
const croissant = product("52000822188");

let sequence = 0;
function at(actor: Actor = admin): CommandMeta {
  sequence += 1;
  return {
    commandId: `cmd-${sequence}`,
    at: "2026-11-18T09:00:00.000-06:00",
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

function menuOf(state: PosState): Catalog {
  return menuFor(catalog, state.menu);
}

function categoryNames(menu: Catalog): string[] {
  const names = menu.categories.map((category) => category.name);
  const bySortOrder = [...menu.categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => category.name);
  expect(bySortOrder).toEqual(names);
  return names;
}

function namesIn(menu: Catalog, categoryId: string): string[] {
  return productsInCategory(menu, categoryId).map((item) => item.name);
}

const moveCat = (
  state: PosState,
  categoryId: string,
  direction: MoveDirection,
) =>
  run(state, (current) =>
    moveCategory(current, at(), { categoryId, direction }, catalog),
  );

const moveProd = (
  state: PosState,
  productId: string,
  direction: MoveDirection,
) =>
  run(state, (current) =>
    moveProduct(current, at(), { productId, direction }, catalog),
  );

const editCategory = (
  state: PosState,
  edit: Parameters<typeof updateCategory>[2],
) => run(state, (current) => updateCategory(current, at(), edit, catalog));

describe("EVL-119 [C] Categorías", () => {
  it("[C] Admin crea una categoría", () => {
    expect(categoryNames(menuOf(emptyState()))).toEqual([
      "Bebidas",
      "Salado",
      "Postres",
      "Extras",
      "Café",
    ]);
    const batch = createCategory(
      emptyState(),
      at(),
      { categoryId: "bebidas-frias", name: "  Bebidas Frías " },
      catalog,
    );
    const state = applyBatch(emptyState(), batch);
    expect(categoryNames(menuOf(state))).toEqual([
      "Bebidas",
      "Salado",
      "Postres",
      "Extras",
      "Café",
      "Bebidas Frías",
    ]);
    expect(categoryNames(forSale(menuOf(state))).at(-1)).toBe("Bebidas Frías");
    expect(menuOf(state).categories.at(-1)).toMatchObject({
      id: "bebidas-frias",
      active: true,
    });
    const withProduct = run(state, (current) =>
      createProduct(
        current,
        at(),
        {
          sku: "52000822227",
          name: "Té Helado",
          categoryId: "bebidas-frias",
          priceCents: 4500,
        },
        catalog,
      ),
    );
    expect(namesIn(forSale(menuOf(withProduct)), "bebidas-frias")).toEqual([
      "Té Helado",
    ]);
    expect(replay([batch])).toEqual(state);

    const attempt = (input: { categoryId: string; name: string }) =>
      rejectionOf(() => createCategory(state, at(), input, catalog));
    expect(attempt({ categoryId: "otra", name: "   " })).toBe(
      "invalid-category-name",
    );
    expect(attempt({ categoryId: "otra", name: "cafe" })).toBe(
      "duplicate-category",
    );
    expect(attempt({ categoryId: "otra", name: " BEBIDAS FRIAS " })).toBe(
      "duplicate-category",
    );
    expect(attempt({ categoryId: "bebidas", name: "Otra" })).toBe(
      "duplicate-category",
    );
    expect(attempt({ categoryId: "panes", name: "Panes" })).toBe(
      "not rejected",
    );
  });

  it("[C] Admin renombra una categoría", () => {
    const state = editCategory(emptyState(), {
      categoryId: "extras",
      name: " Extras y Toppings ",
    });
    expect(categoryNames(menuOf(state))).toEqual([
      "Bebidas",
      "Salado",
      "Postres",
      "Extras y Toppings",
      "Café",
    ]);
    expect(categoryNames(forSale(menuOf(state)))[3]).toBe("Extras y Toppings");
    expect(productsInCategory(menuOf(state), "extras")).toHaveLength(
      productsInCategory(catalog, "extras").length,
    );
    expect(
      rejectionOf(() =>
        updateCategory(
          state,
          at(),
          { categoryId: "extras", name: "postres" },
          catalog,
        ),
      ),
    ).toBe("duplicate-category");
    expect(
      rejectionOf(() =>
        updateCategory(
          state,
          at(),
          { categoryId: "extras", name: " " },
          catalog,
        ),
      ),
    ).toBe("invalid-category-name");
    expect(
      rejectionOf(() =>
        updateCategory(
          state,
          at(),
          { categoryId: "extras", name: "EXTRAS Y TOPPINGS" },
          catalog,
        ),
      ),
    ).toBe("not rejected");
    expect(
      rejectionOf(() =>
        updateCategory(
          state,
          at(),
          { categoryId: "panes", name: "Panes" },
          catalog,
        ),
      ),
    ).toBe("unknown-category");
  });

  it("[C] Admin sube y baja una categoría", () => {
    let state = moveCat(emptyState(), "cafe", "up");
    expect(categoryNames(menuOf(state))).toEqual([
      "Bebidas",
      "Salado",
      "Postres",
      "Café",
      "Extras",
    ]);
    expect(categoryNames(forSale(menuOf(state)))).toEqual([
      "Bebidas",
      "Salado",
      "Postres",
      "Café",
      "Extras",
    ]);
    expect(
      rejectionOf(() =>
        moveCategory(
          state,
          at(),
          { categoryId: "bebidas", direction: "up" },
          catalog,
        ),
      ),
    ).toBe("invalid-move");
    expect(
      rejectionOf(() =>
        moveCategory(
          state,
          at(),
          { categoryId: "extras", direction: "down" },
          catalog,
        ),
      ),
    ).toBe("invalid-move");

    state = moveCat(state, "cafe", "up");
    state = moveCat(state, "bebidas", "down");
    expect(categoryNames(menuOf(state))).toEqual([
      "Salado",
      "Bebidas",
      "Café",
      "Postres",
      "Extras",
    ]);
  });

  it("[C] Admin ordena los productos dentro de su categoría", () => {
    expect(namesIn(menuOf(emptyState()), "postres").slice(0, 4)).toEqual([
      "Affogato",
      "Helado",
      "Croissant Dulce",
      "Brownie",
    ]);
    const state = moveProd(emptyState(), brownie.id, "up");
    expect(namesIn(menuOf(state), "postres").slice(0, 4)).toEqual([
      "Affogato",
      "Helado",
      "Brownie",
      "Croissant Dulce",
    ]);
    expect(namesIn(forSale(menuOf(state)), "postres").slice(0, 4)).toEqual([
      "Affogato",
      "Helado",
      "Brownie",
      "Croissant Dulce",
    ]);
    expect(namesIn(menuOf(state), "bebidas")).toEqual(
      namesIn(catalog, "bebidas"),
    );
    expect(
      rejectionOf(() =>
        moveProduct(
          state,
          at(),
          { productId: affogato.id, direction: "up" },
          catalog,
        ),
      ),
    ).toBe("invalid-move");
    const last = productsInCategory(catalog, "postres").at(-1);
    expect(
      rejectionOf(() =>
        moveProduct(
          state,
          at(),
          { productId: last!.id, direction: "down" },
          catalog,
        ),
      ),
    ).toBe("invalid-move");
    expect(
      rejectionOf(() =>
        moveProduct(
          state,
          at(),
          { productId: "52000822999", direction: "up" },
          catalog,
        ),
      ),
    ).toBe("unknown-product");
  });

  it("[C] Una categoría oculta oculta sus productos en Venta", () => {
    let state = run(emptyState(), (current) =>
      saveOrder(current, at(luis), {
        orderId: "o-1",
        header: mostrador,
        lines: linesOf([fresas]),
      }),
    );
    const captured = structuredClone(state.orders["o-1"]);
    state = run(state, (current) =>
      updateProduct(
        current,
        at(),
        { productId: mango.id, active: false },
        catalog,
      ),
    );
    state = editCategory(state, { categoryId: "extras", active: false });

    const sale = forSale(menuOf(state));
    expect(sale.categories.map((category) => category.id)).not.toContain(
      "extras",
    );
    expect(productsInCategory(sale, "extras")).toEqual([]);
    expect(
      menuOf(state).categories.find((c) => c.id === "extras"),
    ).toMatchObject({ active: false });
    expect(productsInCategory(menuOf(state), "extras")).toHaveLength(
      productsInCategory(catalog, "extras").length,
    );
    expect(state.orders["o-1"]).toEqual(captured);

    state = editCategory(state, { categoryId: "extras", active: true });
    const back = forSale(menuOf(state));
    expect(back.categories.map((category) => category.id)).toContain("extras");
    const extras = productsInCategory(back, "extras").map((item) => item.id);
    expect(extras).toContain(fresas.id);
    expect(extras).not.toContain(mango.id);
  });

  it("[C] Solo Admin crea, renombra, ordena u oculta categorías", () => {
    for (const actor of [luis, sofi]) {
      const attempts = [
        () =>
          createCategory(
            emptyState(),
            at(actor),
            { categoryId: "x", name: "X" },
            catalog,
          ),
        () =>
          updateCategory(
            emptyState(),
            at(actor),
            { categoryId: "extras", name: "X" },
            catalog,
          ),
        () =>
          updateCategory(
            emptyState(),
            at(actor),
            { categoryId: "extras", active: false },
            catalog,
          ),
        () =>
          moveCategory(
            emptyState(),
            at(actor),
            { categoryId: "cafe", direction: "up" },
            catalog,
          ),
        () =>
          moveProduct(
            emptyState(),
            at(actor),
            { productId: brownie.id, direction: "up" },
            catalog,
          ),
      ];
      for (const attempt of attempts) {
        expect(rejectionOf(attempt)).toBe("not-allowed");
      }
    }
  });
});

describe("EVL-119 [C] Orden del menú", () => {
  it("puts a new product and a product moved to another category at the end of that category", () => {
    let state = run(emptyState(), (current) =>
      createProduct(
        current,
        at(),
        {
          sku: "52000822227",
          name: "Pay de Queso",
          categoryId: "postres",
          priceCents: 5500,
        },
        catalog,
      ),
    );
    expect(namesIn(menuOf(state), "postres").at(-1)).toBe("Pay de Queso");
    state = run(state, (current) =>
      updateProduct(
        current,
        at(),
        { productId: croissant.id, categoryId: "salado" },
        catalog,
      ),
    );
    expect(namesIn(menuOf(state), "salado").at(-1)).toBe("Croissant Dulce");
    expect(namesIn(menuOf(state), "postres")).not.toContain("Croissant Dulce");
    state = moveProd(state, croissant.id, "up");
    expect(namesIn(menuOf(state), "salado").slice(-2)).toEqual([
      "Croissant Dulce",
      productsInCategory(catalog, "salado").at(-1)!.name,
    ]);
  });

  it("counts hidden categories and hidden products as neighbours", () => {
    let state = editCategory(emptyState(), {
      categoryId: "extras",
      active: false,
    });
    state = moveCat(state, "cafe", "up");
    expect(categoryNames(menuOf(state))).toEqual([
      "Bebidas",
      "Salado",
      "Postres",
      "Café",
      "Extras",
    ]);
    state = run(state, (current) =>
      updateProduct(
        current,
        at(),
        { productId: croissant.id, active: false },
        catalog,
      ),
    );
    state = moveProd(state, brownie.id, "up");
    expect(namesIn(menuOf(state), "postres").slice(0, 4)).toEqual([
      "Affogato",
      "Helado",
      "Brownie",
      "Croissant Dulce",
    ]);
  });

  it("moves a created category like any other and keeps the base menu when nothing changed", () => {
    let state = run(emptyState(), (current) =>
      createCategory(
        current,
        at(),
        { categoryId: "panes", name: "Panes" },
        catalog,
      ),
    );
    state = moveCat(state, "panes", "up");
    expect(categoryNames(menuOf(state)).slice(-2)).toEqual(["Panes", "Café"]);
    expect(menuFor(catalog, emptyState().menu)).toEqual(catalog);
    expect(forSale(menuOf(emptyState()))).toEqual(catalog);
  });

  it("lets the base menu win when a later deploy adds a category with the same id", () => {
    const state = run(emptyState(), (current) =>
      createCategory(
        current,
        at(),
        { categoryId: "panes", name: "Panes" },
        catalog,
      ),
    );
    const later: Catalog = {
      ...catalog,
      categories: [
        ...catalog.categories,
        { id: "panes", name: "Panadería", sortOrder: 5, active: true },
      ],
    };
    const merged = menuFor(later, state.menu);
    expect(merged.categories.filter((c) => c.id === "panes")).toHaveLength(1);
    expect(merged.categories.find((c) => c.id === "panes")?.name).toBe(
      "Panadería",
    );
  });
});
