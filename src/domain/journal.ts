// The operations journal (EVL-126 [A]). Every operation is one immutable
// command batch with a stable ID, actor and time. State is never stored: it is
// rebuilt by replaying the batches, so retries cannot duplicate an operation
// and closed sales cannot be edited. See docs/domain/order-lifecycle.md.
import type { Role } from "./access.ts";
import type { OrderLine, OrderTotals } from "./order.ts";
import type { Settlement } from "./payment.ts";

export type Actor = { userId: string; name: string; role: Role };

export type CommandMeta = {
  /** Stable across retries. Applying the same command twice is a no-op. */
  commandId: string;
  /** ISO 8601 timestamp taken on the device when the operation was made. */
  at: string;
  actor: Actor;
  deviceId: string;
};

export type OrderType = "mostrador" | "mesa" | "recoger" | "entrega";

export type Customer = { name: string; phone: string; address: string };

export type OrderHeader = {
  type: OrderType;
  /** Table number, or null when the order has no table. */
  table: number | null;
  customer: Customer;
};

export type PreparationStatus = "queued" | "preparing" | "ready" | "served";

/** What the kitchen sees: no prices. */
export type ComandaLine = {
  lineId: string;
  name: string;
  quantity: number;
  modifiers: string[];
  note: string;
};

export type PosEvent =
  | {
      type: "order-saved";
      orderId: string;
      folio: string;
      header: OrderHeader;
      /** Full snapshot of the order's lines at save time. */
      lines: OrderLine[];
    }
  | {
      type: "comanda-sent";
      orderId: string;
      comandaId: string;
      lines: ComandaLine[];
    }
  | {
      type: "preparation-advanced";
      comandaId: string;
      status: PreparationStatus;
    }
  | {
      type: "sale-closed";
      orderId: string;
      tipCents: number;
      settlement: Settlement;
      totals: OrderTotals;
    }
  | { type: "tables-configured"; count: number };

export type CommandBatch = CommandMeta & { events: PosEvent[] };

export type ClosedSale = {
  closedAt: string;
  closedBy: Actor;
  tipCents: number;
  settlement: Settlement;
  totals: OrderTotals;
};

export type Order = {
  orderId: string;
  /** Human-readable consecutive number, e.g. "A-0001". Never changes. */
  folio: string;
  header: OrderHeader;
  lines: OrderLine[];
  /** Financial status. Independent from the preparation of its comandas. */
  status: "open" | "paid";
  /** Starts at 1 and grows by one with every save. */
  version: number;
  openedAt: string;
  openedBy: Actor;
  updatedAt: string;
  updatedBy: Actor;
  /** Quantity of each line already sent to the kitchen, by lineId. */
  sentQuantities: Record<string, number>;
  sale: ClosedSale | null;
};

export type Comanda = {
  comandaId: string;
  orderId: string;
  folio: string;
  header: OrderHeader;
  lines: ComandaLine[];
  status: PreparationStatus;
  sentAt: string;
  sentBy: Actor;
  updatedAt: string;
};

export type PosState = {
  orders: Record<string, Order>;
  comandas: Record<string, Comanda>;
  tableCount: number;
  /** Number used by the most recent folio; the next order gets this plus one. */
  lastFolioNumber: number;
  /** Applied command IDs mapped to a fingerprint of their content. */
  applied: Record<string, string>;
};

export const DEFAULT_TABLE_COUNT = 8;

/** A command ID was reused with different content. Nothing is overwritten. */
export class JournalConflictError extends Error {
  readonly commandId: string;

  constructor(commandId: string) {
    super(`Command ${commandId} was already applied with different content`);
    this.name = "JournalConflictError";
    this.commandId = commandId;
  }
}

export function emptyState(): PosState {
  throw new Error("not implemented");
}

/** "A-0001" for 1. */
export function folioFor(folioNumber: number): string {
  void folioNumber;
  throw new Error("not implemented");
}

/**
 * Returns the state after the batch. Never mutates `state`.
 * A batch whose commandId was already applied with identical content returns
 * `state` unchanged; with different content it throws JournalConflictError.
 */
export function applyBatch(state: PosState, batch: CommandBatch): PosState {
  void state;
  void batch;
  throw new Error("not implemented");
}

/** Rebuilds the state from the journal, in order. */
export function replay(batches: readonly CommandBatch[]): PosState {
  void batches;
  throw new Error("not implemented");
}
