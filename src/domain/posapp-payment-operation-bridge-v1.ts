import type { PosPaymentInput } from "./pos-operations.ts";
import { moneyToCents } from "./payment-tender.js";

const MAX_ROWS = 50;
const MAX_ID_LENGTH = 180;

type CaptureRecord = Record<string, unknown>;
type PaymentRow = {
  paymentId: string;
  suffix: string;
  method: PosPaymentInput["method"];
  legacyNetCents: number;
  tipCents: number;
  tenderedCents: number;
  changeCents: number;
};
type TenderRow = {
  tenderId: string;
  suffix: string;
  method: PosPaymentInput["method"];
  legacyNetCents: number;
  tipCents: number;
  tenderedCents: number;
  changeCents: number;
};

export class PosAppPaymentBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PosAppPaymentBridgeError";
  }
}

export interface PosAppPaymentBridgeResult {
  /** Operation-v1 net is the amount applied to the captured food/order due. */
  payments: PosPaymentInput[];
  foodNetCents: number;
  tipCents: number;
  totalCents: number;
}

/**
 * Translate only the current PosApp.register captured sale shape into
 * operation-v1 payments. Legacy sale payment net includes allocated tip;
 * operation-v1 represents food net and tip separately.
 *
 * `expectedFoodNetCents` must be computed by the caller from the current
 * captured operation order/discount facts. This adapter does not infer a
 * missing historical subtotal or discount from legacy display fields.
 */
