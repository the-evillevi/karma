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
  const { method, receivedCents } = payment;
  if (
    !Number.isSafeInteger(amountDueCents) ||
    amountDueCents < 0 ||
    !Number.isSafeInteger(receivedCents)
  ) {
    throw new RangeError(
      "Payment amounts must be safe integer centavos with a non-negative amount due",
    );
  }
  if (receivedCents <= 0) {
    throw new PaymentRejectedError("invalid-amount");
  }
  if (method !== "cash" && receivedCents > amountDueCents) {
    throw new PaymentRejectedError("only-cash-gives-change");
  }

  const changeCents =
    method === "cash" && receivedCents > amountDueCents
      ? receivedCents - amountDueCents
      : 0;
  const netCents = receivedCents - changeCents;
  const pendingCents = amountDueCents - netCents;
  return {
    method,
    amountDueCents,
    receivedCents,
    changeCents,
    netCents,
    pendingCents,
    canConfirm: pendingCents === 0,
  };
}
