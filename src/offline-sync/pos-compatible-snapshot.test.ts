import assert from "node:assert/strict";
import test from "node:test";
import { adaptPosStateToCompatibleSnapshot } from "./pos-compatible-snapshot.ts";

const capturedLine = (
  lineId: string,
  unitPriceCents: number,
  quantity: number,
) => ({
  lineId,
  prodId: `product-${lineId}`,
  qty: quantity,
  name: "Latte",
  modsText: "Avena +$5",
  notes: "Sin canela",
  capturedSnapshot: {
    productId: `product-${lineId}`,
    name: "Latte",
    quantity,
    currency: "MXN",
    baseUnitPriceCents: unitPriceCents - 500,
    modifiersTotalCents: 500,
    unitPriceCents,
    lineTotalCents: unitPriceCents * quantity,
    modifiers: [
      {
        groupId: "milk",
        groupName: "Leche",
        optionId: "oat",
        optionName: "Avena",
        priceEffectCents: 500,
        currency: "MXN",
      },
    ],
    notes: "Sin canela",
    taxSnapshot: null,
  },
});

const metadata = {
  snapshotId: "snapshot-pos-2026-09-30-01",
  capturedAt: "2026-09-30T12:00:00.000Z",
  branchId: "branch-1",
  deviceId: "register-1",
  actorId: "staff-1",
};

test("adapts captured prototype orders and retains actor, contact, preparation and split history", () => {
  const order = {
    folio: "F-100",
    type: "mesa",
    ref: "Mesa 4",
    time: "2026-09-30T11:00:00.000Z",
    actorId: "staff-original",
    actorName: "Ana Ruiz",
    actorHistory: [
      {
        action: "order_split",
        actorId: "staff-manager",
        actorName: "Luis Solís",
        occurredAt: "2026-09-30T11:10:00.000Z",
        reason: "Cliente pide cuentas separadas",
        uiOnly: "discard me",
      },
    ],
    name: "Cliente",
    phone: "5551234",
    address: "Centro",
    responsible: "Ana Ruiz",
    discount: 5,
    discountReason: "Atención por demora",
    discountActorId: "staff-manager",
    discountActorName: "Luis Solís",
    items: [capturedLine("l-1", 2500, 1), capturedLine("l-2", 1500, 1)],
    totalCents: 3500,
    prep: "preparando",
    preparationFolio: "F-100",
    sharedPreparation: true,
    splitFrom: { folio: "F-090", operationId: "split-1", extra: "omit" },
    splitOperations: [
      {
        operationId: "split-2",
        childFolio: "F-101",
        createdAt: "2026-09-30T11:10:00.000Z",
        selection: [{ lineId: "l-2", quantity: 1 }],
      },
    ],
  };
  const snapshot = adaptPosStateToCompatibleSnapshot(
    { order, open: [order], kitchenTickets: [order] },
    metadata,
  );
  const saved = snapshot.stationDraft!;

  assert.equal(snapshot.snapshotId, metadata.snapshotId);
  assert.equal(saved.money.subtotalCents, 4000);
  assert.equal(saved.money.discountCents, 500);
  assert.equal(saved.money.totalCents, 3500);
  assert.equal(saved.money.reconciliation, "verified");
  assert.deepEqual(saved.contact, {
    name: "Cliente",
    phone: "5551234",
    address: "Centro",
  });
  assert.equal(saved.actorHistory[0]?.reason, "Cliente pide cuentas separadas");
  assert.deepEqual(saved.splitFrom, { folio: "F-090", operationId: "split-1" });
  assert.equal(saved.splitLineageEvidence, "recorded");
  assert.equal(saved.splitOperations[0]?.selection[0]?.lineId, "l-2");
  assert.equal(saved.preparation.shared, true);
  assert.equal(snapshot.kitchenTickets[0]?.preparation.status, "preparando");
  assert.equal(snapshot.kitchenTickets[0]?.splitLineageEvidence, "recorded");
  assert.equal(saved.items[0]?.price.evidence, "captured-prototype-catalog");
  assert.equal(saved.items[0]?.price.catalogPriceVersionId, null);
  assert.equal(saved.items[0]?.modifierSelections[0]?.optionName, "Avena");
  assert.equal(saved.items[0]?.modifierEvidence, "captured");
  assert.deepEqual(saved.items[0]?.tax, {
    status: "unknown",
    rateBasisPoints: null,
    amountCents: null,
    source: null,
  });
  assert.equal("uiOnly" in saved.actorHistory[0]!, false);
});

