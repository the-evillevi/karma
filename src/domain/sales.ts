// Today's closed sales (EVL-130 [A]).
import type { Order, PosState } from "./journal.ts";
import type { PaymentMethod } from "./payment.ts";

export type DaySummary = {
  /** Closed sales of the day, most recent first. */
  sales: Order[];
  count: number;
  /** Product sales, IVA included, without tips. */
  salesCents: number;
  tipsCents: number;
  /** Net amount collected (sales plus tips) by payment method. */
  byMethod: Record<PaymentMethod, number>;
};

/**
 * Sales closed on the local calendar day `day` ("2026-11-15"). The day of a
 * sale is the date part of its `closedAt` timestamp as written on the device.
 */
export function daySummary(state: PosState, day: string): DaySummary {
  void state;
  void day;
  throw new Error("not implemented");
}
