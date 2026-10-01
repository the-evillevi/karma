import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPosOperation,
  createPosOperationsState,
} from "./pos-operations.ts";
import type { PosOperationLine, PosPaymentInput } from "./pos-operations.ts";
import { translatePosAppCapturedPaymentsV1 } from "./posapp-payment-operation-bridge-v1.ts";
import { calculateTender } from "./payment-tender.js";

const scope = { branchId: "branch-1", deviceId: "register-1" } as const;
const checkoutAuthority = {
  ...scope,
  actorId: "cashier-1",
  role: "barra" as const,
  capabilities: ["checkout"] as const,
};

function capturedFromCurrentRegister(
  folio: string,
  foodNetCents: number,
  tipCents: number,
  enteredTenders: Array<{
    id: string;
    method: "cash" | "card" | "transfer";
    amount: string;
  }>,
) {
  const totalCents = foodNetCents + tipCents;
  const tender = calculateTender(totalCents, enteredTenders, { tipCents });
  if (!tender.valid) throw new Error(tender.error);
  const payments = tender.payments
    .filter((payment) => payment.netAmountCents > 0)
    .map((payment) => ({
      paymentId: `${folio}:payment:${payment.id}`,
      method: payment.method,
      methodLabel: {
        cash: "Efectivo",
        card: "Tarjeta",
        transfer: "Transferencia",
      }[payment.method],
      netAmountCents: payment.netAmountCents,
      amountCents: payment.netAmountCents,
      amount: payment.netAmountCents / 100,
      tipCents: payment.tipCents,
      recordMode: "manual",
      verificationStatus:
        payment.method === "cash" ? "not_applicable" : "manual_unverified",
      ...(payment.method === "cash"
        ? {
            cashReceivedCents: payment.tenderedCents,
            changeCents: payment.changeCents,
          }
        : {}),
    }));
  const tenders = tender.payments
    .filter((payment) => payment.tenderedCents > 0)
    .map((payment) => ({
      tenderId: `${folio}:tender:${payment.id}`,
      method: payment.method,
      methodLabel: {
        cash: "Efectivo",
        card: "Tarjeta",
        transfer: "Transferencia",
      }[payment.method],
      tenderedCents: payment.tenderedCents,
      netAmountCents: payment.netAmountCents,
      changeCents: payment.changeCents,
      tipCents: payment.tipCents,
    }));
  return {
    folio,
    currency: "MXN",
    totalCents,
    total: totalCents / 100,
    tipCents,
    tip: tipCents / 100,
    paymentRecordMode: "manual",
    externalPaymentVerification: payments.some(
      (payment) => payment.method !== "cash",
    )
      ? "manual_unverified"
      : "not_applicable",
    payments,
    tenders,
  };
}

function emptyZeroSale(folio: string) {
  return {
    folio,
    currency: "MXN",
    totalCents: 0,
    total: 0,
    tipCents: 0,
    tip: 0,
    paymentRecordMode: "manual",
    externalPaymentVerification: "not_applicable",
    payments: [],
    tenders: [],
  };
}

function checkoutWithCapturedLine(
  sale:
    | ReturnType<typeof capturedFromCurrentRegister>
    | ReturnType<typeof emptyZeroSale>,
  payments: PosPaymentInput[],
  foodNetCents: number,
) {
  const orderId = `order-${sale.folio}`;
  const opened = applyPosOperation(
    createPosOperationsState(scope),
    {
      schemaVersion: 1,
      commandId: `open-${sale.folio}`,
      ...scope,
      actorId: "owner-1",
      occurredAt: "2026-09-30T12:00:00.000Z",
      expectedRevisions: [{ kind: "order", id: orderId, revision: 0 }],
      action: "order.opened",
      reason: null,
      payload: {
        orderId,
        orderType: "local",
        tableId: null,
        customer: null,
        lines: [line(sale.folio, foodNetCents)],
      },
    },
    {
      ...scope,
      actorId: "owner-1",
      role: "duena",
      capabilities: ["openOrder"],
    },
  ).state;
  const result = applyPosOperation(
    opened,
    {
      schemaVersion: 1,
      commandId: `checkout-${sale.folio}`,
      ...scope,
      actorId: checkoutAuthority.actorId,
      occurredAt: "2026-09-30T12:01:00.000Z",
      expectedRevisions: [
        { kind: "order", id: orderId, revision: 1 },
        { kind: "sale", id: sale.folio, revision: 0 },
      ],
      action: "order.checked-out",
      reason: null,
      payload: { orderId, saleId: sale.folio, payments },
    },
    checkoutAuthority,
  );
  return result.state.sales[0]!;
}

function line(id: string, cents: number): PosOperationLine {
  return {
    lineId: `line-${id}`,
    productId: "product-1",
    nameSnapshot: "Artículo capturado",
    quantity: 1,
    currency: "MXN",
    baseUnitPriceCents: cents,
    modifierTotalCents: 0,
    unitPriceCents: cents,
    lineTotalCents: cents,
    priceEvidence: "prototype-captured",
    catalogPriceVersionId: null,
    modifiers: [],
    notes: null,
    tax: {
      currency: "MXN",
      evidence: "unknown",
      rateBasisPoints: null,
      amountCents: null,
      policyId: null,
    },
  };
}