test("preserves manual payment, tender/change and refund facts while labeling lossy sale lines", () => {
  const snapshot = adaptPosStateToCompatibleSnapshot(
    {
      sales: [
        {
          folio: "F-200",
          status: "completada",
          fecha: "2026-09-30T12:00:00.000Z",
          tipo: "Para llevar",
          creo: "Ana Ruiz",
          actorId: "staff-original",
          cobro: "Luis Solís",
          paidByActorId: "staff-cashier",
          totalCents: 5000,
          tipCents: 0,
          currency: "MXN",
          paymentRecordMode: "manual",
          externalPaymentVerification: "manual_unverified",
          items: [{ name: "Latte", qty: 1, mods: "Avena", total: 50 }],
          payments: [
            {
              paymentId: "payment-1",
              method: "cash",
              netAmountCents: 5000,
              amountCents: 5000,
              tipCents: 0,
              recordMode: "manual",
              verificationStatus: "not_applicable",
              cashReceivedCents: 6000,
              changeCents: 1000,
            },
          ],
          tenders: [
            {
              tenderId: "tender-1",
              method: "cash",
              tenderedCents: 6000,
              netAmountCents: 5000,
              changeCents: 1000,
              tipCents: 0,
            },
          ],
          compensations: [
            {
              commandId: "refund-1",
              kind: "refund",
              paymentId: "payment-1",
              amountCents: 1200,
              reason: "Producto incorrecto",
              actorId: "staff-owner",
              actorName: "Mara Vega",
              occurredAt: "2026-09-30T12:10:00.000Z",
              recordMode: "manual",
              inventoryCompensation: "none",
              allocations: [
                {
                  paymentId: "payment-1",
                  method: "cash",
                  amountCents: 1200,
                  externalVerification: "not_applicable",
                },
              ],
            },
          ],
        },
      ],
    },
    metadata,
  );
  const sale = snapshot.sales[0]!;

  assert.equal(sale.creator.actorId, "staff-original");
  assert.equal(sale.paidBy.actorId, "staff-cashier");
  assert.equal(sale.payments[0]?.recordMode, "manual");
  assert.equal(sale.tenders[0]?.tenderedCents, 6000);
  assert.equal(sale.tenders[0]?.changeCents, 1000);
  assert.equal(sale.compensations[0]?.reason, "Producto incorrecto");
  assert.equal(sale.compensations[0]?.actorId, "staff-owner");
  assert.equal(sale.compensations[0]?.allocations[0]?.amountCents, 1200);
  assert.equal(sale.items[0]?.lineId, null);
  assert.equal(sale.items[0]?.productId, null);
  assert.equal(sale.items[0]?.price.lineTotalCents, 5000);
  assert.equal(sale.items[0]?.price.unitPriceCents, null);
  assert.equal(sale.items[0]?.price.evidence, "sale-line-total-only");
  assert.equal(sale.splitLineageEvidence, "not-recorded");
});

