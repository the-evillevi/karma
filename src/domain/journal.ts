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
  return {
    orders: {},
    comandas: {},
    tableCount: DEFAULT_TABLE_COUNT,
    lastFolioNumber: 0,
    applied: {},
  };
}

/** "A-0001" for 1. */
export function folioFor(folioNumber: number): string {
  return `A-${String(folioNumber).padStart(4, "0")}`;
}

function fingerprint(batch: CommandBatch): string {
  return JSON.stringify(batch, (_key, value: unknown) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, record[key]]),
      );
    }
    return value;
  });
}

/**
 * Returns the state after the batch. Never mutates `state`.
 * A batch whose commandId was already applied with identical content returns
 * `state` unchanged; with different content it throws JournalConflictError.
 */
export function applyBatch(state: PosState, batch: CommandBatch): PosState {
  const identity = fingerprint(batch);
  if (Object.hasOwn(state.applied, batch.commandId)) {
    if (state.applied[batch.commandId] !== identity) {
      throw new JournalConflictError(batch.commandId);
    }
    return state;
  }
  const next = structuredClone(state);
  const snapshot = structuredClone(batch);
  for (const event of snapshot.events) {
    switch (event.type) {
      case "order-saved": {
        const existing = Object.hasOwn(next.orders, event.orderId)
          ? next.orders[event.orderId]
          : undefined;
        const order: Order = existing
          ? {
              ...existing,
              header: event.header,
              lines: event.lines,
              version: existing.version + 1,
              updatedAt: snapshot.at,
              updatedBy: snapshot.actor,
            }
          : {
              orderId: event.orderId,
              folio: event.folio,
              header: event.header,
              lines: event.lines,
              status: "open",
              version: 1,
              openedAt: snapshot.at,
              updatedAt: snapshot.at,
              openedBy: snapshot.actor,
              updatedBy: snapshot.actor,
              sentQuantities: {},
              sale: null,
            };
        next.orders = { ...next.orders, [event.orderId]: order };
        if (!existing) {
          next.lastFolioNumber = Math.max(
            next.lastFolioNumber,
            Number(event.folio.slice(2)),
          );
        }
        break;
      }
      case "tables-configured":
        next.tableCount = event.count;
        break;
      case "comanda-sent": {
        const order = next.orders[event.orderId];
        next.comandas = {
          ...next.comandas,
          [event.comandaId]: {
            comandaId: event.comandaId,
            orderId: event.orderId,
            folio: order.folio,
            header: structuredClone(order.header),
            lines: event.lines,
            status: "queued",
            sentAt: snapshot.at,
            sentBy: snapshot.actor,
            updatedAt: snapshot.at,
          },
        };
        for (const line of event.lines) {
          const sent = Object.hasOwn(order.sentQuantities, line.lineId)
            ? order.sentQuantities[line.lineId]
            : 0;
          order.sentQuantities = {
            ...order.sentQuantities,
            [line.lineId]: sent + line.quantity,
          };
        }
        break;
      }
      case "preparation-advanced":
        next.comandas[event.comandaId].status = event.status;
        next.comandas[event.comandaId].updatedAt = snapshot.at;
        break;
      case "sale-closed":
        throw new Error(`not implemented: ${event.type}`);
      default: {
        const unhandled: never = event;
        throw new Error(`Unknown event: ${JSON.stringify(unhandled)}`);
      }
    }
  }
  next.applied = { ...next.applied, [snapshot.commandId]: identity };
  return next;
}

/** Rebuilds the state from the journal, in order. */
export function replay(batches: readonly CommandBatch[]): PosState {
  return batches.reduce(applyBatch, emptyState());
}
