import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateDiscount,
  applyEventBatch,
  canTransitionPreparation,
  FINANCIAL_STATUS,
  PREPARATION_STATUS,
  recordPayment,
  refundPayment,
  reversePayment,
  summarizeSettlement,
  validateEvent,
  validateLineSnapshot,
} from "./order-domain.js";

test("discount allocation conserves centavos and breaks remainder ties by stable lineId", () => {
  const allocation = allocateDiscount(1, [
    { lineId: "line-b", subtotalCents: 100 },
    { lineId: "line-a", subtotalCents: 100 },
    { lineId: "line-c", subtotalCents: 100 },
  ]);
  assert.deepEqual(allocation, [
    { lineId: "line-b", cents: 0 },
    { lineId: "line-a", cents: 1 },
    { lineId: "line-c", cents: 0 },
  ]);
  assert.equal(allocation.reduce((sum, line) => sum + line.cents, 0), 1);
});

test("discount tie-breaking is locale-independent for accented stable IDs", () => {
  const first = allocateDiscount(1, [{ lineId: "ä-line", subtotalCents: 100 }, { lineId: "z-line", subtotalCents: 100 }]);
  const second = allocateDiscount(1, [{ lineId: "z-line", subtotalCents: 100 }, { lineId: "ä-line", subtotalCents: 100 }]);
  for (const result of [first, second]) {
    assert.equal(result.find((line) => line.lineId === "z-line").cents, 1);
    assert.equal(result.find((line) => line.lineId === "ä-line").cents, 0);
  }
});

test("discount allocation rejects duplicate lines, fractional money, and over-discounting", () => {
  assert.throws(() => allocateDiscount(1, [{ lineId: "x", subtotalCents: 1 }, { lineId: "x", subtotalCents: 1 }]), /duplicate lineId/);
  assert.throws(() => allocateDiscount(1.5, [{ lineId: "x", subtotalCents: 2 }]), /safe integer/);
  assert.throws(() => allocateDiscount(3, [{ lineId: "x", subtotalCents: 2 }]), /must not exceed/);
});

test("captured line snapshots require immutable labels and integer-cent prices", () => {
  assert.equal(validateLineSnapshot({ lineId: "l1", productId: "p1", productNameSnapshot: "Café", unitPriceCents: 5500, quantity: 1, modifierSnapshots: [{ modifierId: "m1", nameSnapshot: "Avena", priceDeltaCents: 1000 }] }), true);
  assert.throws(() => validateLineSnapshot({ lineId: "l1", productId: "p1", productNameSnapshot: "Café", unitPriceCents: 55.5, quantity: 1, modifierSnapshots: [] }), /safe integer/);
});

test("preparation transitions are independent from financial transitions", () => {
  assert.equal(canTransitionPreparation(PREPARATION_STATUS.NOT_SENT, PREPARATION_STATUS.QUEUED), true);
  assert.equal(canTransitionPreparation(PREPARATION_STATUS.QUEUED, PREPARATION_STATUS.SERVED), false);
  assert.equal(canTransitionPreparation(PREPARATION_STATUS.SERVED, PREPARATION_STATUS.QUEUED), false);
  assert.equal(FINANCIAL_STATUS.PAID, "paid");
});

test("cash tender and change remain distinct from net payment and duplicate payment is idempotent", () => {
  const cash = { paymentId: "pay-1", method: "cash", netAmountCents: 6500, tipCents: 500, cashReceivedCents: 10000, changeCents: 3500 };
  const first = recordPayment([], cash, 6500);
  assert.equal(first.paidNetCents, 6500);
  assert.equal(first.dueCents, 0);
  assert.equal(first.financialStatus, FINANCIAL_STATUS.PAID);
  assert.equal(first.payments[0].cashReceivedCents, 10000);
  assert.equal(first.payments[0].changeCents, 3500);
  const retry = recordPayment(first.payments, cash, 6500);
  assert.equal(retry.changed, false);
  assert.equal(retry.paidNetCents, 6500);
  assert.throws(() => recordPayment(first.payments, { ...cash, netAmountCents: 6400, changeCents: 3600 }, 6500), /reused/);
  assert.throws(() => recordPayment([], { ...cash, changeCents: 0 }, 6500), /change must equal/);
  assert.throws(() => recordPayment([], { ...cash, netAmountCents: 6600, cashReceivedCents: 6600, changeCents: 0 }, 6500), /exceed amount due/);
  assert.throws(() => recordPayment([], { ...cash, netAmountCents: 100, tipCents: 200, cashReceivedCents: 200, changeCents: 100 }, 100), /tip cannot exceed/);
});

test("zero-total orders settle without a payment and cannot record a zero-value charge", () => {
  const settled = summarizeSettlement([], 0);
  assert.equal(settled.financialStatus, FINANCIAL_STATUS.PAID);
  assert.equal(settled.paidNetCents, 0);
  assert.equal(settled.dueCents, 0);
  assert.throws(() => recordPayment([], { paymentId: "zero", method: "card", netAmountCents: 0, tipCents: 0 }, 0), /must be positive/);
});

