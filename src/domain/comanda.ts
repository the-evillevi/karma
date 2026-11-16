// Comandas (EVL-124 [A]). Sending a comanda snapshots what is new on the
// account; preparation then advances one step at a time, independently of
// payment. See docs/domain/order-lifecycle.md.
import type {
  Comanda,
  CommandBatch,
  CommandMeta,
  PosState,
  PreparationStatus,
} from "./journal.ts";

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
  void status;
  throw new Error("not implemented");
}

/** Sends to the kitchen whatever was added to the account since the last send. */
export function sendComanda(
  state: PosState,
  meta: CommandMeta,
  input: { orderId: string; comandaId: string },
): CommandBatch {
  void state;
  void meta;
  void input;
  throw new Error("not implemented");
}

/** Moves a comanda to `to`, which must be exactly its next status. */
export function advancePreparation(
  state: PosState,
  meta: CommandMeta,
  input: { comandaId: string; to: PreparationStatus },
): CommandBatch {
  void state;
  void meta;
  void input;
  throw new Error("not implemented");
}

/** Comandas not yet served, oldest first. */
export function pendingComandas(state: PosState): Comanda[] {
  void state;
  throw new Error("not implemented");
}

/** Whether the account has products that were not sent to the kitchen yet. */
export function hasUnsentLines(state: PosState, orderId: string): boolean {
  void state;
  void orderId;
  throw new Error("not implemented");
}
