import type { Catalog, Product } from "./catalog.ts";
import { modifierGroupsFor } from "./catalog.ts";
import type { LineModifier, OrderLine } from "./order.ts";
import { OrderError } from "./order.ts";

export type ModifierSelection = Record<string, string[]>;

export type ModifierRejection =
  "missing-required" | "too-many" | "unknown-group" | "unknown-option";

export class ModifierError extends Error {
  readonly reason: ModifierRejection;
  readonly groupId: string;
  readonly groupName: string;

  constructor(reason: ModifierRejection, groupId: string, groupName = "") {
    super(`Modifier selection rejected: ${reason} (${groupId})`);
    this.name = "ModifierError";
    this.reason = reason;
    this.groupId = groupId;
    this.groupName = groupName;
  }
}

export function defaultSelection(
  catalog: Catalog,
  product: Product,
): ModifierSelection {
  return Object.fromEntries(
    modifierGroupsFor(catalog, product).map((group) => [
      group.id,
      group.defaultOptionId === undefined ||
      group.options.find((option) => option.id === group.defaultOptionId)
        ?.active === false
        ? []
        : [group.defaultOptionId],
    ]),
  );
}

export function resolveModifiers(
  catalog: Catalog,
  product: Product,
  selection: ModifierSelection,
  captured: readonly LineModifier[] = [],
): LineModifier[] {
  const groupIds = new Set(product.modifierGroupIds);
  for (const [groupId, chosen] of Object.entries(selection)) {
    if (!groupIds.has(groupId) && chosen.length > 0) {
      throw new ModifierError("unknown-group", groupId, "");
    }
  }
  const groups = modifierGroupsFor(catalog, product);
  const currentGroupIds = new Set(groups.map((group) => group.id));
  const resolved = groups.flatMap((group) => {
    const chosen = Object.hasOwn(selection, group.id)
      ? selection[group.id]
      : [];
    const capturedOptions = new Map(
      captured
        .filter((modifier) => modifier.groupId === group.id)
        .map((modifier) => [modifier.optionId, modifier]),
    );
    const listed = new Set(group.options.map((option) => option.id));
    const optionIds = new Set([
      ...group.options
        .filter((option) => option.active !== false)
        .map((option) => option.id),
      ...capturedOptions.keys(),
    ]);
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
    const unlistedCaptures = [...capturedOptions.values()].filter(
      (modifier) =>
        selected.has(modifier.optionId) && !listed.has(modifier.optionId),
    );
    return [
      ...group.options
        .filter((option) => selected.has(option.id))
        .map(
          (option) =>
            capturedOptions.get(option.id) ?? {
              groupId: group.id,
              groupName: group.name,
              optionId: option.id,
              name: option.name,
              priceDeltaCents: option.priceDeltaCents,
            },
        ),
      ...unlistedCaptures,
    ];
  });
  return [
    ...resolved,
    ...captured.filter((modifier) => !currentGroupIds.has(modifier.groupId)),
  ];
}

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
