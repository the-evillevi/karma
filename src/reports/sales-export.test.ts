import assert from "node:assert/strict";
import test from "node:test";
import { createSalesCsv, csvCell } from "./sales-export.ts";
import { customReportPeriod } from "./report-period.ts";
const options = {
  snapshotId: "report:1",
  branchId: "branch",
  deviceId: "device",
  actorId: "owner",
  capturedAt: "2026-09-30T12:00:00.000Z",
  timeZone: "America/Mexico_City",
  selectionLabel: "Vista local seleccionada",
};
const sale = () => ({
  folio: "A-1",
  occurredAt: "2026-09-30T02:00:00.000Z",
  status: "completada",
  total: 50,
  tip: 0,
  currency: "MXN",
  cobro: '=HYPERLINK("https://example.invalid")',
  items: [{ name: "Café", qty: 1, total: 50 }],
  payments: [
    {
      paymentId: "cash-1",
      method: "cash",
      netAmountCents: 5000,
      cashReceivedCents: 10000,
      changeCents: 5000,
      tipCents: 0,
    },
  ],
});
test("exports captured net receipts and change separately with real branch dates and protected text", () => {
  const source = sale();
  const before = structuredClone(source);
  const report = createSalesCsv([source], options);
  assert.equal(report.saleCount, 1);
  assert.equal(report.rowCount, 2);
  assert.equal(report.unknownDateCount, 0);
  assert.ok(report.csv.startsWith("\uFEFF"));
  assert.match(report.csv, /29\/09\/2026, 20:00:00/);
  assert.match(report.csv, /"cash",50,100,50/);
  assert.match(report.csv, /'="?HYPERLINK/);
  assert.match(report.csv, /acuse servidor no comprobado/);
  assert.deepEqual(source, before);
});
test("preserves unknown historical dates and refund dates without inventing period or settlement", () => {
  const source = {
    ...sale(),
    occurredAt: undefined,
    fecha: "Hoy · 09:00",
    day: 0,
    compensations: [
      {
        commandId: "r1",
        kind: "refund",
        amountCents: 1000,
        actorId: "manager",
        actorName: "Encargado",
        reason: "Error corregido",
        occurredAt: "2026-09-30T12:00:00.000Z",
        allocations: [
          {
            paymentId: "cash-1",
            method: "cash",
            amountCents: 1000,
            externalVerification: "not_applicable",
          },
        ],
      },
    ],
  };
  const report = createSalesCsv([source], options);
  assert.equal(report.unknownDateCount, 1);
  assert.equal(report.rowCount, 3);
  assert.match(report.csv, /Fecha real sin dato/);
  assert.match(report.csv, /"refund","A-1","r1","2026-09-30T12:00:00.000Z"/);
  assert.match(report.csv, /"Hoy · 09:00","",""/);
  assert.match(
    report.csv,
    /"Error corregido","cash-1","Completa con pagos capturados; no confirma proveedor"/,
  );
});
test("period export omits an older receipt but includes its period-dated refund and separates unknown-date records", () => {
  const older = {
    ...sale(),
    folio: "A-OLD",
    occurredAt: "2026-09-29T12:00:00.000Z",
    payments: [{ ...sale().payments[0], paymentId: "cash-old" }],
    compensations: [
      {
        commandId: "refund-old",
        kind: "refund",
        amountCents: 1000,
        actorId: "manager",
        actorName: "Encargado",
        reason: "Devolución posterior",
        occurredAt: "2026-09-30T18:30:00.000Z",
        allocations: [
          { paymentId: "cash-old", method: "cash", amountCents: 1000 },
        ],
      },
    ],
  };
  const current = {
    ...sale(),
    folio: "A-CURRENT",
    occurredAt: "2026-09-30T18:00:00.000Z",
  };
  const legacy = {
    ...sale(),
    folio: "A-LEGACY",
    occurredAt: undefined,
    fecha: "Hoy · 09:00",
  };
  const period = customReportPeriod(
    "2026-09-30T12:00",
    "2026-09-30T14:00",
    "America/Mexico_City",
  );
  const report = createSalesCsv([older, current, legacy], {
    ...options,
    period,
    selectionLabel: period.label,
  });
  assert.equal(report.saleCount, 1);
  assert.equal(report.unknownDateCount, 1);
  assert.match(report.csv, /"A-CURRENT"/);
  assert.doesNotMatch(report.csv, /"venta","A-OLD"/);
  assert.doesNotMatch(report.csv, /"pago","A-OLD"/);
  assert.match(
    report.csv,
    /"refund","A-OLD","refund-old","2026-09-30T18:30:00.000Z"/,
  );
  assert.match(report.csv, /"A-LEGACY"/);
  assert.match(report.csv, /Legado sin fecha real; separado del periodo/);
});
test("fails closed on inconsistent amounts and invalid time zone; neutralizes formula and CSV injection", () => {
  assert.throws(() =>
    createSalesCsv(
      [
        {
          ...sale(),
          payments: [{ ...sale().payments[0], netAmountCents: 5100 }],
        },
      ],
      options,
    ),
  );
  assert.throws(() =>
    createSalesCsv([sale()], { ...options, timeZone: "invalid" }),
  );
  assert.equal(csvCell(" \\t=1".replace("\\t", "\t")), '"\' \t=1"');
  assert.equal(
    csvCell('name,\"quote\"\nnew line'),
    '"name,""quote""\nnew line"',
  );
  assert.equal(csvCell(50), "50");
});
