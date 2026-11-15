// Modifier selection for a product (EVL-120 [A]). Groups, limits and prices
// come from the catalog (EVL-112 [B]); the result is a snapshot for the line.
import type { Catalog, Product } from "./catalog.ts";
import type { LineModifier, OrderLine } from "./order.ts";

/** Chosen option IDs per modifier group ID. */
export type ModifierSelection = Record<string, string[]>;

export type ModifierRejection =
  "missing-required" | "too-many" | "unknown-group" | "unknown-option";

export class ModifierError extends Error {
  readonly reason: ModifierRejection;
  readonly groupId: string;
  /** Operator-facing group name, e.g. "Tipo de leche". Empty if unknown. */
  readonly groupName: string;

  constructor(reason: ModifierRejection, groupId: string, groupName = "") {
    super(`Modifier selection rejected: ${reason} (${groupId})`);
    this.name = "ModifierError";
    this.reason = reason;
    this.groupId = groupId;
    this.groupName = groupName;
  }
}

/** The selection a product starts with: each group's default option, if any. */
export function defaultSelection(
  catalog: Catalog,
  product: Product,
): ModifierSelection {
  void catalog;
  void product;
  throw new Error("not implemented");
}

/**
 * Validates a selection against the product's groups and returns the line
 * modifiers, ordered by group and then by option as the catalog lists them.
 */
export function resolveModifiers(
  catalog: Catalog,
  product: Product,
  selection: ModifierSelection,
): LineModifier[] {
  void catalog;
  void product;
  void selection;
  throw new Error("not implemented");
}

/**
 * Re-edits a captured line: replaces its modifiers and/or note, keeping its
 * lineId, quantity, captured name and captured unit price.
 */
export function editLine(
  lines: readonly OrderLine[],
  lineId: string,
  changes: { modifiers?: LineModifier[]; note?: string },
): OrderLine[] {
  void lines;
  void lineId;
  void changes;
  throw new Error("not implemented");
}