export function translatePosAppCapturedPaymentsV1(
  candidate: unknown,
  expectedFoodNetCents: unknown,
): PosAppPaymentBridgeResult {
  const sale = object(candidate, "sale");
  const expectedFoodNet = safeCents(
    expectedFoodNetCents,
    "expectedFoodNetCents",
  );
  const folio = identifier(sale.folio, "sale.folio");
  if (sale.currency !== "MXN")
    fail("CURRENCY_UNSUPPORTED", "Captured sale currency must be MXN.");
  if (sale.paymentRecordMode !== "manual")
    fail("RECORD_MODE_UNKNOWN", "Captured payment record mode must be manual.");

  const totalCents = centsWithMoneyAlias(
    sale,
    "totalCents",
    "total",
    "sale total",
  );
  const tipCents = centsWithMoneyAlias(sale, "tipCents", "tip", "sale tip");
  const expectedAllInCents = safeAdd(
    expectedFoodNet,
    tipCents,
    "food total plus tip",
  );
  if (totalCents !== expectedAllInCents)
    fail(
      "TOTAL_MISMATCH",
      "Captured sale total does not equal order food due plus tip.",
    );

  const rawPayments = rows(sale.payments, "sale.payments");
  const rawTenders = rows(sale.tenders, "sale.tenders");
  const payments = new Map<string, PaymentRow>();
  const tenders = new Map<string, TenderRow>();
  let capturedGrossTenderCents = 0;
  let capturedChangeCents = 0;
  const paymentPrefix = `${folio}:payment:`;
  const tenderPrefix = `${folio}:tender:`;

  for (const [index, raw] of rawPayments.entries()) {
    const row = object(raw, `sale.payments[${index}]`);
    checkAllowedKeys(
      row,
      [
        "paymentId",
        "method",
        "methodLabel",
        "netAmountCents",
        "amountCents",
        "amount",
        "tipCents",
        "recordMode",
        "verificationStatus",
        "cashReceivedCents",
        "tenderedCents",
        "changeCents",
        "currency",
      ],
      `sale.payments[${index}]`,
    );
    checkOptionalCurrency(row.currency, `sale.payments[${index}].currency`);
    const paymentId = identifier(
      row.paymentId,
      `sale.payments[${index}].paymentId`,
    );
    const suffix = prefixedSuffix(paymentId, paymentPrefix, "paymentId");
    const method = paymentMethod(row.method, `sale.payments[${index}].method`);
    const legacyNetCents = centsAliases(
      row,
      "netAmountCents",
      "amountCents",
      `payment ${paymentId}`,
      "amount",
    );
    if (legacyNetCents < 1)
      fail(
        "PAYMENT_ROW_NOT_CAPTURED",
        "PosApp omits zero-net rows from sale.payments.",
      );
    const tip = safeCents(row.tipCents, `sale.payments[${index}].tipCents`);
    if (tip > legacyNetCents)
      fail(
        "TIP_EXCEEDS_CAPTURED_ROW",
        "Captured tip exceeds the legacy payment row.",
      );
    if (row.recordMode !== "manual")
      fail(
        "RECORD_MODE_UNKNOWN",
        `Payment ${paymentId} is not explicitly manual.`,
      );
    const expectedVerification =
      method === "cash" ? "not_applicable" : "manual_unverified";
    if (row.verificationStatus !== expectedVerification)
      fail(
        "VERIFICATION_UNKNOWN",
        `Payment ${paymentId} has unsupported verification evidence.`,
      );

    const tenderedAlias = optionalCentAlias(
      row,
      ["cashReceivedCents", "tenderedCents"],
      `payment ${paymentId} tendered amount`,
    );
    const changeAlias = hasOwn(row, "changeCents")
      ? safeCents(row.changeCents, `sale.payments[${index}].changeCents`)
      : null;
    if (method === "cash" && (tenderedAlias === null || changeAlias === null))
      fail(
        "CASH_TENDER_MISSING",
        `Cash payment ${paymentId} is missing captured tender/change.`,
      );

    const captured: PaymentRow = {
      paymentId,
      suffix,
      method,
      legacyNetCents,
      tipCents: tip,
      tenderedCents: tenderedAlias ?? legacyNetCents,
      changeCents: changeAlias ?? 0,
    };
    if (payments.has(suffix))
      fail("DUPLICATE_PAYMENT_ID", "Captured payment identity is duplicated.");
    payments.set(suffix, captured);
  }

  for (const [index, raw] of rawTenders.entries()) {
    const row = object(raw, `sale.tenders[${index}]`);
    checkAllowedKeys(
      row,
      [
        "tenderId",
        "method",
        "methodLabel",
        "tenderedCents",
        "netAmountCents",
        "changeCents",
        "tipCents",
        "currency",
      ],
      `sale.tenders[${index}]`,
    );
    checkOptionalCurrency(row.currency, `sale.tenders[${index}].currency`);
    const tenderId = identifier(
      row.tenderId,
      `sale.tenders[${index}].tenderId`,
    );
    const suffix = prefixedSuffix(tenderId, tenderPrefix, "tenderId");
    const method = paymentMethod(row.method, `sale.tenders[${index}].method`);
    const tenderedCents = safeCents(
      row.tenderedCents,
      `sale.tenders[${index}].tenderedCents`,
    );
    const legacyNetCents = safeCents(
      row.netAmountCents,
      `sale.tenders[${index}].netAmountCents`,
    );
    const changeCents = safeCents(
      row.changeCents,
      `sale.tenders[${index}].changeCents`,
    );
    const tip = safeCents(row.tipCents, `sale.tenders[${index}].tipCents`);
    if (tenderedCents < 1)
      fail(
        "TENDER_ROW_NOT_CAPTURED",
        "PosApp omits zero-tender rows from sale.tenders.",
      );
    if (
      safeAdd(
        legacyNetCents,
        changeCents,
        `tender ${tenderId} net plus change`,
      ) !== tenderedCents
    )
      fail(
        "TENDER_MISMATCH",
        `Tender ${tenderId} does not reconcile to captured net plus change.`,
      );
    capturedGrossTenderCents = safeAdd(
      capturedGrossTenderCents,
      tenderedCents,
      "aggregate gross tender",
    );
    capturedChangeCents = safeAdd(
      capturedChangeCents,
      changeCents,
      "aggregate returned change",
    );
    if (method !== "cash" && changeCents !== 0)
      fail(
        "NONCASH_CHANGE_UNSUPPORTED",
        "Only cash tenders may include change.",
      );
    const captured: TenderRow = {
      tenderId,
      suffix,
      method,
      legacyNetCents,
      tipCents: tip,
      tenderedCents,
      changeCents,
    };
    if (tenders.has(suffix))
      fail("DUPLICATE_TENDER_ID", "Captured tender identity is duplicated.");
    tenders.set(suffix, captured);
  }

  const operationPayments: PosPaymentInput[] = [];
  let legacyPaymentNet = 0;
  let legacyTenderNet = 0;
  let translatedFoodNet = 0;
  let translatedTips = 0;
  let hasExternalPayment = false;

  for (const payment of payments.values()) {
    const tender = tenders.get(payment.suffix);
    if (!tender)
      fail(
        "TENDER_MISSING",
        `Payment ${payment.paymentId} has no captured tender row.`,
      );
    assertRowsMatch(payment, tender);
    if (payment.method === "cash") {
      if (
        payment.tenderedCents !== tender.tenderedCents ||
        payment.changeCents !== tender.changeCents
      )
        fail(
          "CASH_ALIAS_CONFLICT",
          `Payment ${payment.paymentId} disagrees with its tender row.`,
        );
    } else if (
      payment.tenderedCents !== tender.tenderedCents ||
      payment.changeCents !== tender.changeCents
    ) {
      fail(
        "NONCASH_ALIAS_CONFLICT",
        `Payment ${payment.paymentId} disagrees with its manual tender capture.`,
      );
    }
    const netCents = payment.legacyNetCents - payment.tipCents;
    if (!Number.isSafeInteger(netCents) || netCents < 0)
      fail(
        "PAYMENT_NET_INVALID",
        `Payment ${payment.paymentId} has an invalid food-net amount.`,
      );
    const operationPayment: PosPaymentInput =
      payment.method === "cash"
        ? {
            paymentId: payment.paymentId,
            method: "cash",
            netAmountCents: netCents,
            tipCents: payment.tipCents,
            tenderedCents: tender.tenderedCents,
            changeCents: tender.changeCents,
            recordMode: "manual",
            verification: "not-applicable",
          }
        : {
            paymentId: payment.paymentId,
            method: payment.method,
            netAmountCents: netCents,
            tipCents: payment.tipCents,
            tenderedCents: null,
            changeCents: null,
            recordMode: "manual",
            verification: "manual-unverified",
          };
    operationPayments.push(operationPayment);
    legacyPaymentNet = safeAdd(
      legacyPaymentNet,
      payment.legacyNetCents,
      "legacy payment net total",
    );
    translatedFoodNet = safeAdd(
      translatedFoodNet,
      netCents,
      "translated food net total",
    );
    translatedTips = safeAdd(
      translatedTips,
      payment.tipCents,
      "payment tip total",
    );
    if (payment.method !== "cash") hasExternalPayment = true;
  }

  for (const tender of tenders.values()) {
    if (payments.has(tender.suffix)) continue;
    if (
      tender.method !== "cash" ||
      tender.legacyNetCents !== 0 ||
      tender.tipCents !== 0 ||
      tender.changeCents !== tender.tenderedCents
    )
      fail(
        "UNMATCHED_TENDER_UNSUPPORTED",
        "Only an explicitly captured zero-net cash return can lack a payment row.",
      );
    // register() omits zero-net sale.payments but retains the cash tender. Use
    // that already-captured stable tender ID; do not synthesize a payment ID.
    operationPayments.push({
      paymentId: tender.tenderId,
      method: "cash",
      netAmountCents: 0,
      tipCents: 0,
      tenderedCents: tender.tenderedCents,
      changeCents: tender.changeCents,
      recordMode: "manual",
      verification: "not-applicable",
    });
  }

  for (const tender of tenders.values()) {
    legacyTenderNet = safeAdd(
      legacyTenderNet,
      tender.legacyNetCents,
      "legacy tender net total",
    );
  }
  if (operationPayments.length > MAX_ROWS)
    fail(
      "TOO_MANY_PAYMENTS",
      "Translated payment list exceeds operation-v1 limits.",
    );
  if (legacyPaymentNet !== totalCents || legacyTenderNet !== totalCents)
    fail(
      "CAPTURED_NET_MISMATCH",
      "Captured payment and tender nets do not reconcile to the all-in sale total.",
    );
  if (
    safeAdd(
      totalCents,
      capturedChangeCents,
      "all-in net plus returned change",
    ) !== capturedGrossTenderCents
  )
    fail(
      "GROSS_TENDER_MISMATCH",
      "Aggregate captured gross tender does not reconcile to sale net plus returned change.",
    );
  if (translatedFoodNet !== expectedFoodNet)
    fail(
      "FOOD_NET_MISMATCH",
      "Translated payment food net does not equal the current order due.",
    );
  if (translatedTips !== tipCents)
    fail(
      "TIP_TOTAL_MISMATCH",
      "Captured payment tips do not reconcile to the sale tip.",
    );
  const expectedExternalVerification = hasExternalPayment
    ? "manual_unverified"
    : "not_applicable";
  if (sale.externalPaymentVerification !== expectedExternalVerification)
    fail(
      "VERIFICATION_UNKNOWN",
      "Sale-level external payment verification conflicts with its captured rows.",
    );

  if (
    expectedFoodNet === 0 &&
    (totalCents !== 0 || tipCents !== 0 || operationPayments.length > 0)
  )
    fail(
      "ZERO_FOOD_DUE_UNSUPPORTED",
      "Tip-only or tendered zero-food checkouts are not supported by operation-v1.",
    );
  if (expectedFoodNet > 0 && operationPayments.length === 0)
    fail(
      "PAYMENTS_REQUIRED",
      "A positive-food checkout requires captured payment rows.",
    );

  return {
    payments: operationPayments,
    foodNetCents: translatedFoodNet,
    tipCents: translatedTips,
    totalCents,
  };
}

