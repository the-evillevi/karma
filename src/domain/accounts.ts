import type { Order, PosState } from "./journal.ts";
import { headerLabel, ORDER_TYPE_LABELS } from "./order-header.ts";
import { orderTotals } from "./order.ts";

export type AccountSummary = {
  orderId: string;
  folio: string;
  label: string;
  typeLabel: string;
  responsible: string;
  openedAt: string;
  totalCents: number;
  itemCount: number;
};

export function openOrders(state: PosState): Order[] {
  return Object.values(state.orders)
    .filter((order) => order.status === "open")
    .sort(
      (left, right) =>
        compare(left.openedAt, right.openedAt) ||
        compare(left.folio, right.folio),
    );
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function accountSummary(
  order: Order,
  taxRateBps: number,
): AccountSummary {
  const { totalCents, itemCount } = orderTotals(order.lines, taxRateBps);
  return {
    orderId: order.orderId,
    folio: order.folio,
    label: headerLabel(order.header),
    typeLabel: ORDER_TYPE_LABELS[order.header.type],
    responsible: order.openedBy.name,
    openedAt: order.openedAt,
    totalCents,
    itemCount,
  };
}
