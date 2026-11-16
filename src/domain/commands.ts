// Commands: each function checks the rules against the current state and
// returns the batch to append to the journal. They never change state
// themselves; `applyBatch` does, when the batch is committed.
import type { Permission } from "./access.ts";
import { can } from "./access.ts";
import type {
  CommandBatch,
  CommandMeta,
  OrderHeader,
  PosState,
} from "./journal.ts";
import { folioFor } from "./journal.ts";
import type { OrderLine } from "./order.ts";

export type CommandRejection =
  | "not-allowed"
  | "empty-order"
  | "order-closed"
  | "unknown-order"
  | "table-required"
  | "table-unavailable"
  | "invalid-table-count"
  | "missing-customer-data"
  | "sent-to-kitchen"
  | "nothing-new"
  | "unknown-comanda"
  | "comanda-finished"
  | "pending-balance"
  | "invalid-tip";

export class CommandRejectedError extends Error {
  readonly reason: CommandRejection;
  /** The permission that was missing, for "not-allowed". */
  readonly permission: Permission | undefined;
  /** The customer fields that are missing, for "missing-customer-data". */
  readonly fields: readonly string[];

  constructor(
    reason: CommandRejection,
    permission?: Permission,
    fields: readonly string[] = [],
  ) {
    super(`Command rejected: ${reason}`);
    this.name = "CommandRejectedError";
    this.reason = reason;
    this.permission = permission;
    this.fields = fields;
  }
}

export type SaveOrderInput = {
  /** Stable ID chosen by the caller when the order is first captured. */
  orderId: string;
  header: OrderHeader;
  lines: OrderLine[];
};

/**
 * Saves an open account: creates it with the next folio, or replaces the
 * header and lines of an existing open one.
 */
export function saveOrder(
  state: PosState,
  meta: CommandMeta,
  input: SaveOrderInput,
): CommandBatch {
  if (!can(meta.actor.role, "capture-order")) {
    throw new CommandRejectedError("not-allowed", "capture-order");
  }
  if (input.lines.length === 0) {
    throw new CommandRejectedError("empty-order");
  }
  const existing = Object.hasOwn(state.orders, input.orderId)
    ? state.orders[input.orderId]
    : undefined;
  if (existing && existing.status !== "open") {
    throw new CommandRejectedError("order-closed");
  }
  if (input.header.type === "mesa") {
    const table = input.header.table;
    if (table === null) throw new CommandRejectedError("table-required");
    if (
      (!Number.isSafeInteger(table) || table < 1 || table > state.tableCount) &&
      existing?.header.table !== table
    ) {
      throw new CommandRejectedError("table-unavailable");
    }
  }
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "order-saved",
        orderId: input.orderId,
        folio: existing?.folio ?? folioFor(state.lastFolioNumber + 1),
        header: structuredClone(input.header),
        lines: structuredClone(input.lines),
      },
    ],
  };
}