function assertRowsMatch(payment: PaymentRow, tender: TenderRow): void {
  if (
    payment.method !== tender.method ||
    payment.legacyNetCents !== tender.legacyNetCents ||
    payment.tipCents !== tender.tipCents
  )
    fail(
      "PAYMENT_TENDER_CONFLICT",
      `Payment ${payment.paymentId} conflicts with its tender row.`,
    );
}

function centsAliases(
  record: CaptureRecord,
  centsKey: string,
  alternateCentsKey: string,
  label: string,
  moneyKey?: string,
): number {
  const primary = safeCents(record[centsKey], `${label}.${centsKey}`);
  const alternate = safeCents(
    record[alternateCentsKey],
    `${label}.${alternateCentsKey}`,
  );
  if (primary !== alternate)
    fail("CENT_ALIAS_CONFLICT", `${label} cent aliases disagree.`);
  if (moneyKey) {
    if (!hasOwn(record, moneyKey))
      fail("CAPTURE_FIELD_MISSING", `${label}.${moneyKey} is missing.`);
    let converted: number;
    try {
      converted = moneyToCents(record[moneyKey] as number | string);
    } catch {
      fail(
        "MONEY_ALIAS_INVALID",
        `${label}.${moneyKey} is not a valid MXN amount.`,
      );
    }
    if (converted! !== primary)
      fail(
        "CENT_ALIAS_CONFLICT",
        `${label} currency and cent aliases disagree.`,
      );
  }
  return primary;
}

