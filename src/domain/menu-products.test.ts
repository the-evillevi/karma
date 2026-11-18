// @vitest-environment node
import { describe, expect, it } from "vitest";
import { findProduct, productsInCategory } from "./catalog.ts";
import type { Catalog, Product } from "./catalog.ts";
import { saveOrder } from "./commands.ts";
import { applyBatch, emptyState, replay } from "./journal.ts";
import type { Actor, CommandBatch, CommandMeta, PosState } from "./journal.ts";
import {
  createProduct,
  forSale,
  lastEdit,
  menuFor,
  setProductAvailability,
  setProductPrice,
  suggestedSku,
  updateProduct,
} from "./menu.ts";
import type { NewProductInput, ProductEdit } from "./menu.ts";
import { parsePesos } from "./money.ts";
import { OrderError, addLine } from "./order.ts";
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

const croissant = product("52000822188");
const crepa = product("52000822212");

const chai: NewProductInput = {
  sku: "52000822227",
  name: "Chai Sucio",
  categoryId: "bebidas",
  priceCents: 7500,
};

function at(commandId: string, actor: Actor, time = "09:00"): CommandMeta {
  return {
    commandId,
    at: `2026-11-18T${time}:00.000-06:00`,
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

function create(
  state: PosState,
  input: NewProductInput,
  actor: Actor = admin,
): PosState {
  return run(state, (current) =>
    createProduct(current, at(`create-${input.sku}`, actor), input, catalog),
  );
}

function edit(state: PosState, input: ProductEdit, id: string): PosState {
  return run(state, (current) =>
    updateProduct(current, at(id, admin), input, catalog),
  );
}

function inMenu(state: PosState, id: string): Product {
  const found = findProduct(menuOf(state), id);
  if (!found) throw new Error(`No product ${id} in the menu`);
  return found;
}

function forSaleIds(state: PosState): string[] {
  return forSale(menuOf(state)).products.map((item) => item.id);
}

function withOpenAccount(item: Product): PosState {
  return run(emptyState(), (current) =>
    saveOrder(current, at("save-1", luis), {
      orderId: "o-1",
      header: mostrador,
      lines: linesOf([item]),
    }),
  );
}

describe("EVL-119 [B] Crear y editar productos", () => {
  it("[B] Admin crea un producto con el SKU sugerido", () => {
    expect(suggestedSku(menuOf(emptyState()))).toBe("52000822227");
    const batch = createProduct(
      emptyState(),
      at("create-1", admin),
      { ...chai, sku: suggestedSku(menuOf(emptyState())) },
      catalog,
    );
    expect(batch.events).toEqual([
      {
        type: "product-created",
        product: {
          id: "52000822227",
          sku: "52000822227",
          name: "Chai Sucio",
          categoryId: "bebidas",
          priceCents: 7500,
          available: true,
          active: true,
          modifierGroupIds: [],
        },
      },
    ]);
    const state = applyBatch(emptyState(), batch);
    const created = inMenu(state, "52000822227");
    expect(
      productsInCategory(forSale(menuOf(state)), "bebidas").map(
        (item) => item.name,
      ),
    ).toContain("Chai Sucio");
    expect(addLine([], created, { lineId: "l1" })[0].unitPriceCents).toBe(7500);
    expect(suggestedSku(menuOf(state))).toBe("52000822228");
    expect(lastEdit(state.menu, "52000822227")).toEqual({
      at: "2026-11-18T09:00:00.000-06:00",
      by: admin,
    });
    expect(menuOf(state).products).toHaveLength(catalog.products.length + 1);
    expect(replay([batch])).toEqual(state);
  });

  it("[B] Admin cambia el SKU sugerido antes de guardar", () => {
    const state = create(emptyState(), {
      sku: "7501055300075",
      name: "Agua Mineral 600 ml",
      categoryId: "bebidas",
      priceCents: 3000,
    });
    expect(inMenu(state, "7501055300075")).toMatchObject({
      sku: "7501055300075",
      name: "Agua Mineral 600 ml",
      priceCents: 3000,
    });
    expect(suggestedSku(menuOf(state))).toBe("52000822227");
  });

  it("[B] No se guarda un producto incompleto o con SKU repetido", () => {
    const attempt = (changes: Partial<NewProductInput>, state = emptyState()) =>
      rejectionOf(() =>
        createProduct(
          state,
          at("bad", admin),
          { ...chai, ...changes },
          catalog,
        ),
      );
    expect(attempt({ name: "" })).toBe("invalid-name");
    expect(attempt({ name: "   " })).toBe("invalid-name");
    expect(attempt({ categoryId: "bebidas-frias" })).toBe("unknown-category");
    expect(attempt({ priceCents: parsePesos("0") ?? Number.NaN })).toBe(
      "invalid-price",
    );
    expect(attempt({ priceCents: 12.5 })).toBe("invalid-price");
    expect(attempt({ sku: "abc" })).toBe("invalid-sku");
    expect(attempt({ sku: "" })).toBe("invalid-sku");
    expect(attempt({ sku: " 52000822227" })).toBe("invalid-sku");
    expect(attempt({ sku: "123456789012345678901" })).toBe("invalid-sku");
    expect(attempt({ sku: "52000822148" })).toBe("duplicate-sku");
    const withChai = create(emptyState(), chai);
    expect(attempt({ name: "Chai Sucio 2" }, withChai)).toBe("duplicate-sku");
    expect(attempt({ sku: "12345678901234567890" })).toBe("not rejected");
    expect(menuOf(emptyState()).products).toHaveLength(catalog.products.length);
  });

  it("[B] Admin renombra un producto y lo cambia de categoría", () => {
    const opened = withOpenAccount(croissant);
    const batch = updateProduct(
      opened,
      at("edit-1", admin),
      {
        productId: croissant.id,
        name: "  Croissant de Mermelada ",
        categoryId: "salado",
      },
      catalog,
    );
    expect(batch.events).toEqual([
      {
        type: "product-updated",
        productId: "52000822188",
        changes: { name: "Croissant de Mermelada", categoryId: "salado" },
      },
    ]);
    const state = applyBatch(opened, batch);
    const sale = forSale(menuOf(state));
    expect(
      productsInCategory(sale, "salado").map((item) => item.name),
    ).toContain("Croissant de Mermelada");
    expect(
      productsInCategory(sale, "postres").map((item) => item.id),
    ).not.toContain("52000822188");
    expect(inMenu(state, croissant.id).sku).toBe("52000822188");
    expect(inMenu(state, croissant.id).priceCents).toBe(croissant.priceCents);
    expect(state.orders["o-1"].lines[0].name).toBe("Croissant Dulce");
  });

  it("[B] Admin oculta un producto y lo vuelve a mostrar", () => {
    const opened = withOpenAccount(crepa);
    const hidden = edit(opened, { productId: crepa.id, active: false }, "hide");
    expect(forSaleIds(hidden)).not.toContain("52000822212");
    expect(inMenu(hidden, crepa.id)).toMatchObject({
      active: false,
      available: true,
    });
    expect(() =>
      addLine([], inMenu(hidden, crepa.id), { lineId: "l1" }),
    ).toThrow(OrderError);
    expect(hidden.orders["o-1"].lines).toEqual(opened.orders["o-1"].lines);

    const shown = edit(hidden, { productId: crepa.id, active: true }, "show");
    expect(forSaleIds(shown)).toContain("52000822212");
    expect(addLine([], inMenu(shown, crepa.id), { lineId: "l1" })[0].name).toBe(
      "Crepa de Champiñones c/Queso",
    );
  });

  it("[B] Solo Admin crea, renombra, mueve u oculta productos", () => {
    const withChai = create(emptyState(), chai);
    for (const actor of [luis, sofi]) {
      expect(
        rejectionOf(() =>
          createProduct(emptyState(), at("create", actor), chai, catalog),
        ),
      ).toBe("not-allowed");
      for (const change of [
        { name: "Croissant" },
        { categoryId: "salado" },
        { active: false },
      ]) {
        expect(
          rejectionOf(() =>
            updateProduct(
              withChai,
              at("edit", actor),
              { productId: croissant.id, ...change },
              catalog,
            ),
          ),
        ).toBe("not-allowed");
      }
    }
    expect(
      rejectionOf(() =>
        setProductAvailability(
          emptyState(),
          at("sold-out", luis),
          { productId: croissant.id, available: false },
          catalog,
        ),
      ),
    ).toBe("not rejected");
  });
});

describe("EVL-119 [B] Productos creados sobre el menú base", () => {
  it("rejects edits that would leave a product without a valid name or category", () => {
    const attempt = (input: ProductEdit) =>
      rejectionOf(() =>
        updateProduct(emptyState(), at("bad", admin), input, catalog),
      );
    expect(attempt({ productId: "52000822999", name: "Nada" })).toBe(
      "unknown-product",
    );
    expect(attempt({ productId: croissant.id, name: "   " })).toBe(
      "invalid-name",
    );
    expect(attempt({ productId: croissant.id, categoryId: "panes" })).toBe(
      "unknown-category",
    );
  });

  it("applies price, availability and edits to a created product", () => {
    let state = create(emptyState(), chai);
    state = run(state, (current) =>
      setProductPrice(
        current,
        at("price", admin, "10:00"),
        { productId: chai.sku, priceCents: 8000 },
        catalog,
      ),
    );
    state = run(state, (current) =>
      setProductAvailability(
        current,
        at("sold-out", luis, "11:00"),
        { productId: chai.sku, available: false },
        catalog,
      ),
    );
    state = edit(state, { productId: chai.sku, name: "Dirty Chai" }, "rename");
    expect(inMenu(state, chai.sku)).toMatchObject({
      name: "Dirty Chai",
      priceCents: 8000,
      available: false,
      active: true,
    });
  });

  it("lets the base menu win when a later deploy adds the same SKU", () => {
    const state = create(emptyState(), chai);
    const later: Catalog = {
      ...catalog,
      products: [
        ...catalog.products,
        { ...croissant, id: chai.sku, sku: chai.sku, name: "Chai Latte Frío" },
      ],
    };
    const merged = menuFor(later, state.menu);
    expect(merged.products.filter((item) => item.id === chai.sku)).toHaveLength(
      1,
    );
    expect(findProduct(merged, chai.sku)?.name).toBe("Chai Latte Frío");
  });

  it("suggests the next number only from the 11-digit 52000822 series", () => {
    let state = create(emptyState(), { ...chai, sku: "5200082299" });
    state = create(state, { ...chai, sku: "520008229999999" });
    state = create(state, { ...chai, sku: "52000822300" });
    expect(suggestedSku(menuOf(state))).toBe("52000822301");
    const empty: Catalog = { ...catalog, products: [] };
    expect(suggestedSku(empty)).toBe("52000822001");
  });

  it("keeps hidden products in the full menu and out of the menu for sale", () => {
    const hidden = edit(
      emptyState(),
      { productId: crepa.id, active: false },
      "hide",
    );
    expect(menuOf(hidden).products).toHaveLength(catalog.products.length);
    expect(forSale(menuOf(hidden)).products).toHaveLength(
      catalog.products.length - 1,
    );
    expect(forSale(menuOf(hidden)).categories).toEqual(catalog.categories);
    expect(forSale(menuOf(emptyState()))).toEqual(catalog);
  });
});
