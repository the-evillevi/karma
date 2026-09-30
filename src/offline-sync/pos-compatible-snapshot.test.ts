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
    mesa: "4",
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
  assert.equal(saved.table, "4");
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

test("prefers rich checkout line snapshots and retains manual tender, audit and refund facts", () => {
  // Mirrors the paired `items`/`lineSnapshots` record emitted by PosApp.register
  // in the current integration (7b0c612, src/PosApp.jsx around line 1063).
  const captured = capturedLine("sale-line-1", 5000, 1).capturedSnapshot;
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
          items: [{ name: "Latte", qty: 1, mods: "Avena +$5", total: 50 }],
          lineSnapshots: [
            {
              lineId: "sale-line-1",
              productId: "product-sale-line-1",
              name: "Latte",
              qty: 1,
              unitPriceCents: 5000,
              lineTotalCents: 5000,
              modsText: "Avena +$5",
              notes: "Sin canela",
              capturedSnapshot: captured,
              taxSnapshot: null,
            },
          ],
          preparationFolio: "K-200",
          sharedPreparation: true,
          splitFrom: { folio: "F-199", operationId: "split-199" },
          audit: [
            ["Hoy · 12:00", "Orden creada", "Ana Ruiz"],
            ["Hoy · 12:01", "Pago neto registrado", "Luis Solís"],
          ],
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
  assert.equal(sale.items[0]?.lineId, "sale-line-1");
  assert.equal(sale.items[0]?.productId, "product-sale-line-1");
  assert.equal(sale.items[0]?.price.lineTotalCents, 5000);
  assert.equal(sale.items[0]?.price.unitPriceCents, 5000);
  assert.equal(sale.items[0]?.price.evidence, "captured-prototype-catalog");
  assert.equal(sale.preparationFolio, "K-200");
  assert.equal(sale.sharedPreparation, true);
  assert.equal(sale.splitLineageEvidence, "recorded");
  assert.equal(sale.audit[0]?.displayTime, "Hoy · 12:00");
  assert.equal(sale.audit[0]?.actorName, "Ana Ruiz");
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

test("validates compensation allocations against complete payment identities and preserves legacy unknowns", () => {
  const payment = (paymentId: string, method = "cash", amount = 5000) => ({
    paymentId,
    method,
    netAmountCents: amount,
  });
  const refund = (
    commandId: string,
    amountCents: number,
    allocations: Array<{
      paymentId?: string;
      method?: string;
      amountCents: number;
    }>,
    paymentId?: string,
  ) => ({
    commandId,
    paymentId,
    kind: "refund",
    amountCents,
    reason: "Producto incorrecto",
    actorId: "staff-owner",
    actorName: "Mara Vega",
    occurredAt: "2026-09-30T12:10:00.000Z",
    allocations,
  });
  const adapt = (
    payments: unknown[],
    compensations: unknown[],
    totalCents = 5000,
  ) =>
    adaptPosStateToCompatibleSnapshot(
      {
        sales: [
          {
            folio: "F-COMPENSATION",
            status: "completada",
            totalCents,
            payments,
            compensations,
          },
        ],
      },
      metadata,
    );

  const mismatchedMethod = refund("refund-method", 1000, [
    { paymentId: "payment-1", method: "card", amountCents: 1000 },
  ]);
  assert.throws(
    () => adapt([payment("payment-1")], [mismatchedMethod]),
    /method conflicts with captured payment/,
  );
  assert.throws(
    () =>
      adapt(
        [payment("payment-1")],
        [
          refund("refund-missing-id", 1000, [
            { paymentId: "missing-payment", method: "cash", amountCents: 1000 },
          ]),
        ],
      ),
    /unknown captured payment/,
  );
  assert.throws(
    () =>
      adapt(
        [payment("payment-1")],
        [
          refund("duplicate-command", 1000, [
            { paymentId: "payment-1", method: "cash", amountCents: 1000 },
          ]),
          refund("duplicate-command", 1000, [
            { paymentId: "payment-1", method: "cash", amountCents: 1000 },
          ]),
        ],
      ),
    /repeats a compensation command ID/,
  );
  assert.throws(
    () =>
      adapt(
        [payment("payment-1"), payment("payment-1")],
        [
          refund("refund-duplicate-payment", 1000, [
            { paymentId: "payment-1", method: "cash", amountCents: 1000 },
          ]),
        ],
      ),
    /repeats a captured payment ID/,
  );
  assert.throws(
    () =>
      adapt(
        [payment("payment-1")],
        [
          refund("refund-duplicate-allocation", 1000, [
            { paymentId: "payment-1", method: "cash", amountCents: 500 },
            { paymentId: "payment-1", method: "cash", amountCents: 500 },
          ]),
        ],
      ),
    /repeats a payment allocation/,
  );
  assert.throws(
    () =>
      adapt(
        [payment("payment-1"), payment("payment-2")],
        [
          refund("refund-one", 3000, [
            { paymentId: "payment-1", method: "cash", amountCents: 3000 },
          ]),
          refund("refund-two", 3000, [
            { paymentId: "payment-1", method: "cash", amountCents: 3000 },
          ]),
        ],
        10000,
      ),
    /exceeds its captured payment/,
  );
  assert.throws(
    () =>
      adapt([payment("payment-1")], [refund("refund-unallocated", 1000, [])]),
    /allocation is missing for complete captured payments/,
  );

  const legacy = adapt(
    [{ method: "cash", netAmountCents: 5000 }],
    [
      refund("legacy-refund", 1200, [
        { paymentId: "unresolvable-legacy-id", amountCents: 1200 },
      ]),
    ],
  ).sales[0]!.compensations[0]!;
  assert.equal(legacy.allocationEvidence, "partial");
  assert.equal(legacy.allocations[0]?.paymentId, "unresolvable-legacy-id");
  assert.equal(legacy.allocations[0]?.method, null);

  const noAllocation = adapt([], [refund("legacy-no-allocation", 1200, [])])
    .sales[0]!.compensations[0]!;
  assert.equal(noAllocation.allocationEvidence, "partial");
  assert.deepEqual(noAllocation.allocations, []);
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
              folio: "F-ALIAS",
              status: "completada",
              totalCents: 5000,
              payments: [{ netAmountCents: 5000, amountCents: 4999 }],
            },
          ],
        },
        metadata,
      ),
    /conflicting cent values/,
  );
  assert.throws(
    () =>
      adaptPosStateToCompatibleSnapshot(
        {
          sales: [
            {
              folio: "F-TENDER-ALIAS",
              status: "completada",
              totalCents: 5000,
              tenders: [
                {
                  tenderedCents: 5000,
                  cashReceivedCents: 6000,
                  netAmountCents: 5000,
                  changeCents: 0,
                },
              ],
            },
          ],
        },
        metadata,
      ),
    /conflicting cent values/,
  );
  assert.throws(
    () =>
      adaptPosStateToCompatibleSnapshot(
        { sales: [{ folio: "F-USD", currency: "USD", items: [] }] },
        metadata,
      ),
    /currency must be MXN/,
  );
  assert.throws(
    () =>
      adaptPosStateToCompatibleSnapshot(
        {
          sales: [
            {
              folio: "F-USD-PAYMENT",
              payments: [
                { method: "cash", currency: "USD", netAmountCents: 1 },
              ],
            },
          ],
        },
        metadata,
      ),
    /currency must be MXN/,
  );
  assert.throws(
    () =>
      adaptPosStateToCompatibleSnapshot(
        { order: { items: [{ qty: 1, currency: "USD" }] } },
        metadata,
      ),
    /currency must be MXN/,
  );
  assert.throws(
    () =>
      adaptPosStateToCompatibleSnapshot(
        {
          sales: [
            {
              folio: "F-LINE-CONFLICT",
              items: [{ name: "Latte", qty: 1, total: 49 }],
              lineSnapshots: [
                {
                  lineId: "line-1",
                  productId: "product-1",
                  name: "Latte",
                  qty: 1,
                  unitPriceCents: 5000,
                  lineTotalCents: 5000,
                },
              ],
            },
          ],
        },
        metadata,
      ),
    /line snapshot total conflicts/,
  );
  const wrongQuantity = capturedLine("l-qty", 5000, 1);
  wrongQuantity.capturedSnapshot.quantity = 2;
  assert.throws(
    () =>
      adaptPosStateToCompatibleSnapshot(
        { order: { items: [wrongQuantity] } },
        metadata,
      ),
    /captured quantity conflicts/,
  );
  const wrongCurrency = capturedLine("l-usd", 5000, 1);
  wrongCurrency.capturedSnapshot.currency = "USD";
  assert.throws(
    () =>
      adaptPosStateToCompatibleSnapshot(
        { order: { items: [wrongCurrency] } },
        metadata,
      ),
    /currency must be MXN/,
  );
  const wrongModifierTotal = capturedLine("l-mods", 5000, 1);
  wrongModifierTotal.capturedSnapshot.modifiers[0]!.priceEffectCents = 400;
  assert.throws(
    () =>
      adaptPosStateToCompatibleSnapshot(
        { order: { items: [wrongModifierTotal] } },
        metadata,
      ),
    /modifier total does not reconcile/,
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
