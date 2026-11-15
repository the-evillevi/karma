// Single payment for checkout (EVL-123 [B]). Money is integer centavos.
// The pilot takes one payment per order; split payments are EVL-192.

export type PaymentMethod = "cash" | "card" | "transfer";

export type PaymentInput = {
  method: PaymentMethod;
  /** What the customer hands over: for cash this may exceed the amount due. */
  receivedCents: number;
};

export type Settlement = {
  method: PaymentMethod;
  amountDueCents: number;
  receivedCents: number;
  /** Returned to the customer. Only cash can produce change. */
  changeCents: number;
  /** What actually settles the order: received minus change. */
  netCents: number;
  pendingCents: number;
  canConfirm: boolean;
};

export type PaymentRejection = "invalid-amount" | "only-cash-gives-change";

export class PaymentRejectedError extends Error {
  readonly reason: PaymentRejection;

  constructor(reason: PaymentRejection) {
    super(`Payment rejected: ${reason}`);
    this.name = "PaymentRejectedError";
    this.reason = reason;
  }
}

/**
 * Applies one payment to the amount due (order plus tip).
 * Throws PaymentRejectedError when the payment cannot be registered.
 */
export function settle(
  amountDueCents: number,
  payment: PaymentInput,
): Settlement {
  void amountDueCents;
  void payment;
  throw new Error("not implemented");
}