test("current mixed cash/card/transfer capture translates food net, tip, change, and applies checkout", () => {
  const legacy = capturedFromCurrentRegister("SALE-MIXED", 5000, 1000, [
    { id: "cash", method: "cash", amount: "30.00" },
    { id: "card", method: "card", amount: "35.00" },
    { id: "transfer", method: "transfer", amount: "5.00" },
  ]);
  const translated = translatePosAppCapturedPaymentsV1(legacy, 5000);
  assert.equal(translated.foodNetCents, 5000);
  assert.equal(translated.tipCents, 1000);
  assert.equal(translated.totalCents, 6000);
  assert.deepEqual(
    translated.payments.map(
      ({
        method,
        netAmountCents,
        tipCents,
        tenderedCents,
        changeCents,
        verification,
      }) => ({
        method,
        netAmountCents,
        tipCents,
        tenderedCents,
        changeCents,
        verification,
      }),
    ),
    [
      {
        method: "cash",
        netAmountCents: 1000,
        tipCents: 1000,
        tenderedCents: 3000,
        changeCents: 1000,
        verification: "not-applicable",
      },
      {
        method: "card",
        netAmountCents: 3500,
        tipCents: 0,
        tenderedCents: null,
        changeCents: null,
        verification: "manual-unverified",
      },
      {
        method: "transfer",
        netAmountCents: 500,
        tipCents: 0,
        tenderedCents: null,
        changeCents: null,
        verification: "manual-unverified",
      },
    ],
  );
  assert.equal(
    translated.payments.reduce(
      (sum, payment) => sum + payment.netAmountCents,
      0,
    ),
    5000,
  );
  assert.equal(
    translated.payments.reduce((sum, payment) => sum + payment.tipCents, 0),
    1000,
  );

  const sale = checkoutWithCapturedLine(legacy, translated.payments, 5000);
  assert.equal(sale.netTotalCents, 5000);
  assert.equal(sale.tipCents, 1000);
  assert.equal(sale.payments[0]?.tenderedCents, 3000);
  assert.equal(sale.payments[0]?.changeCents, 1000);
  assert.equal(sale.payments[1]?.verification, "manual-unverified");
});

test("zero-net returned cash is retained from the captured tender even when PosApp omitted its payment row", () => {
  const legacy = capturedFromCurrentRegister("SALE-RETURN", 5000, 0, [
    { id: "returned-cash", method: "cash", amount: "10.00" },
    { id: "card", method: "card", amount: "50.00" },
  ]);
  assert.equal(
    legacy.payments.some((payment) =>
      payment.paymentId.endsWith(":returned-cash"),
    ),
    false,
  );
  const translated = translatePosAppCapturedPaymentsV1(legacy, 5000);
  const returned = translated.payments.find((payment) =>
    payment.paymentId.endsWith(":returned-cash"),
  );
  assert.ok(returned);
  assert.deepEqual(returned, {
    paymentId: "SALE-RETURN:tender:returned-cash",
    method: "cash",
    netAmountCents: 0,
    tipCents: 0,
    tenderedCents: 1000,
    changeCents: 1000,
    recordMode: "manual",
    verification: "not-applicable",
  });
  const sale = checkoutWithCapturedLine(legacy, translated.payments, 5000);
  assert.equal(sale.payments.length, 2);
  assert.equal(
    sale.payments.find((payment) => payment.netAmountCents === 0)?.changeCents,
    1000,
  );
});

test("checks optional captured noncash tender aliases before mapping them to null", () => {
  const legacy = capturedFromCurrentRegister("SALE-NONCASH-ALIASES", 1000, 0, [
    { id: "card", method: "card", amount: "10.00" },
  ]);
  Object.assign(legacy.payments[0]!, { tenderedCents: 1000, changeCents: 0 });

  const translated = translatePosAppCapturedPaymentsV1(legacy, 1000);
  assert.equal(translated.payments[0]?.method, "card");
  assert.equal(translated.payments[0]?.tenderedCents, null);
  assert.equal(translated.payments[0]?.changeCents, null);
  assert.equal(translated.payments[0]?.verification, "manual-unverified");

  Object.assign(legacy.payments[0]!, { tenderedCents: 1001 });
  assert.throws(() => translatePosAppCapturedPaymentsV1(legacy, 1000), {
    code: "NONCASH_ALIAS_CONFLICT",
  });
});

test("an explicit empty zero-food capture translates and the reducer closes it without payments", () => {
  const legacy = emptyZeroSale("SALE-ZERO");
  const translated = translatePosAppCapturedPaymentsV1(legacy, 0);
  assert.deepEqual(translated, {
    payments: [],
    foodNetCents: 0,
    tipCents: 0,
    totalCents: 0,
  });
  const sale = checkoutWithCapturedLine(legacy, translated.payments, 0);
  assert.equal(sale.netTotalCents, 0);
  assert.deepEqual(sale.payments, []);
});