test("split payments settle exactly and a compensating reversal restores due", () => {
  const card = recordPayment([], { paymentId: "pay-card", method: "card", netAmountCents: 3000, tipCents: 0 }, 5000);
  const cash = recordPayment(card.payments, { paymentId: "pay-cash", method: "cash", netAmountCents: 2000, tipCents: 0, cashReceivedCents: 2000, changeCents: 0 }, 5000);
  assert.equal(cash.paidNetCents, 5000);
  assert.equal(cash.financialStatus, FINANCIAL_STATUS.PAID);
  const reversed = reversePayment(cash.payments, "rev-1", "pay-card", 1000, 5000);
  assert.equal(reversed.paidNetCents, 4000);
  assert.equal(reversed.dueCents, 1000);
  assert.equal(reversed.financialStatus, FINANCIAL_STATUS.PARTIALLY_PAID);
  assert.equal(reversePayment(reversed.payments, "rev-1", "pay-card", 1000, 5000).changed, false);
  assert.throws(() => reversePayment(reversed.payments, "rev-2", "pay-card", 3000, 5000), /cannot exceed/);
});

test("closed-sale refunds preserve closure and never reopen a chargeable balance", () => {
  const settled = recordPayment([], { paymentId: "pay-closed", method: "card", netAmountCents: 5000, tipCents: 0 }, 5000);
  const refunded = refundPayment(settled.payments, "refund-1", "pay-closed", 1200, 5000);
  assert.equal(refunded.paidNetCents, 3800);
  assert.equal(refunded.refundedNetCents, 1200);
  assert.equal(refunded.financialStatus, FINANCIAL_STATUS.PAID);
  assert.equal(refunded.dueCents, 0);
  assert.equal(refunded.closed, true);
  assert.equal(refundPayment(refunded.payments, "refund-1", "pay-closed", 1200, 5000).changed, false);
  assert.throws(() => recordPayment(refunded.payments, { paymentId: "pay-again", method: "card", netAmountCents: 1200, tipCents: 0 }, 5000, { closed: true }), /closed sales/);
  assert.throws(() => reversePayment(settled.payments, "rev-closed", "pay-closed", 1200, 5000, { saleClosed: true }), /closed-sale refunds/);
});

test("event envelopes carry stable identity, actor, device, schema and timestamp", () => {
  assert.equal(validateEvent(event("evt-1")), true);
  assert.throws(() => validateEvent({ ...event("evt-2"), actorId: "" }), /actorId is required/);
  assert.throws(() => validateEvent({ ...event("evt-3"), schemaVersion: 0 }), /schemaVersion/);
});

test("event batch replay is idempotent and conflicting event IDs fail", () => {
  const original = { events: [], commandBatches: [], count: 0 };
  const first = applyEventBatch(original, [event("evt-1")], (projection) => ({ ...projection, count: projection.count + 1 }));
  assert.equal(first.projection.count, 1);
  const replay = applyEventBatch(first.projection, [event("evt-1")], (projection) => ({ ...projection, count: projection.count + 1 }));
  assert.equal(replay.projection.count, 1);
  assert.equal(replay.duplicateCount, 1);
  assert.throws(() => applyEventBatch(first.projection, [{ ...event("evt-1"), payload: { value: 2 } }]), /commandId reused with a different event batch/);
  assert.throws(() => applyEventBatch(first.projection, [event("evt-new")]), /commandId reused with a different event batch/);
});

test("a command batch rejects mixed IDs/metadata before projection changes and commits one receipt", () => {
  const original = { events: [], commandBatches: [], count: 0 };
  const batch = [event("evt-1"), event("evt-2")];
  const first = applyEventBatch(original, batch, (projection) => ({ ...projection, count: projection.count + 1 }));
  assert.equal(first.projection.count, 2);
  assert.equal(first.projection.commandBatches.length, 1);
  assert.deepEqual(first.commandBatch.events.map((item) => item.eventId), ["evt-1", "evt-2"]);
  assert.equal(applyEventBatch(first.projection, batch).projection.count, 2);

  assert.throws(() => applyEventBatch(first.projection, [event("evt-3"), { ...event("evt-4"), actorId: "other-user" }], (projection) => ({ ...projection, count: projection.count + 1 })), /cannot mix aggregate, actor/);
  assert.throws(() => applyEventBatch(first.projection, [event("evt-3"), { ...event("evt-4"), commandId: "cmd-other" }]), /cannot mix command IDs/);
  assert.throws(() => applyEventBatch(first.projection, [event("evt-1")]), /commandId reused with a different event batch/);
  assert.equal(first.projection.count, 2);
});

test("event batch reducer failure leaves original projection untouched", () => {
  const original = { events: [], commandBatches: [], count: 0 };
  assert.throws(() => applyEventBatch(original, [event("evt-a"), event("evt-b")], (projection, item) => {
    if (item.eventId === "evt-b") throw new Error("projection failed");
    return { ...projection, count: projection.count + 1 };
  }), /projection failed/);
  assert.deepEqual(original, { events: [], commandBatches: [], count: 0 });
});

function event(eventId) {
  return {
    eventId,
    commandId: "cmd-1",
    aggregateId: "order-1",
    type: "OrderOpened",
    schemaVersion: 1,
    actorId: "user-1",
    deviceId: "device-1",
    occurredAt: "2026-09-29T12:00:00.000Z",
    payload: { value: 1 },
  };
}
