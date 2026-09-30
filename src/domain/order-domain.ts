/** Pure domain rules for EVL-113. No browser, storage, or UI dependencies. */

import type {
  Cents,
  CommandBatchDocument,
  EventEnvelope,
  FinancialStatus,
  OrderLineSnapshot,
  Payment,
} from "./contracts.ts";

type Preparation =
  "not-sent" | "queued" | "preparing" | "ready" | "served" | "cancelled";
type DiscountLine = { lineId: string; subtotalCents: Cents };
type SnapshotLine = Pick<
  OrderLineSnapshot,
  "lineId" | "productId" | "productNameSnapshot" | "unitPriceCents" | "quantity"
> & {
  modifierSnapshots: readonly Pick<
    OrderLineSnapshot["modifierSnapshots"][number],
    "modifierId" | "nameSnapshot" | "priceDeltaCents"
  >[];
};
type Reversal = { reversalId: string; paymentId: string; amountCents: Cents };
type Refund = { refundId: string; paymentId: string; amountCents: Cents };
type PaymentRecord = Payment & { reversals?: Reversal[]; refunds?: Refund[] };
type PaymentSummary = {
  payments: PaymentRecord[];
  paidNetCents: Cents;
  refundedNetCents: Cents;
  dueCents: Cents;
  financialStatus: FinancialStatus;
  closed: boolean;
  changed: boolean;
};
export type DomainEvent = EventEnvelope<string, Record<string, unknown>>;
export type EventProjection = Record<string, unknown> & {
  events: DomainEvent[];
  commandBatches: CommandBatchDocument<DomainEvent>[];
};
export type EventReducer<
  TProjection extends EventProjection = EventProjection,
> = (projection: TProjection, event: DomainEvent) => TProjection;
export type EventBatchResult<
  TProjection extends EventProjection = EventProjection,
> = {
  projection: TProjection;
  commandBatch: CommandBatchDocument<DomainEvent>;
  acceptedEventIds: string[];
  duplicateCount: number;
};

export const DOMAIN_SCHEMA_VERSION = 1;

export const FINANCIAL_STATUS = Object.freeze({
  OPEN: "open",
  PARTIALLY_PAID: "partially-paid",
  PAID: "paid",
  VOID: "void",
});

export const PREPARATION_STATUS = Object.freeze({
  NOT_SENT: "not-sent",
  QUEUED: "queued",
  PREPARING: "preparing",
  READY: "ready",
  SERVED: "served",
  CANCELLED: "cancelled",
});

const preparationTransitions: Record<
  Preparation,
  ReadonlySet<Preparation>
> = Object.freeze({
  [PREPARATION_STATUS.NOT_SENT]: new Set<Preparation>([
    PREPARATION_STATUS.QUEUED,
    PREPARATION_STATUS.CANCELLED,
  ]),
  [PREPARATION_STATUS.QUEUED]: new Set<Preparation>([
    PREPARATION_STATUS.PREPARING,
    PREPARATION_STATUS.CANCELLED,
  ]),
  [PREPARATION_STATUS.PREPARING]: new Set<Preparation>([
    PREPARATION_STATUS.READY,
    PREPARATION_STATUS.CANCELLED,
  ]),
  [PREPARATION_STATUS.READY]: new Set<Preparation>([
    PREPARATION_STATUS.SERVED,
    PREPARATION_STATUS.CANCELLED,
  ]),
  [PREPARATION_STATUS.SERVED]: new Set<Preparation>(),
  [PREPARATION_STATUS.CANCELLED]: new Set<Preparation>(),
});

export function canTransitionPreparation(
  from: Preparation,
  to: Preparation,
): boolean {
  return preparationTransitions[from]?.has(to) ?? false;
}