function centsWithMoneyAlias(
  record: CaptureRecord,
  centsKey: string,
  moneyKey: string,
  label: string,
): number {
  const cents = safeCents(record[centsKey], `${label}.${centsKey}`);
  if (!hasOwn(record, moneyKey))
    fail("CAPTURE_FIELD_MISSING", `${label}.${moneyKey} is missing.`);
  let converted: number;
  try {
    converted = moneyToCents(record[moneyKey] as number | string);
  } catch {
    fail(
      "MONEY_ALIAS_INVALID",
      `${label}.${moneyKey} is not a valid MXN amount.`,
    );
  }
  if (converted! !== cents)
    fail("CENT_ALIAS_CONFLICT", `${label} currency and cent aliases disagree.`);
  return cents;
}

function optionalCentAlias(
  record: CaptureRecord,
  keys: readonly string[],
  label: string,
): number | null {
  const present = keys.filter((key) => hasOwn(record, key));
  if (present.length === 0) return null;
  const values = present.map((key) =>
    safeCents(record[key], `${label}.${key}`),
  );
  if (values.some((value) => value !== values[0]))
    fail("CENT_ALIAS_CONFLICT", `${label} aliases disagree.`);
  return values[0]!;
}

function paymentMethod(
  value: unknown,
  label: string,
): PosPaymentInput["method"] {
  if (value === "cash" || value === "card" || value === "transfer")
    return value;
  fail("PAYMENT_METHOD_UNKNOWN", `${label} is unsupported.`);
}

function prefixedSuffix(value: string, prefix: string, label: string): string {
  if (!value.startsWith(prefix))
    fail(
      "PAYMENT_ID_SCOPE",
      `${label} is not scoped to the captured sale folio.`,
    );
  const suffix = value.slice(prefix.length);
  identifier(suffix, `${label} suffix`);
  return suffix;
}

function rows(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS)
    fail(
      "CAPTURE_ROWS_INVALID",
      `${label} must be an array of at most ${MAX_ROWS} rows.`,
    );
  return value;
}

function object(value: unknown, label: string): CaptureRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("CAPTURE_OBJECT_INVALID", `${label} must be an object.`);
  return value as CaptureRecord;
}

function safeCents(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    fail(
      "MONEY_INVALID",
      `${label} must be non-negative safe integer MXN cents.`,
    );
  return value as number;
}

function safeAdd(left: number, right: number, label: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total))
    fail("MONEY_OVERFLOW", `${label} exceeds safe integer MXN cents.`);
  return total;
}

function identifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim() !== value ||
    value.length > MAX_ID_LENGTH
  )
    fail(
      "CAPTURE_ID_INVALID",
      `${label} must be an explicit bounded identifier.`,
    );
  return value;
}

function checkOptionalCurrency(value: unknown, label: string): void {
  if (value !== undefined && value !== "MXN")
    fail("CURRENCY_UNSUPPORTED", `${label} must be MXN when present.`);
}

function checkAllowedKeys(
  record: CaptureRecord,
  allowed: readonly string[],
  label: string,
): void {
  const unsupported = Object.keys(record).find((key) => !allowed.includes(key));
  if (unsupported)
    fail(
      "CAPTURE_FIELD_UNSUPPORTED",
      `${label} contains an unsupported field.`,
    );
}

function hasOwn(record: CaptureRecord, key: string): boolean {
  return Object.hasOwn(record, key);
}

function fail(code: string, message: string): never {
  throw new PosAppPaymentBridgeError(code, message);
}
