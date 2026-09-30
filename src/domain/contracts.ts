/** Future TypeScript contract for the domain introduced by EVL-113. */
export type Id = string;
export type Cents = number; // non-negative safe integer; MXN centavos

export type Role = "duena" | "encargado" | "barra" | "mesero";
export type Money = { amountCents: Cents; currency: "MXN" };

export interface EventEnvelope<TType extends string = string, TPayload = unknown> {
  eventId: Id;
  commandId: Id;
  aggregateId: Id;
  type: TType;
  schemaVersion: number;
  actorId: Id;
  deviceId: Id;
  occurredAt: string; // ISO-8601 UTC instant supplied by the originating device
  payload: TPayload;
}

export interface ModifierSnapshot {
  modifierId: Id;
  nameSnapshot: string;
  priceDeltaCents: Cents;
}

export interface OrderLineSnapshot {
  lineId: Id;
  productId: Id;
  productNameSnapshot: string;
  unitPriceCents: Cents;
  quantity: number;
  modifierSnapshots: readonly ModifierSnapshot[];
  notesSnapshot?: string;
}

export type FinancialStatus = "open" | "partially-paid" | "paid" | "void";
export type PreparationStatus = "not-sent" | "queued" | "preparing" | "ready" | "served" | "cancelled";

export interface CashPayment {
  paymentId: Id;
  method: "cash";
  /** Payment total in centavos, including tipCents. */
  netAmountCents: Cents;
  tipCents: Cents;
  cashReceivedCents: Cents;
  changeCents: Cents;
}

export interface NonCashPayment {
  paymentId: Id;
  method: "card" | "transfer" | "credit";
  /** Payment total in centavos, including tipCents. */
  netAmountCents: Cents;
  tipCents: Cents;
}
export type Payment = CashPayment | NonCashPayment;

export interface PaymentCompensation {
  compensationId: Id;
  paymentId: Id;
  kind: "pre-close-reversal" | "closed-sale-refund";
  amountCents: Cents;
  reason: string;
  actorId: Id;
  deviceId: Id;
  occurredAt: string;
}

export interface BusinessCommand<TPayload = unknown> {
  commandId: Id;
  aggregateId: Id;
  actorId: Id;
  deviceId: Id;
  occurredAt: string;
  schemaVersion: number;
  payload: TPayload;
}

export interface CommandBatchDocument<TEvent extends EventEnvelope = EventEnvelope> {
  /** Persist this single immutable document as the command's idempotent commit point. */
  commandId: Id;
  aggregateId: Id;
  actorId: Id;
  deviceId: Id;
  occurredAt: string;
  schemaVersion: number;
  events: readonly TEvent[];
}

export interface OrderProjection {
  orderId: Id;
  branchId: Id;
  currency: "MXN";
  financialStatus: FinancialStatus;
  preparationStatus: PreparationStatus;
  saleClosed: boolean;
  lines: readonly OrderLineSnapshot[];
  payments: readonly Payment[];
  paymentCompensations: readonly PaymentCompensation[];
  paidNetCents: Cents;
  dueCents: Cents;
  lastEventId: Id | null;
  schemaVersion: number;
}

export interface InventoryMovement {
  movementId: Id;
  sourceEventId: Id;
  ingredientId: Id;
  quantityInBaseUnit: number;
  unitSnapshot: string;
  actorId: Id;
  deviceId: Id;
  occurredAt: string;
  reason: string;
  reversesMovementId?: Id;
}

export type EventType =
  | "OrderOpened"
  | "LineAdded"
  | "LineRemoved"
  | "OrderDiscountApplied"
  | "PreparationSent"
  | "PreparationStarted"
  | "PreparationReady"
  | "OrderServed"
  | "PaymentRecorded"
  | "PaymentReversed"
  | "OrderCancelled"
  | "InventoryConsumed"
  | "InventoryReversed";
