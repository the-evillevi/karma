// Closing a sale (EVL-123 [D]). A closed sale keeps its payment, tip and
// change forever: it cannot be charged again or edited.
import type { CommandBatch, CommandMeta, Order, PosState } from "./journal.ts";
import type { PaymentInput, PaymentMethod } from "./payment.ts";

/** How each method is named on screen and on the ticket (EVL-123 [C]). */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  card: "Tarjeta manual",
  transfer: "Transferencia",
};

export type CloseSaleInput = {
  orderId: string;
  tipCents: number;
  payment: PaymentInput;
};

/**
 * Charges an open account with one payment that covers the order plus tip.
 * Admin and Barra only.
 */
export function closeSale(
  state: PosState,
  meta: CommandMeta,
  input: CloseSaleInput,
  taxRateBps: number,
): CommandBatch {
  void state;
  void meta;
  void input;
  void taxRateBps;
  throw new Error("not implemented");
}

/** Closed sales, most recent first. */
export function closedSales(state: PosState): Order[] {
  void state;
  throw new Error("not implemented");
}
