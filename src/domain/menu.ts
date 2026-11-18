import type { Catalog, Product } from "./catalog.ts";
import type { Actor, CommandBatch, CommandMeta, PosState } from "./journal.ts";
import { can } from "./access.ts";
import { findProduct } from "./catalog.ts";
import { CommandRejectedError } from "./commands.ts";

export type ProductChanges = Partial<Pick<Product, "priceCents" | "available">>;

export type MenuEdit = { at: string; by: Actor };

export type ProductPatch = { changes: ProductChanges; lastEdit: MenuEdit };

export type MenuState = { products: Record<string, ProductPatch> };

export function emptyMenu(): MenuState {
  return { products: {} };
}

export function menuFor(base: Catalog, menu: MenuState): Catalog {
  return {
    ...base,
    products: base.products.map((product) =>
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