/** Allocate an order-level discount over stable line IDs using largest remainder. */
export function allocateDiscount(
  totalDiscountCents: Cents,
  lines: readonly DiscountLine[],
): Array<{ lineId: string; cents: Cents }> {
  assertIntegerNonNegative(totalDiscountCents, "totalDiscountCents");
  if (!Array.isArray(lines) || lines.length === 0)
    throw new TypeError("lines must be a non-empty array");
  const ids = new Set();
  const normalized = lines.map((line) => {
    if (!line || typeof line.lineId !== "string" || !line.lineId.trim())
      throw new TypeError("each line needs a stable lineId");
    if (ids.has(line.lineId))
      throw new Error(`duplicate lineId: ${line.lineId}`);
    ids.add(line.lineId);
    assertIntegerNonNegative(
      line.subtotalCents,
      `subtotalCents for ${line.lineId}`,
    );
    return line;
  });
  const subtotal = normalized.reduce(
    (sum, line) => sum + line.subtotalCents,
    0,
  );
  if (!Number.isSafeInteger(subtotal) || totalDiscountCents > subtotal)
    throw new RangeError("discount must not exceed the safe-integer subtotal");
  if (subtotal === 0 && totalDiscountCents !== 0)
    throw new RangeError("cannot discount a zero-value order");

  const allocations: Array<{
    lineId: string;
    cents: Cents;
    remainder: number;
  }> = normalized.map((line) => {
    const numerator = totalDiscountCents * line.subtotalCents;
    if (!Number.isSafeInteger(numerator))
      throw new RangeError("discount calculation exceeds safe integer range");
    const cents = subtotal === 0 ? 0 : Math.floor(numerator / subtotal);
    return {
      lineId: line.lineId,
      cents,
      remainder: subtotal === 0 ? 0 : numerator % subtotal,
    };
  });
  const remaining =
    totalDiscountCents - allocations.reduce((sum, item) => sum + item.cents, 0);
  const ranked = [...allocations].sort(
    (a, b) => b.remainder - a.remainder || compareStableId(a.lineId, b.lineId),
  );
  for (let i = 0; i < remaining; i += 1) ranked[i].cents += 1;
  return allocations.map(({ lineId, cents }) => ({ lineId, cents }));
}

/** Validate immutable price/name/modifier snapshots when an order line is captured. */
export function validateLineSnapshot(line: unknown): true {
  if (!line || typeof line !== "object")
    throw new TypeError("line snapshot is required");
  const snapshot = line as SnapshotLine;
  if (typeof snapshot.lineId !== "string" || !snapshot.lineId.trim())
    throw new TypeError("lineId is required");
  if (typeof snapshot.productId !== "string" || !snapshot.productId.trim())
    throw new TypeError("productId is required");
  if (
    typeof snapshot.productNameSnapshot !== "string" ||
    !snapshot.productNameSnapshot.trim()
  )
    throw new TypeError("productNameSnapshot is required");
  assertIntegerNonNegative(snapshot.unitPriceCents, "unitPriceCents");
  assertIntegerNonNegative(snapshot.quantity, "quantity");
  if (snapshot.quantity < 1)
    throw new RangeError("quantity must be at least 1");
  if (!Array.isArray(snapshot.modifierSnapshots))
    throw new TypeError("modifierSnapshots must be an array");
  for (const modifier of snapshot.modifierSnapshots) {
    if (
      !modifier ||
      typeof modifier.modifierId !== "string" ||
      typeof modifier.nameSnapshot !== "string"
    )
      throw new TypeError(
        "modifier snapshots require modifierId and nameSnapshot",
      );
    assertIntegerNonNegative(
      modifier.priceDeltaCents,
      "modifier priceDeltaCents",
    );
  }
  return true;
}

/** Add one net payment without mutating the original collection or overpaying. */
export function recordPayment(
  payments: readonly PaymentRecord[],
  payment: Payment,
  amountDueCents: Cents,
  { closed = false }: { closed?: boolean } = {},
): PaymentSummary {
  if (!Array.isArray(payments))
    throw new TypeError("payments must be an array");
  assertIntegerNonNegative(amountDueCents, "amountDueCents");
  if (
    !payment ||
    typeof payment.paymentId !== "string" ||
    !payment.paymentId.trim()
  )
    throw new TypeError("paymentId is required");
  if (!["cash", "card", "transfer", "credit"].includes(payment.method))
    throw new TypeError("unsupported payment method");
  assertIntegerNonNegative(payment.netAmountCents, "netAmountCents");
  assertIntegerNonNegative(payment.tipCents, "tipCents");
  if (payment.netAmountCents < 1)
    throw new RangeError(
      "a payment must be positive; zero-total orders settle without a payment",
    );
  if (payment.tipCents > payment.netAmountCents)
    throw new RangeError(
      "tip cannot exceed the payment total, which includes the tip",
    );
  if (payment.method === "cash") {
    assertIntegerNonNegative(payment.cashReceivedCents, "cashReceivedCents");
    if (payment.cashReceivedCents < payment.netAmountCents)
      throw new RangeError("cash received cannot be less than payment net");
    if (
      payment.changeCents !==
      payment.cashReceivedCents - payment.netAmountCents
    )
      throw new RangeError("change must equal cash received minus payment net");
  } else if ("cashReceivedCents" in payment || "changeCents" in payment) {
    throw new TypeError("cash tender and change apply only to cash payments");
  }
  const prior = payments.find((item) => item.paymentId === payment.paymentId);
  if (prior) {
    const original = { ...prior };
    delete original.reversals;
    delete original.refunds;
    if (stableJson(original) !== stableJson(payment))
      throw new Error(
        `paymentId reused with different content: ${payment.paymentId}`,
      );
    return summarizePayments(payments, amountDueCents, false, { closed });
  }
  if (closed) throw new Error("closed sales cannot accept another charge");
  const paid = netCollected(payments);
  if (paid + payment.netAmountCents > amountDueCents)
    throw new RangeError("net payments cannot exceed amount due");
  return summarizePayments(
    [...payments, { ...payment, reversals: [] }],
    amountDueCents,
    true,
  );
}

