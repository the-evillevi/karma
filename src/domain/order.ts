// Order lines and totals (EVL-121 [A]). Pure functions over immutable arrays.
// A line is a snapshot: later catalog changes never alter a captured line.
import type { Product } from "./catalog.ts";
import { taxBreakdown } from "./money.ts";

export type LineModifier = {
  groupId: string;
  groupName: string;
  optionId: string;
  name: string;
  priceDeltaCents: number;
};

export type OrderLine = {
  /** Stable ID supplied by the caller; never reused. */
  lineId: string;
  productId: string;
  /** Product name captured when the line was added. */
  name: string;
  /** Product price captured when the line was added, without modifiers. */
  unitPriceCents: number;
  modifiers: LineModifier[];
  /** Preparation note, trimmed. Empty string means no note. */
  note: string;
  quantity: number;
};

export type LineInput = {
  lineId: string;
  modifiers?: LineModifier[];
  note?: string;
  quantity?: number;
};

export type OrderTotals = {
  /** Sum of quantities across lines. */
  itemCount: number;
  /** What the customer pays for the products, IVA included. */
  totalCents: number;
  netCents: number;
  taxCents: number;
};

export type OrderRejection =
  "product-unavailable" | "unknown-line" | "invalid-quantity";

export class OrderError extends Error {
  readonly reason: OrderRejection;

  constructor(reason: OrderRejection) {
    super(`Order change rejected: ${reason}`);
    this.name = "OrderError";
    this.reason = reason;
  }
}

/** Unit price of a line including its modifiers. */
export function lineUnitCents(line: OrderLine): number {
  return line.modifiers.reduce(
    (total, modifier) => total + modifier.priceDeltaCents,
    line.unitPriceCents,
  );
}

export function lineTotalCents(line: OrderLine): number {
  return lineUnitCents(line) * line.quantity;
}

function modifierKey(modifiers: readonly LineModifier[]): string {
  const pairs = new Set(
    modifiers.map(({ groupId, optionId }) =>
      JSON.stringify([groupId, optionId]),
    ),
  );
  return JSON.stringify([...pairs].sort());
}

/**
 * Adds a product. If a line with the same product, modifiers and note exists,
 * its quantity grows and its lineId is kept; otherwise a new line is appended.
 */
export function addLine(
  lines: readonly OrderLine[],
  product: Product,
  input: LineInput,
): OrderLine[] {
  if (product.available === false) {
    throw new OrderError("product-unavailable");
  }
  const quantity = input.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new OrderError("invalid-quantity");
  }
  const note = input.note?.trim() ?? "";
  const modifiers = input.modifiers ?? [];
  const key = modifierKey(modifiers);
  const index = lines.findIndex(
    (line) =>
      line.productId === product.id &&
      line.note.trim() === note &&
      modifierKey(line.modifiers) === key,
  );
  if (index !== -1) {
    return lines.map((line, position) =>
      position === index
        ? { ...line, quantity: line.quantity + quantity }
        : line,
    );
  }
  return [
    ...lines,
    {
      lineId: input.lineId,
      productId: product.id,
      name: product.name,
      unitPriceCents: product.priceCents,
      modifiers: modifiers.map((modifier) => ({ ...modifier })),
      note,
      quantity,
    },
  ];
}

/** Adds `delta` to a line's quantity; reaching zero or less removes the line. */
export function changeQuantity(
  lines: readonly OrderLine[],
  lineId: string,
  delta: number,
): OrderLine[] {
  if (!lines.some((line) => line.lineId === lineId)) {
    throw new OrderError("unknown-line");
  }
  if (!Number.isSafeInteger(delta)) {
    throw new OrderError("invalid-quantity");
  }
  return lines.flatMap((line) => {
    if (line.lineId !== lineId) return [line];
    const quantity = line.quantity + delta;
    return quantity <= 0 ? [] : [{ ...line, quantity }];
  });
}

export function removeLine(
  lines: readonly OrderLine[],
  lineId: string,
): OrderLine[] {
  if (!lines.some((line) => line.lineId === lineId)) {
    throw new OrderError("unknown-line");
  }
  return lines.filter((line) => line.lineId !== lineId);
}

export function orderTotals(
  lines: readonly OrderLine[],
  taxRateBps: number,
): OrderTotals {
  const totalCents = lines.reduce(
    (total, line) => total + lineTotalCents(line),
    0,
  );
  return {
    itemCount: lines.reduce((count, line) => count + line.quantity, 0),
    totalCents,
    ...taxBreakdown(totalCents, taxRateBps),
  };
}
