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
  lineId: string;
  productId: string;
  name: string;
  unitPriceCents: number;
  modifiers: LineModifier[];
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
  itemCount: number;
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