/** Append a compensating reversal and return the resulting net balance. */
export function reversePayment(
  payments: readonly PaymentRecord[],
  reversalId: string,
  paymentId: string,
  amountCents: Cents,
  amountDueCents: Cents,
  { saleClosed = false }: { saleClosed?: boolean } = {},
): PaymentSummary {
  if (!Array.isArray(payments))
    throw new TypeError("payments must be an array");
  if (typeof reversalId !== "string" || !reversalId.trim())
    throw new TypeError("reversalId is required");
  assertIntegerNonNegative(amountCents, "amountCents");
  assertIntegerNonNegative(amountDueCents, "amountDueCents");
  if (saleClosed)
    throw new Error(
      "closed-sale refunds must use refundPayment; they never reopen the order or its balance",
    );
  const target = payments.find((item) => item.paymentId === paymentId);
  if (!target) throw new Error(`unknown paymentId: ${paymentId}`);
  const reversals = payments.flatMap((item) => item.reversals ?? []);
  const prior = reversals.find((item) => item.reversalId === reversalId);
  if (prior) {
    if (prior.paymentId !== paymentId || prior.amountCents !== amountCents)
      throw new Error(
        `reversalId reused with different content: ${reversalId}`,
      );
    return summarizePayments(payments, amountDueCents, false);
  }
  const alreadyReversed = (target.reversals ?? []).reduce(
    (sum: Cents, item: Reversal) => sum + item.amountCents,
    0,
  );
  if (amountCents < 1 || alreadyReversed + amountCents > target.netAmountCents)
    throw new RangeError(
      "reversal must be positive and cannot exceed the original net payment",
    );
  const updated = payments.map((item) =>
    item.paymentId === paymentId
      ? {
          ...item,
          reversals: [
            ...(item.reversals ?? []),
            { reversalId, paymentId, amountCents },
          ],
        }
      : item,
  );
  return summarizePayments(updated, amountDueCents, true);
}

/** Record a refund against a closed, fully settled sale without reopening its due balance. */
export function refundPayment(
  payments: readonly PaymentRecord[],
  refundId: string,
  paymentId: string,
  amountCents: Cents,
  amountDueCents: Cents,
): PaymentSummary {
  if (!Array.isArray(payments))
    throw new TypeError("payments must be an array");
  if (typeof refundId !== "string" || !refundId.trim())
    throw new TypeError("refundId is required");
  assertIntegerNonNegative(amountCents, "amountCents");
  assertIntegerNonNegative(amountDueCents, "amountDueCents");
  const target = payments.find((item) => item.paymentId === paymentId);
  if (!target) throw new Error(`unknown paymentId: ${paymentId}`);
  const priorRefund = payments
    .flatMap((item) => item.refunds ?? [])
    .find((item) => item.refundId === refundId);
  if (priorRefund) {
    if (
      priorRefund.paymentId !== paymentId ||
      priorRefund.amountCents !== amountCents
    )
      throw new Error(`refundId reused with different content: ${refundId}`);
    return summarizePayments(payments, amountDueCents, false, { closed: true });
  }
  const totalRefunded = payments.reduce(
    (sum: Cents, item) =>
      sum +
      (item.refunds ?? []).reduce(
        (part: Cents, entry: Refund) => part + entry.amountCents,
        0,
      ),
    0,
  );
  if (
    amountCents < 1 ||
    netCollected(payments) + totalRefunded !== amountDueCents
  )
    throw new RangeError(
      "refund requires a positive amount and a fully settled sale",
    );
  const alreadyRefunded = (target.refunds ?? []).reduce(
    (sum: Cents, item: Refund) => sum + item.amountCents,
    0,
  );
  if (
    alreadyRefunded + amountCents >
    target.netAmountCents -
      (target.reversals ?? []).reduce(
        (sum: Cents, item: Reversal) => sum + item.amountCents,
        0,
      )
  ) {
    throw new RangeError("refund cannot exceed the original payment net");
  }
  const updated = payments.map((item) =>
    item.paymentId === paymentId
      ? {
          ...item,
          refunds: [
            ...(item.refunds ?? []),
            { refundId, paymentId, amountCents },
          ],
        }
      : item,
  );
  return summarizePayments(updated, amountDueCents, true, { closed: true });
}