test("retains cancellation and split lineage facts with safe money fields", () => {
  const snapshot = adaptPosStateToCompatibleSnapshot(
    {
      open: [
        {
          folio: "F-300",
          type: "mesa",
          actorId: "staff-original",
          items: [capturedLine("l-3", 4000, 1)],
          totalCents: 4000,
          splitFrom: { folio: "F-299", operationId: "split-previous" },
          preparationFolio: "F-299",
        },
      ],
      sales: [
        {
          folio: "F-301",
          status: "cancelada",
          tipo: "Mesa 2",
          actorId: "staff-original",
          creo: "Ana Ruiz",
          cancelledByActorId: "staff-manager",
          cancelledByActorName: "Luis Solís",
          cancelledAt: "2026-09-30T12:20:00.000Z",
          motivo: "Cliente cambió de opinión",
          subtotalCents: 4000,
          discount: 0,
          total: 40,
          items: [{ ...capturedLine("l-4", 4000, 1), total: 40 }],
          payments: [],
        },
      ],
    },
    metadata,
  );
  assert.deepEqual(snapshot.openAccounts[0]?.splitFrom, {
    folio: "F-299",
    operationId: "split-previous",
  });
  assert.equal(snapshot.openAccounts[0]?.preparation.shared, null);
  assert.equal(
    snapshot.sales[0]?.cancellationReason,
    "Cliente cambió de opinión",
  );
  assert.equal(snapshot.sales[0]?.cancelledBy.actorId, "staff-manager");
  assert.equal(snapshot.sales[0]?.money.totalCents, 4000);
});

test("rejects inconsistent money and excludes authentication, staff and credential state", () => {
  const safe = adaptPosStateToCompatibleSnapshot(
    {
      order: {
        folio: "F-400",
        items: [capturedLine("l-5", 2500, 1)],
        totalCents: 2500,
      },
      open: [],
      kitchenTickets: [],
      sales: [],
      session: "token-secret",
      pick: "staff-secret",
      usersX: [{ id: "staff-secret", pin: "1234" }],
      password: "never-copy",
      serviceKey: "never-copy",
      createdCredential: { password: "one-time-secret" },
    },
    metadata,
  );
  const serialized = JSON.stringify(safe);
  for (const secret of [
    "token-secret",
    "staff-secret",
    "1234",
    "never-copy",
    "one-time-secret",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.deepEqual(Object.keys(safe).sort(), [
    "branchId",
    "capturedAt",
    "capturedByActorId",
    "deviceId",
    "kind",
    "kitchenTickets",
    "openAccounts",
    "sales",
    "schemaVersion",
    "snapshotId",
    "stationDraft",
  ]);
  assert.throws(
    () =>
      adaptPosStateToCompatibleSnapshot(
        {
          order: {
            folio: "F-BAD",
            items: [capturedLine("l-bad", 2500, 1)],
            discount: 0,
            totalCents: 2499,
          },
        },
        metadata,
      ),
    /order total does not reconcile/,
  );
  assert.throws(
    () =>
      adaptPosStateToCompatibleSnapshot(
        {
          sales: [
            {
              folio: "F-BAD-SALE",
              status: "completada",
              totalCents: 5000,
              payments: [{ method: "card", netAmountCents: 4999 }],
            },
          ],
        },
        metadata,
      ),
    /sale payments do not reconcile/,
  );
  assert.throws(
    () =>
      adaptPosStateToCompatibleSnapshot(
        {
          sales: [
            {
              folio: "F-OVER-REFUND",
              status: "completada",
              totalCents: 5000,
              payments: [
                {
                  paymentId: "payment-1",
                  method: "cash",
                  netAmountCents: 5000,
                },
              ],
              compensations: [
                {
                  commandId: "refund-too-large",
                  kind: "refund",
                  paymentId: "payment-1",
                  amountCents: 5001,
                  reason: "Exceso",
                  actorId: "owner-1",
                  actorName: "Owner",
                  occurredAt: "2026-09-30T12:00:00.000Z",
                  allocations: [
                    {
                      paymentId: "payment-1",
                      method: "cash",
                      amountCents: 5001,
                    },
                  ],
                },
              ],
            },
          ],
        },
        metadata,
      ),
    /compensation exceeds/,
  );
});
