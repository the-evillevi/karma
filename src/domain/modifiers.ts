// Modifier selection for a product (EVL-120 [A]). Groups, limits and prices
// come from the catalog (EVL-112 [B]); the result is a snapshot for the line.
import type { Catalog, Product } from "./catalog.ts";
import { modifierGroupsFor } from "./catalog.ts";
import type { LineModifier, OrderLine } from "./order.ts";
import { OrderError } from "./order.ts";

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
  return Object.fromEntries(
    modifierGroupsFor(catalog, product).map((group) => [
      group.id,
      group.defaultOptionId === undefined ? [] : [group.defaultOptionId],
    ]),
  );
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
  const groupIds = new Set(product.modifierGroupIds);
  for (const [groupId, chosen] of Object.entries(selection)) {
    if (!groupIds.has(groupId) && chosen.length > 0) {
      throw new ModifierError("unknown-group", groupId, "");
    }
  }
  return modifierGroupsFor(catalog, product).flatMap((group) => {
    const chosen = Object.hasOwn(selection, group.id)
      ? selection[group.id]
      : [];
    const optionIds = new Set(group.options.map((option) => option.id));
    if (chosen.some((id) => !optionIds.has(id))) {
      throw new ModifierError("unknown-option", group.id, group.name);
    }
    if (chosen.length > group.max) {
      throw new ModifierError("too-many", group.id, group.name);
    }
    if (chosen.length < group.min) {
      throw new ModifierError("missing-required", group.id, group.name);
    }
    const selected = new Set(chosen);
    return group.options
      .filter((option) => selected.has(option.id))
      .map((option) => ({
        groupId: group.id,
        groupName: group.name,
        optionId: option.id,
        name: option.name,
        priceDeltaCents: option.priceDeltaCents,
      }));
  });
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
  if (!lines.some((line) => line.lineId === lineId)) {
    throw new OrderError("unknown-line");
  }
  return lines.map((line) => {
    const isTarget = line.lineId === lineId;
    const modifiers = isTarget
      ? (changes.modifiers ?? line.modifiers)
      : line.modifiers;
    return {
      ...line,
      modifiers: modifiers.map((modifier) => ({ ...modifier })),
      note:
        isTarget && changes.note !== undefined
          ? changes.note.trim()
          : line.note,
    };
  });
}
