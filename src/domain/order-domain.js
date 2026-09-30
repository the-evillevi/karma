/** Pure domain rules for EVL-113. No browser, storage, or UI dependencies. */

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

const preparationTransitions = Object.freeze({
  [PREPARATION_STATUS.NOT_SENT]: new Set([PREPARATION_STATUS.QUEUED, PREPARATION_STATUS.CANCELLED]),
  [PREPARATION_STATUS.QUEUED]: new Set([PREPARATION_STATUS.PREPARING, PREPARATION_STATUS.CANCELLED]),
  [PREPARATION_STATUS.PREPARING]: new Set([PREPARATION_STATUS.READY, PREPARATION_STATUS.CANCELLED]),
  [PREPARATION_STATUS.READY]: new Set([PREPARATION_STATUS.SERVED, PREPARATION_STATUS.CANCELLED]),
  [PREPARATION_STATUS.SERVED]: new Set(),
  [PREPARATION_STATUS.CANCELLED]: new Set(),
});

export function canTransitionPreparation(from, to) {
  return preparationTransitions[from]?.has(to) ?? false;
}

/** Allocate an order-level discount over stable line IDs using largest remainder. */
export function allocateDiscount(totalDiscountCents, lines) {
  assertIntegerNonNegative(totalDiscountCents, "totalDiscountCents");
  if (!Array.isArray(lines) || lines.length === 0) throw new TypeError("lines must be a non-empty array");
  const ids = new Set();
  const normalized = lines.map((line) => {
    if (!line || typeof line.lineId !== "string" || !line.lineId.trim()) throw new TypeError("each line needs a stable lineId");
    if (ids.has(line.lineId)) throw new Error(`duplicate lineId: ${line.lineId}`);
    ids.add(line.lineId);
    assertIntegerNonNegative(line.subtotalCents, `subtotalCents for ${line.lineId}`);
    return line;
  });
  const subtotal = normalized.reduce((sum, line) => sum + line.subtotalCents, 0);
  if (!Number.isSafeInteger(subtotal) || totalDiscountCents > subtotal) throw new RangeError("discount must not exceed the safe-integer subtotal");
  if (subtotal === 0 && totalDiscountCents !== 0) throw new RangeError("cannot discount a zero-value order");

  const allocations = normalized.map((line) => {
    const numerator = totalDiscountCents * line.subtotalCents;
    if (!Number.isSafeInteger(numerator)) throw new RangeError("discount calculation exceeds safe integer range");
    const cents = subtotal === 0 ? 0 : Math.floor(numerator / subtotal);
    return { lineId: line.lineId, cents, remainder: subtotal === 0 ? 0 : numerator % subtotal };
  });
  let remaining = totalDiscountCents - allocations.reduce((sum, item) => sum + item.cents, 0);
  const ranked = [...allocations].sort((a, b) => b.remainder - a.remainder || a.lineId.localeCompare(b.lineId));
  for (let i = 0; i < remaining; i += 1) ranked[i].cents += 1;
  return allocations.map(({ lineId, cents }) => ({ lineId, cents }));
}

/** Validate immutable price/name/modifier snapshots when an order line is captured. */
export function validateLineSnapshot(line) {
  if (!line || typeof line.lineId !== "string" || !line.lineId.trim()) throw new TypeError("lineId is required");
  if (typeof line.productId !== "string" || !line.productId.trim()) throw new TypeError("productId is required");
  if (typeof line.productNameSnapshot !== "string" || !line.productNameSnapshot.trim()) throw new TypeError("productNameSnapshot is required");
  assertIntegerNonNegative(line.unitPriceCents, "unitPriceCents");
  assertIntegerNonNegative(line.quantity, "quantity");
  if (line.quantity < 1) throw new RangeError("quantity must be at least 1");
  if (!Array.isArray(line.modifierSnapshots)) throw new TypeError("modifierSnapshots must be an array");
  for (const modifier of line.modifierSnapshots) {
    if (!modifier || typeof modifier.modifierId !== "string" || typeof modifier.nameSnapshot !== "string") throw new TypeError("modifier snapshots require modifierId and nameSnapshot");
    assertIntegerNonNegative(modifier.priceDeltaCents, "modifier priceDeltaCents");
  }
  return true;
}

/** Add one net payment without mutating the original collection or overpaying. */
export function recordPayment(payments, payment, amountDueCents) {
  if (!Array.isArray(payments)) throw new TypeError("payments must be an array");
  assertIntegerNonNegative(amountDueCents, "amountDueCents");
  if (!payment || typeof payment.paymentId !== "string" || !payment.paymentId.trim()) throw new TypeError("paymentId is required");
  if (!["cash", "card", "transfer", "credit"].includes(payment.method)) throw new TypeError("unsupported payment method");
  assertIntegerNonNegative(payment.netAmountCents, "netAmountCents");
  assertIntegerNonNegative(payment.tipCents, "tipCents");
  if (payment.method === "cash") {
    assertIntegerNonNegative(payment.cashReceivedCents, "cashReceivedCents");
    if (payment.cashReceivedCents < payment.netAmountCents) throw new RangeError("cash received cannot be less than payment net");
    if (payment.changeCents !== payment.cashReceivedCents - payment.netAmountCents) throw new RangeError("change must equal cash received minus payment net");
  } else if (payment.cashReceivedCents !== undefined || payment.changeCents !== undefined) {
    throw new TypeError("cash tender and change apply only to cash payments");
  }
  const prior = payments.find((item) => item.paymentId === payment.paymentId);
  if (prior) {
    const { reversals: _reversals, ...original } = prior;
    if (stableJson(original) !== stableJson(payment)) throw new Error(`paymentId reused with different content: ${payment.paymentId}`);
    return summarizePayments(payments, amountDueCents, false);
  }
  const paid = payments.reduce((sum, item) => sum + item.netAmountCents - (item.reversals ?? []).reduce((reversed, entry) => reversed + entry.amountCents, 0), 0);
  if (paid + payment.netAmountCents > amountDueCents) throw new RangeError("net payments cannot exceed amount due");
  return summarizePayments([...payments, { ...payment, reversals: [] }], amountDueCents, true);
}