export function summarizeSettlement(
  payments: readonly PaymentRecord[],
  amountDueCents: Cents,
  { closed = false }: { closed?: boolean } = {},
): PaymentSummary {
  if (!Array.isArray(payments))
    throw new TypeError("payments must be an array");
  assertIntegerNonNegative(amountDueCents, "amountDueCents");
  return summarizePayments(payments, amountDueCents, false, { closed });
}

function netCollected(payments: readonly PaymentRecord[]): Cents {
  return payments.reduce(
    (sum, item) =>
      sum +
      item.netAmountCents -
      (item.reversals ?? []).reduce(
        (reversed, entry) => reversed + entry.amountCents,
        0,
      ) -
      (item.refunds ?? []).reduce(
        (refunded, entry) => refunded + entry.amountCents,
        0,
      ),
    0,
  );
}

function summarizePayments(
  payments: readonly PaymentRecord[],
  amountDueCents: Cents,
  changed: boolean,
  { closed = false }: { closed?: boolean } = {},
): PaymentSummary {
  const paidNetCents = netCollected(payments);
  const refundedNetCents = payments.reduce(
    (sum, item) =>
      sum +
      (item.refunds ?? []).reduce(
        (refunded, entry) => refunded + entry.amountCents,
        0,
      ),
    0,
  );
  const dueCents = closed ? 0 : Math.max(0, amountDueCents - paidNetCents);
  return {
    payments: payments.map((payment) => ({
      ...payment,
      reversals: [...(payment.reversals ?? [])],
      refunds: [...(payment.refunds ?? [])],
    })),
    paidNetCents,
    refundedNetCents,
    dueCents,
    financialStatus:
      closed || paidNetCents >= amountDueCents
        ? FINANCIAL_STATUS.PAID
        : paidNetCents === 0
          ? FINANCIAL_STATUS.OPEN
          : FINANCIAL_STATUS.PARTIALLY_PAID,
    closed,
    changed,
  };
}

/** Validate an event envelope before persistence or replay. */
export function validateEvent(event: unknown): event is DomainEvent {
  if (!event || typeof event !== "object")
    throw new TypeError("event envelope is required");
  const candidate = event as Record<string, unknown>;
  const required = [
    "eventId",
    "commandId",
    "aggregateId",
    "type",
    "actorId",
    "deviceId",
    "occurredAt",
  ];
  for (const key of required)
    if (typeof candidate[key] !== "string" || !candidate[key].trim())
      throw new TypeError(`${key} is required`);
  if (
    !Number.isInteger(candidate.schemaVersion) ||
    (candidate.schemaVersion as number) < 1
  )
    throw new TypeError("schemaVersion must be a positive integer");
  if (Number.isNaN(Date.parse(candidate.occurredAt as string)))
    throw new TypeError("occurredAt must be an ISO-compatible timestamp");
  if (
    !candidate.payload ||
    typeof candidate.payload !== "object" ||
    Array.isArray(candidate.payload)
  )
    throw new TypeError("payload must be an object");
  return true;
}

/**
 * Pure command-batch projector. Persist the returned immutable commandBatch
 * document as the single commit point; projections are derived and replayable.
 */
