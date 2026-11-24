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

export const NEXT_ACTION_LABELS: Record<PreparationStatus, string | null> = {
  queued: "Empezar",
  preparing: "Marcar lista",
  ready: "Entregar",
  served: null,
};

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

export type StatusTime = {
  status: PreparationStatus;
  minutes: number;
  current: boolean;
};

function minutesBetween(from: string, to: string): number {
  return Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 60_000));
}

function clockEnd(comanda: Comanda, now: string): string {
  if (comanda.status !== "served") return now;
  for (let index = comanda.statusHistory.length - 1; index >= 0; index--) {
    const entry = comanda.statusHistory[index];
    if (entry.status === "served") return entry.at;
  }
  return comanda.updatedAt;
}

export function timeInStatus(comanda: Comanda, now: string): StatusTime[] {
  return comanda.statusHistory.map((item, index, history) => ({
    status: item.status,
    minutes: minutesBetween(
      item.at,
      history[index + 1]?.at ?? clockEnd(comanda, now),
    ),
    current: index === history.length - 1,
  }));
}

export function totalMinutes(comanda: Comanda, now: string): number {
  return minutesBetween(comanda.sentAt, clockEnd(comanda, now));
}

export function durationLabel(minutes: number): string {
  if (minutes === 0) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} min`;
}
