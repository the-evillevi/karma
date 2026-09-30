import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSalesPeriodReport,
  customReportPeriod,
  localReportTimeToUtc,
  presetReportPeriod,
  recordedUtcInstant,
} from "./report-period.ts";
const metadata = {
  snapshotId: "period:1",
  branchId: "branch",
  deviceId: "device",
  actorId: "owner",
  capturedAt: "2026-09-30T12:00:00.000Z",
};
const sale = (at: string, total = 50) => ({
  folio: at,
  status: "completada",
  occurredAt: at,
  total,
  tip: 0,
  items: [{ name: "Café", qty: 1, total }],
  payments: [
    {
      paymentId: "cash:" + at,
      method: "cash",
      netAmountCents: total * 100,
      cashReceivedCents: total * 200,
      changeCents: total * 100,
    },
  ],
});
test("local branch periods use midnight, exact boundaries and calendar day counts", () => {
  const period = presetReportPeriod(
    "7d",
    "2026-09-30T02:00:00.000Z",
    "America/Mexico_City",
  );
  assert.equal(period.startUtc, "2026-09-23T06:00:00.000Z");
  const today = presetReportPeriod(
    "hoy",
    "2026-09-30T12:00:00.000Z",
    "America/Mexico_City",
  );
  assert.equal(today.startUtc, "2026-09-30T06:00:00.000Z");
  const result = buildSalesPeriodReport(
    [
      sale("2026-09-30T05:59:59.999Z"),
      sale("2026-09-30T06:00:00.000Z"),
      sale("2026-09-30T12:00:00.001Z"),
    ],
    today,
    metadata,
  );
  assert.deepEqual(result.selectedIndexes, [1]);
  assert.equal(result.grossReceiptsCents, 5000);
  assert.equal(result.receivedByMethod.cash, 5000);
});
test("custom branch times reject nonexistent clocks and require a choice for repeated clocks", () => {
  assert.throws(
    () => localReportTimeToUtc("2026-03-08T02:30", "America/New_York"),
    { code: "nonexistent_local_time" },
  );
  assert.throws(
    () => localReportTimeToUtc("2026-11-01T01:30", "America/New_York"),
    { code: "ambiguous_local_time" },
  );
  assert.equal(
    localReportTimeToUtc("2026-11-01T01:30", "America/New_York", "earlier"),
    "2026-11-01T05:30:00.000Z",
  );
  assert.equal(
    localReportTimeToUtc("2026-11-01T01:30", "America/New_York", "later"),
    "2026-11-01T06:30:00.000Z",
  );
  assert.throws(
    () =>
      customReportPeriod(
        "2026-09-30T12:00",
        "2026-09-30T11:00",
        "America/Mexico_City",
      ),
    { code: "invalid_period" },
  );
  assert.throws(
    () => localReportTimeToUtc("2026-02-30T12:00", "America/Mexico_City"),
    { code: "invalid_local_time" },
  );
  assert.equal(recordedUtcInstant("Hoy · 09:00"), null);
  assert.equal(recordedUtcInstant("2026-02-30T12:00:00Z"), null);
});
test("returns are assigned to their own period and method even for an older sale", () => {
  const older = {
    ...sale("2026-09-29T12:00:00.000Z"),
    compensations: [
      {
        commandId: "return1",
        kind: "refund",
        amountCents: 1000,
        reason: "Devolución",
        actorId: "manager",
        actorName: "Encargado",
        occurredAt: "2026-09-30T11:00:00.000Z",
        allocations: [
          {
            paymentId: "cash:2026-09-29T12:00:00.000Z",
            method: "cash",
            amountCents: 1000,
          },
        ],
      },
    ],
  };
  const result = buildSalesPeriodReport(
    [older],
    presetReportPeriod("hoy", metadata.capturedAt, "America/Mexico_City"),
    metadata,
  );
  assert.equal(result.grossReceiptsCents, 0);
  assert.equal(result.refundsCents, 1000);
  assert.equal(result.netReceiptsCents, -1000);
  assert.equal(result.netByMethod.cash, -1000);
  assert.equal(result.refundEvents[0]?.saleIndex, 0);
});
test("unknown date and payment facts remain explicit; tips and cancelled captures are separate", () => {
  const known = { ...sale("2026-09-30T10:00:00.000Z", 55), tip: 5 };
  const cancelled = {
    ...sale("2026-09-30T09:00:00.000Z"),
    status: "cancelada",
  };
  const unknown = {
    ...sale("2026-09-30T08:00:00.000Z"),
    occurredAt: undefined,
    fecha: "Hoy · 08:00",
    day: 0,
  };
  const noMethod = { ...sale("2026-09-30T07:00:00.000Z"), payments: [] };
  const source = [known, cancelled, unknown, noMethod];
  const before = structuredClone(source);
  const result = buildSalesPeriodReport(
    source,
    presetReportPeriod("hoy", metadata.capturedAt, "America/Mexico_City"),
    metadata,
  );
  assert.deepEqual(result.unknownDateIndexes, [2]);
  assert.equal(result.grossReceiptsCents, 10500);
  assert.equal(result.grossSalesCents, 10000);
  assert.equal(result.tipsCents, 500);
  assert.equal(result.cancelledCount, 1);
  assert.equal(result.receivedByMethod.cash, 5500);
  assert.equal(result.receivedByMethod.unknown, 5000);
  assert.ok(result.unknownPaymentCount > 0);
  assert.deepEqual(source, before);
});

test("actual cancellation instants determine cancellation counts without inventing legacy dates", () => {
  const period = presetReportPeriod(
    "hoy",
    metadata.capturedAt,
    "America/Mexico_City",
  );
  const canceled = {
    ...sale("Hoy · 09:00"),
    status: "cancelada",
    cancelledAt: "2026-09-30T11:00:00Z",
    payments: [],
  };
  const before = structuredClone(canceled);
  const result = buildSalesPeriodReport([canceled], period, metadata);
  assert.deepEqual(result.selectedIndexes, [0]);
  assert.deepEqual(result.unknownDateIndexes, []);
  assert.equal(result.cancelledCount, 1);
  assert.equal(result.grossReceiptsCents, 0);
  assert.deepEqual(canceled, before);
});

test("a refund attached to an unpaid cancellation cannot reduce period receipts", () => {
  const canceled = {
    ...sale("2026-09-30T09:00:00Z"),
    status: "cancelada",
    payments: [],
    compensations: [
      {
        commandId: "invalid-return",
        kind: "refund",
        amountCents: 1000,
        actorName: "Encargado",
        actorId: "manager",
        occurredAt: "2026-09-30T11:00:00Z",
        reason: "Revisar",
        allocations: [],
      },
    ],
  };
  assert.throws(
    () =>
      buildSalesPeriodReport(
        [canceled],
        presetReportPeriod("hoy", metadata.capturedAt, "America/Mexico_City"),
        metadata,
      ),
    { code: "refund_on_unpaid_cancellation" },
  );
});
