import type { Catalog, Product } from "./catalog.ts";
import type { Actor, CommandBatch, CommandMeta, PosState } from "./journal.ts";
import { can } from "./access.ts";
import { findProduct } from "./catalog.ts";
import { CommandRejectedError } from "./commands.ts";

export type ProductChanges = Partial<
  Pick<Product, "priceCents" | "available" | "name" | "categoryId" | "active">
>;

export type MenuEdit = { at: string; by: Actor };

export type ProductPatch = { changes: ProductChanges; lastEdit: MenuEdit };

export type MenuState = {
  products: Record<string, ProductPatch>;
  created: Product[];
};

export const SKU_SERIES = "52000822";

export type NewProductInput = {
  sku: string;
  name: string;
  categoryId: string;
  priceCents: number;
};

export type ProductEdit = {
  productId: string;
  name?: string;
  categoryId?: string;
  active?: boolean;
};

export function emptyMenu(): MenuState {
  return { products: {}, created: [] };
}

export function suggestedSku(menu: Catalog): string {
  let highest = Number(`${SKU_SERIES}000`);
  for (const { sku } of menu.products) {
    if (sku.startsWith(SKU_SERIES) && /^[0-9]{11}$/.test(sku)) {
      highest = Math.max(highest, Number(sku));
    }
  }
  return String(highest + 1);
}

export function forSale(menu: Catalog): Catalog {
  return {
    ...menu,
    products: menu.products.filter((product) => product.active !== false),
  };
}

export function createProduct(
  state: PosState,
  meta: CommandMeta,
  input: NewProductInput,
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "edit-menu")) {
    throw new CommandRejectedError("not-allowed", "edit-menu");
  }
  const current = menuFor(base, state.menu);
  const { sku, categoryId, priceCents } = input;
  const name = input.name.trim();
  if (name === "") {
    throw new CommandRejectedError("invalid-name");
  }
  if (!current.categories.some((category) => category.id === categoryId)) {
    throw new CommandRejectedError("unknown-category");
  }
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) {
    throw new CommandRejectedError("invalid-price");
  }
  if (!/^[0-9]{1,20}$/.test(sku)) {
    throw new CommandRejectedError("invalid-sku");
  }
  if (
    current.products.some(
      (product) => product.id === sku || product.sku === sku,
    )
  ) {
    throw new CommandRejectedError("duplicate-sku");
  }
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "product-created",
        product: {
          id: sku,
          sku,
          name,
          categoryId,
          priceCents,
          available: true,
          active: true,
          modifierGroupIds: [],
        },
      },
    ],
  };
}

export function updateProduct(
  state: PosState,
  meta: CommandMeta,
  input: ProductEdit,
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "edit-menu")) {
    throw new CommandRejectedError("not-allowed", "edit-menu");
  }
  const current = menuFor(base, state.menu);
  const { productId, categoryId, active } = input;
  if (!findProduct(current, productId)) {
    throw new CommandRejectedError("unknown-product");
  }
  const name = input.name?.trim();
  if (name === "") {
    throw new CommandRejectedError("invalid-name");
  }
  if (
    categoryId !== undefined &&
    !current.categories.some((category) => category.id === categoryId)
  ) {
    throw new CommandRejectedError("unknown-category");
  }
  const changes: ProductChanges = {
    ...(name !== undefined ? { name } : {}),
    ...(categoryId !== undefined ? { categoryId } : {}),
    ...(active !== undefined ? { active } : {}),
  };
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [{ type: "product-updated", productId, changes }],
  };
}

export function menuFor(base: Catalog, menu: MenuState): Catalog {
  const products = [...base.products];
  const productIds = new Set(products.map((product) => product.id));
  for (const product of menu.created) {
    if (productIds.has(product.id)) continue;
    products.push(product);
    productIds.add(product.id);
  }
  return {
    ...base,
    products: products.map((product) =>
      Object.hasOwn(menu.products, product.id)
        ? { ...product, ...menu.products[product.id].changes }
        : product,
    ),
  };
}

export function lastEdit(menu: MenuState, productId: string): MenuEdit | null {
  return Object.hasOwn(menu.products, productId)
    ? menu.products[productId].lastEdit
    : null;
}

export function editLabel(edit: MenuEdit): string {
  const day = String(Number(edit.at.slice(8, 10)));
  const month = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ][Number(edit.at.slice(5, 7)) - 1];
  const time = edit.at.slice(11, 16);
  return `Editado por ${edit.by.name} · ${day} ${month}, ${time}`;
}

export function setProductPrice(
  state: PosState,
  meta: CommandMeta,
  input: { productId: string; priceCents: number },
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "edit-menu")) {
    throw new CommandRejectedError("not-allowed", "edit-menu");
  }
  if (!findProduct(menuFor(base, state.menu), input.productId)) {
    throw new CommandRejectedError("unknown-product");
  }
  if (!Number.isSafeInteger(input.priceCents) || input.priceCents <= 0) {
    throw new CommandRejectedError("invalid-price");
  }
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "product-updated",
        productId: input.productId,
        changes: { priceCents: input.priceCents },
      },
    ],
  };
}

export function setProductAvailability(
  state: PosState,
  meta: CommandMeta,
  input: { productId: string; available: boolean },
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "set-availability")) {
    throw new CommandRejectedError("not-allowed", "set-availability");
  }
  if (!findProduct(menuFor(base, state.menu), input.productId)) {
    throw new CommandRejectedError("unknown-product");
  }
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "product-updated",
        productId: input.productId,
        changes: { available: input.available },
      },
    ],
  };
}
