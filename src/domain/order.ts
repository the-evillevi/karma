// Order lines and totals (EVL-121 [A]). Pure functions over immutable arrays.
// A line is a snapshot: later catalog changes never alter a captured line.
import type { Product } from "./catalog.ts";

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
  void line;
  throw new Error("not implemented");
}

export function lineTotalCents(line: OrderLine): number {
  void line;
  throw new Error("not implemented");
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
  void lines;
  void product;
  void input;
  throw new Error("not implemented");
}

/** Adds `delta` to a line's quantity; reaching zero or less removes the line. */
export function changeQuantity(
  lines: readonly OrderLine[],
  lineId: string,
  delta: number,
): OrderLine[] {
  void lines;
  void lineId;
  void delta;
  throw new Error("not implemented");
}

export function removeLine(
  lines: readonly OrderLine[],
  lineId: string,
): OrderLine[] {
  void lines;
  void lineId;
  throw new Error("not implemented");
}

export function orderTotals(
  lines: readonly OrderLine[],
  taxRateBps: number,
): OrderTotals {
  void lines;
  void taxRateBps;
  throw new Error("not implemented");
}
