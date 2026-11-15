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
  "not-allowed" | "empty-order" | "order-closed" | "unknown-order";

export class CommandRejectedError extends Error {
  readonly reason: CommandRejection;
  /** The permission that was missing, for "not-allowed". */
  readonly permission: Permission | undefined;

  constructor(reason: CommandRejection, permission?: Permission) {
    super(`Command rejected: ${reason}`);
    this.name = "CommandRejectedError";
    this.reason = reason;
    this.permission = permission;
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
