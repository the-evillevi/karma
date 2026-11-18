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
import { missingCustomerFields } from "./order-header.ts";

export type CommandRejection =
  | "not-allowed"
  | "empty-order"
  | "order-closed"
  | "account-changed"
  | "unknown-order"
  | "table-required"
  | "table-unavailable"
  | "invalid-table-count"
  | "missing-customer-data"
  | "sent-to-kitchen"
  | "nothing-new"
  | "unknown-comanda"
  | "comanda-finished"
  | "invalid-preparation-step"
  | "pending-balance"
  | "invalid-tip"
  | "invalid-price"
  | "unknown-product"
  | "invalid-name"
  | "unknown-category"
  | "invalid-sku"
  | "duplicate-sku"
  | "invalid-category-name"
  | "duplicate-category"
  | "invalid-move";

export class CommandRejectedError extends Error {
  readonly reason: CommandRejection;
  readonly permission: Permission | undefined;
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
  orderId: string;
  expectedVersion?: number | null;
  header: OrderHeader;
  lines: OrderLine[];
};

function modifierPairs(line: OrderLine): string {
  return JSON.stringify(
    [
      ...new Set(
        line.modifiers.map(({ groupId, optionId }) =>
          JSON.stringify([groupId, optionId]),
        ),
      ),
    ].sort(),
  );
}

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
  if (
    input.expectedVersion !== undefined &&
    (existing
      ? existing.version !== input.expectedVersion
      : typeof input.expectedVersion === "number")
  ) {
    throw new CommandRejectedError("account-changed");
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
  const missing = missingCustomerFields(input.header);
  if (missing.length > 0) {
    throw new CommandRejectedError("missing-customer-data", undefined, missing);
  }
  if (existing) {
    for (const [lineId, sent] of Object.entries(existing.sentQuantities)) {
      if (sent <= 0) continue;
      const before = existing.lines.find((line) => line.lineId === lineId);
      const after = input.lines.find((line) => line.lineId === lineId);
      if (
        !before ||
        !after ||
        after.quantity < sent ||
        after.note !== before.note ||
        modifierPairs(after) !== modifierPairs(before)
      ) {
        throw new CommandRejectedError("sent-to-kitchen");
      }
    }
  }
  const header = structuredClone(input.header);
  header.customer = {
    name: header.customer.name.trim(),
    phone: header.customer.phone.trim(),
    address: header.customer.address.trim(),
  };
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "order-saved",
        orderId: input.orderId,
        folio: existing?.folio ?? folioFor(state.lastFolioNumber + 1),
        header,
        lines: structuredClone(input.lines),
      },
    ],
  };
}
