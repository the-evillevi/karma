import type { CommandBatch, CommandMeta, Order, PosState } from "./journal.ts";
import type { PaymentInput, PaymentMethod } from "./payment.ts";
import { can } from "./access.ts";
import { CommandRejectedError } from "./commands.ts";
import { orderTotals } from "./order.ts";
import { settle } from "./payment.ts";
import { amountDue } from "./tip.ts";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  card: "Tarjeta manual",
  transfer: "Transferencia",
};

export type CloseSaleInput = {
  orderId: string;
  expectedVersion?: number;
  tipCents: number;
  payment: PaymentInput;
};

export function closeSale(
  state: PosState,
  meta: CommandMeta,
  input: CloseSaleInput,
  taxRateBps: number,
): CommandBatch {
  if (!can(meta.actor.role, "charge")) {
    throw new CommandRejectedError("not-allowed", "charge");
  }
  const order = Object.hasOwn(state.orders, input.orderId)
    ? state.orders[input.orderId]
    : undefined;
  if (!order) throw new CommandRejectedError("unknown-order");
  if (order.status !== "open") throw new CommandRejectedError("order-closed");
  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== order.version
  ) {
    throw new CommandRejectedError("account-changed");
  }
  if (!Number.isSafeInteger(input.tipCents) || input.tipCents < 0) {
    throw new CommandRejectedError("invalid-tip");
  }
  const totals = orderTotals(order.lines, taxRateBps);
  const settlement = settle(
    amountDue(totals.totalCents, input.tipCents).totalDueCents,
    input.payment,
  );
  if (!settlement.canConfirm) throw new CommandRejectedError("pending-balance");
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "sale-closed",
        orderId: input.orderId,
        tipCents: input.tipCents,
        settlement,
        totals,
      },
    ],
  };
}

export function closedSales(state: PosState): Order[] {
  return Object.values(state.orders)
    .filter((order) => order.sale !== null)
    .sort(
      (left, right) =>
        compare(right.sale?.closedAt ?? "", left.sale?.closedAt ?? "") ||
        compare(right.folio, left.folio),
    );
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
