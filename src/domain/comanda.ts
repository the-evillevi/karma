// Comandas (EVL-124 [A]). Sending a comanda snapshots what is new on the
// account; preparation then advances one step at a time, independently of
// payment. See docs/domain/order-lifecycle.md.
import type {
  Comanda,
  CommandBatch,
  CommandMeta,
  Order,
  PosState,
  PreparationStatus,
} from "./journal.ts";
import { can } from "./access.ts";
import { CommandRejectedError } from "./commands.ts";

export const PREPARATION_STEPS: readonly PreparationStatus[] = [
  "queued",
  "preparing",
  "ready",
  "served",
];

export const PREPARATION_LABELS: Record<PreparationStatus, string> = {
  queued: "En cola",
  preparing: "Preparando",
  ready: "Lista",
  served: "Entregada",
};

/** Label of the button that moves a comanda out of `status`; null when done. */
export const NEXT_ACTION_LABELS: Record<PreparationStatus, string | null> = {
  queued: "Empezar",
  preparing: "Marcar lista",
  ready: "Entregar",
  served: null,
};

/** The status after `status`, or null when it is already served. */
export function nextPreparationStatus(
  status: PreparationStatus,
): PreparationStatus | null {
  return PREPARATION_STEPS[PREPARATION_STEPS.indexOf(status) + 1] ?? null;
}

function sentQuantity(order: Order, lineId: string): number {
  return Object.hasOwn(order.sentQuantities, lineId)
    ? order.sentQuantities[lineId]
    : 0;
}

/** Sends to the kitchen whatever was added to the account since the last send. */
export function sendComanda(
  state: PosState,
  meta: CommandMeta,
  input: { orderId: string; comandaId: string },
): CommandBatch {
  if (!can(meta.actor.role, "send-comanda")) {
    throw new CommandRejectedError("not-allowed", "send-comanda");
  }
  const order = Object.hasOwn(state.orders, input.orderId)
    ? state.orders[input.orderId]
    : undefined;
  if (!order) throw new CommandRejectedError("unknown-order");
  const lines = order.lines
    .filter((line) => line.quantity > sentQuantity(order, line.lineId))
    .map((line) => ({
      lineId: line.lineId,
      name: line.name,
      quantity: line.quantity - sentQuantity(order, line.lineId),
      modifiers: line.modifiers.map((modifier) => modifier.name),
      note: line.note,
    }));
  if (lines.length === 0) throw new CommandRejectedError("nothing-new");
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "comanda-sent",
        orderId: input.orderId,
        comandaId: input.comandaId,
        lines,
      },
    ],
  };
}

/** Moves a comanda to `to`, which must be exactly its next status. */
export function advancePreparation(
  state: PosState,
  meta: CommandMeta,
  input: { comandaId: string; to: PreparationStatus },
): CommandBatch {
  if (!can(meta.actor.role, "send-comanda")) {
    throw new CommandRejectedError("not-allowed", "send-comanda");
  }
  const comanda = Object.hasOwn(state.comandas, input.comandaId)
    ? state.comandas[input.comandaId]
    : undefined;
  if (!comanda) throw new CommandRejectedError("unknown-comanda");
  if (comanda.status === "served")
    throw new CommandRejectedError("comanda-finished");
  if (input.to !== nextPreparationStatus(comanda.status)) {
    throw new CommandRejectedError("invalid-preparation-step");
  }
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "preparation-advanced",
        comandaId: input.comandaId,
        status: input.to,
      },
    ],
  };
}

/** Comandas not yet served, oldest first. */
export function pendingComandas(state: PosState): Comanda[] {
  return Object.values(state.comandas)
    .filter((comanda) => comanda.status !== "served")
    .sort(
      (left, right) =>
        compare(left.sentAt, right.sentAt) ||
        compare(left.comandaId, right.comandaId),
    );
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Whether the account has products that were not sent to the kitchen yet. */
export function hasUnsentLines(state: PosState, orderId: string): boolean {
  const order = Object.hasOwn(state.orders, orderId)
    ? state.orders[orderId]
    : undefined;
  return (
    order?.lines.some(
      (line) => line.quantity > sentQuantity(order, line.lineId),
    ) ?? false
  );
}
