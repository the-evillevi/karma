// Open accounts (EVL-122 [C]): what the "Cuentas abiertas" list shows.
import type { Order, PosState } from "./journal.ts";

export type AccountSummary = {
  orderId: string;
  folio: string;
  /** "Mesa 3", "Recoger · Ana", "Mostrador"… */
  label: string;
  typeLabel: string;
  /** Who opened the account. */
  responsible: string;
  openedAt: string;
  totalCents: number;
  itemCount: number;
};

/** Accounts that are still open, oldest first. */
export function openOrders(state: PosState): Order[] {
  void state;
  throw new Error("not implemented");
}

export function accountSummary(
  order: Order,
  taxRateBps: number,
): AccountSummary {
  void order;
  void taxRateBps;
  throw new Error("not implemented");
}