/** Append a compensating reversal and return the resulting net balance. */
export function reversePayment(payments, reversalId, paymentId, amountCents, amountDueCents) {
  if (!Array.isArray(payments)) throw new TypeError("payments must be an array");
  if (typeof reversalId !== "string" || !reversalId.trim()) throw new TypeError("reversalId is required");
  assertIntegerNonNegative(amountCents, "amountCents");
  assertIntegerNonNegative(amountDueCents, "amountDueCents");
  const target = payments.find((item) => item.paymentId === paymentId);
  if (!target) throw new Error(`unknown paymentId: ${paymentId}`);
  const reversals = payments.flatMap((item) => item.reversals ?? []);
  const prior = reversals.find((item) => item.reversalId === reversalId);
  if (prior) {
    if (prior.paymentId !== paymentId || prior.amountCents !== amountCents) throw new Error(`reversalId reused with different content: ${reversalId}`);
    return summarizePayments(payments, amountDueCents, false);
  }
  const alreadyReversed = (target.reversals ?? []).reduce((sum, item) => sum + item.amountCents, 0);
  if (amountCents < 1 || alreadyReversed + amountCents > target.netAmountCents) throw new RangeError("reversal must be positive and cannot exceed the original net payment");
  const updated = payments.map((item) => item.paymentId === paymentId
    ? { ...item, reversals: [...(item.reversals ?? []), { reversalId, paymentId, amountCents }] }
    : item);
  return summarizePayments(updated, amountDueCents, true);
}

function summarizePayments(payments, amountDueCents, changed) {
  const paidNetCents = payments.reduce((sum, item) => sum + item.netAmountCents - (item.reversals ?? []).reduce((reversed, entry) => reversed + entry.amountCents, 0), 0);
  return {
    payments: changed ? payments : payments.map((payment) => ({ ...payment, reversals: [...(payment.reversals ?? [])] })),
    paidNetCents,
    dueCents: Math.max(0, amountDueCents - paidNetCents),
    financialStatus: paidNetCents === 0 ? FINANCIAL_STATUS.OPEN : paidNetCents < amountDueCents ? FINANCIAL_STATUS.PARTIALLY_PAID : FINANCIAL_STATUS.PAID,
    changed,
  };
}

/** Validate an event envelope before persistence or replay. */
export function validateEvent(event) {
  const required = ["eventId", "commandId", "aggregateId", "type", "actorId", "deviceId", "occurredAt"];
  for (const key of required) if (typeof event?.[key] !== "string" || !event[key].trim()) throw new TypeError(`${key} is required`);
  if (!Number.isInteger(event.schemaVersion) || event.schemaVersion < 1) throw new TypeError("schemaVersion must be a positive integer");
  if (Number.isNaN(Date.parse(event.occurredAt))) throw new TypeError("occurredAt must be an ISO-compatible timestamp");
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) throw new TypeError("payload must be an object");
  return true;
}

/**
 * Pure append/replay primitive. A caller persists the returned event set and
 * projection in one storage transaction. Duplicate IDs are no-ops only when
 * their serialized envelopes are identical; ID reuse with changed data fails.
 */
export function applyEventBatch(current, proposedEvents, reduce = appendOnlyReducer) {
  if (!current || !Array.isArray(current.events)) throw new TypeError("current projection must include events[]");
  if (!Array.isArray(proposedEvents)) throw new TypeError("proposedEvents must be an array");
  if (typeof reduce !== "function") throw new TypeError("reduce must be a function");
  const known = new Map(current.events.map((event) => [event.eventId, stableJson(event)]));
  const additions = [];
  for (const event of proposedEvents) {
    validateEvent(event);
    const serialized = stableJson(event);
    const existing = known.get(event.eventId);
    if (existing !== undefined) {
      if (existing !== serialized) throw new Error(`eventId reused with different content: ${event.eventId}`);
      continue;
    }
    known.set(event.eventId, serialized);
    additions.push(event);
  }
  // Work against a cloned projection. If any reducer step fails, current stays untouched.
  let next = structuredClone(current);
  for (const event of additions) next = reduce(next, structuredClone(event));
  next.events = [...current.events.map((event) => structuredClone(event)), ...additions.map((event) => structuredClone(event))];
  return { projection: next, acceptedEventIds: additions.map((event) => event.eventId), duplicateCount: proposedEvents.length - additions.length };
}

export function appendOnlyReducer(projection, _event) {
  return projection;
}

function assertIntegerNonNegative(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer (centavos for money)`);
}

function stableJson(value) {
  const sort = (v) => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, sort(v[key])])) : v;
  return JSON.stringify(sort(value));
}
