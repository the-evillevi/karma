import type { Catalog, Product } from "./catalog.ts";
import type { Actor, CommandBatch, CommandMeta, PosState } from "./journal.ts";

export type ProductChanges = Partial<Pick<Product, "priceCents" | "available">>;

export type MenuEdit = { at: string; by: Actor };

export type ProductPatch = { changes: ProductChanges; lastEdit: MenuEdit };

export type MenuState = { products: Record<string, ProductPatch> };

export function emptyMenu(): MenuState {
  return { products: {} };
}

export function menuFor(base: Catalog, menu: MenuState): Catalog {
  throw new Error("not implemented");
}

export function lastEdit(menu: MenuState, productId: string): MenuEdit | null {
  throw new Error("not implemented");
}

export function editLabel(edit: MenuEdit): string {
  throw new Error("not implemented");
}

export function setProductPrice(
  state: PosState,
  meta: CommandMeta,
  input: { productId: string; priceCents: number },
  base: Catalog,
): CommandBatch {
  throw new Error("not implemented");
}

export function setProductAvailability(
  state: PosState,
  meta: CommandMeta,
  input: { productId: string; available: boolean },
  base: Catalog,
): CommandBatch {
  throw new Error("not implemented");
}
