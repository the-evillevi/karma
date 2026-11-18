import type { Order, PosState } from "./journal.ts";
import type { PaymentMethod } from "./payment.ts";
import { closedSales } from "./checkout.ts";

export type DaySummary = {
  sales: Order[];
  count: number;
  salesCents: number;
  tipsCents: number;
  byMethod: Record<PaymentMethod, number>;
};

export function daySummary(state: PosState, day: string): DaySummary {
  const sales = closedSales(state).filter(
    (order) => order.sale?.closedAt.slice(0, 10) === day,
  );
  const summary: DaySummary = {
    sales,
    count: sales.length,
    salesCents: 0,
    tipsCents: 0,
    byMethod: { cash: 0, card: 0, transfer: 0 },
  };
  for (const { sale } of sales) {
    if (!sale) continue;
    summary.salesCents += sale.totals.totalCents;
    summary.tipsCents += sale.tipCents;
    summary.byMethod[sale.settlement.method] += sale.settlement.netCents;
  }
  return summary;
}