test("rejects tip-only/zero-food tender records rather than creating a payment the operation reducer cannot accept", () => {
  const tipOnly = capturedFromCurrentRegister("SALE-TIP-ONLY", 0, 100, [
    { id: "cash", method: "cash", amount: "1.00" },
  ]);
  assert.throws(() => translatePosAppCapturedPaymentsV1(tipOnly, 0), {
    code: "ZERO_FOOD_DUE_UNSUPPORTED",
  });
});

test("fails closed on missing IDs/tips/verification, currency, conflicting aliases, and unsafe totals", () => {
  const valid = capturedFromCurrentRegister("SALE-GUARDS", 5000, 500, [
    { id: "cash", method: "cash", amount: "55.00" },
  ]);
  const missingId = structuredClone(valid);
  Reflect.deleteProperty(missingId.payments[0]!, "paymentId");
  assert.throws(() => translatePosAppCapturedPaymentsV1(missingId, 5000), {
    code: "CAPTURE_ID_INVALID",
  });

  const missingTip = structuredClone(valid);
  Reflect.deleteProperty(missingTip.payments[0]!, "tipCents");
  assert.throws(() => translatePosAppCapturedPaymentsV1(missingTip, 5000), {
    code: "MONEY_INVALID",
  });

  const unknownVerification = structuredClone(valid);
  unknownVerification.payments[0]!.verificationStatus = "approved";
  assert.throws(
    () => translatePosAppCapturedPaymentsV1(unknownVerification, 5000),
    { code: "VERIFICATION_UNKNOWN" },
  );

  const unknownCurrency = { ...structuredClone(valid), currency: "USD" };
  assert.throws(
    () => translatePosAppCapturedPaymentsV1(unknownCurrency, 5000),
    { code: "CURRENCY_UNSUPPORTED" },
  );

  const conflictingAlias = structuredClone(valid);
  conflictingAlias.payments[0]!.amountCents += 1;
  assert.throws(
    () => translatePosAppCapturedPaymentsV1(conflictingAlias, 5000),
    { code: "CENT_ALIAS_CONFLICT" },
  );

  const badTipAlias = { ...structuredClone(valid), tip: 6 };
  assert.throws(() => translatePosAppCapturedPaymentsV1(badTipAlias, 5000), {
    code: "CENT_ALIAS_CONFLICT",
  });

  assert.throws(
    () => translatePosAppCapturedPaymentsV1(valid, Number.MAX_SAFE_INTEGER),
    { code: "MONEY_OVERFLOW" },
  );
});

test("rejects unknown or conflicting row identities and mismatched food due", () => {
  const valid = capturedFromCurrentRegister("SALE-IDS", 5000, 0, [
    { id: "card", method: "card", amount: "50.00" },
  ]);
  const wrongScope = structuredClone(valid);
  wrongScope.payments[0]!.paymentId = "OTHER:payment:card";
  assert.throws(() => translatePosAppCapturedPaymentsV1(wrongScope, 5000), {
    code: "PAYMENT_ID_SCOPE",
  });

  const mismatchedTender = structuredClone(valid);
  mismatchedTender.tenders[0]!.netAmountCents -= 1;
  assert.throws(
    () => translatePosAppCapturedPaymentsV1(mismatchedTender, 5000),
    { code: "TENDER_MISMATCH" },
  );

  assert.throws(() => translatePosAppCapturedPaymentsV1(valid, 4999), {
    code: "TOTAL_MISMATCH",
  });
});

test("rejects safe individual cash tenders whose aggregate gross/change overflows", () => {
  const row = (suffix: string) => ({
    paymentId: `SALE-OVERFLOW:payment:${suffix}`,
    method: "cash",
    netAmountCents: 1,
    amountCents: 1,
    amount: 0.01,
    tipCents: 0,
    recordMode: "manual",
    verificationStatus: "not_applicable",
    cashReceivedCents: 5_000_000_000_000_000,
    changeCents: 4_999_999_999_999_999,
  });
  const tender = (suffix: string) => ({
    tenderId: `SALE-OVERFLOW:tender:${suffix}`,
    method: "cash",
    tenderedCents: 5_000_000_000_000_000,
    netAmountCents: 1,
    changeCents: 4_999_999_999_999_999,
    tipCents: 0,
  });
  const capture = {
    folio: "SALE-OVERFLOW",
    currency: "MXN",
    totalCents: 2,
    total: 0.02,
    tipCents: 0,
    tip: 0,
    paymentRecordMode: "manual",
    externalPaymentVerification: "not_applicable",
    payments: [row("one"), row("two")],
    tenders: [tender("one"), tender("two")],
  };
  assert.throws(() => translatePosAppCapturedPaymentsV1(capture, 2), {
    code: "MONEY_OVERFLOW",
  });
});