export function applyEventBatch<TProjection extends EventProjection>(
  current: TProjection,
  proposedEvents: readonly DomainEvent[],
  reduce: EventReducer<TProjection> = appendOnlyReducer,
): EventBatchResult<TProjection> {
  if (!current || !Array.isArray(current.events))
    throw new TypeError("current projection must include events[]");
  if (!Array.isArray(proposedEvents))
    throw new TypeError("proposedEvents must be an array");
  if (typeof reduce !== "function")
    throw new TypeError("reduce must be a function");
  for (const event of proposedEvents) {
    validateEvent(event);
  }
  if (proposedEvents.length === 0)
    throw new TypeError("a command batch must contain at least one event");
  const commandId = proposedEvents[0].commandId;
  const metadata = commandMetadata(proposedEvents[0]);
  for (const event of proposedEvents) {
    if (event.commandId !== commandId)
      throw new Error("a command batch cannot mix command IDs");
    if (stableJson(commandMetadata(event)) !== stableJson(metadata))
      throw new Error(
        "a command batch cannot mix aggregate, actor, device, timestamp, or schema metadata",
      );
  }
  const batchDocument = {
    ...metadata,
    commandId,
    events: proposedEvents.map((event) => structuredClone(event)),
  };
  const existingBatch =
    (current.commandBatches ?? []).find(
      (batch) => batch.commandId === commandId,
    ) ?? deriveCommandBatch(current.events, commandId);
  if (existingBatch) {
    if (stableJson(existingBatch) !== stableJson(batchDocument))
      throw new Error(
        `commandId reused with a different event batch: ${commandId}`,
      );
    return {
      projection: structuredClone(current),
      commandBatch: structuredClone(existingBatch),
      acceptedEventIds: [],
      duplicateCount: proposedEvents.length,
    };
  }
  const knownEventIds = new Set(current.events.map((event) => event.eventId));
  const proposedIds = new Set();
  for (const event of proposedEvents) {
    if (proposedIds.has(event.eventId))
      throw new Error(
        `duplicate eventId within command batch: ${event.eventId}`,
      );
    if (knownEventIds.has(event.eventId))
      throw new Error(
        `eventId already belongs to another command: ${event.eventId}`,
      );
    proposedIds.add(event.eventId);
  }
  // Work against a cloned projection. A reducer failure cannot mutate current.
  let next = structuredClone(current);
  for (const event of proposedEvents)
    next = reduce(next, structuredClone(event));
  next.events = [
    ...current.events.map((event) => structuredClone(event)),
    ...proposedEvents.map((event) => structuredClone(event)),
  ];
  next.commandBatches = [
    ...(current.commandBatches ?? []).map((batch) => structuredClone(batch)),
    batchDocument,
  ];
  return {
    projection: next,
    commandBatch: batchDocument,
    acceptedEventIds: proposedEvents.map((event) => event.eventId),
    duplicateCount: 0,
  };
}

export function appendOnlyReducer<TProjection extends EventProjection>(
  projection: TProjection,
  _event: DomainEvent,
): TProjection {
  void _event;
  return projection;
}

function assertIntegerNonNegative(
  value: unknown,
  label: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError(
      `${label} must be a non-negative safe integer (centavos for money)`,
    );
}

function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((key) => [key, sort((v as Record<string, unknown>)[key])]),
          )
        : v;
  return JSON.stringify(sort(value));
}

function compareStableId(left: string, right: string): number {
  const leftPoints = Array.from(
    left,
    (character) => character.codePointAt(0) ?? 0,
  );
  const rightPoints = Array.from(
    right,
    (character) => character.codePointAt(0) ?? 0,
  );
  const commonLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < commonLength; index += 1) {
    if (leftPoints[index] !== rightPoints[index])
      return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function commandMetadata(
  event: DomainEvent,
): Omit<CommandBatchDocument<DomainEvent>, "events" | "commandId"> {
  return {
    aggregateId: event.aggregateId,
    actorId: event.actorId,
    deviceId: event.deviceId,
    occurredAt: event.occurredAt,
    schemaVersion: event.schemaVersion,
  };
}

function deriveCommandBatch(
  events: readonly DomainEvent[],
  commandId: string,
): CommandBatchDocument<DomainEvent> | undefined {
  const batchEvents = events.filter((event) => event.commandId === commandId);
  if (batchEvents.length === 0) return undefined;
  const metadata = commandMetadata(batchEvents[0]);
  if (
    batchEvents.some(
      (event) => stableJson(commandMetadata(event)) !== stableJson(metadata),
    )
  )
    throw new Error(`stored command batch has mixed metadata: ${commandId}`);
  return {
    ...metadata,
    commandId,
    events: batchEvents.map((event) => structuredClone(event)),
  };
}
