/**
 * A sanitized compatibility view of the current POS local state.
 * This is not a journal command and cannot be appended to the phase-1 journal.
 */

export const POS_COMPATIBLE_SNAPSHOT_VERSION = 1 as const;
export const POS_COMPATIBLE_SNAPSHOT_KIND = "pos.compatible.snapshot" as const;

export interface PosCompatibleSnapshotInput {
  snapshotId: string;
  capturedAt: string;
  branchId: string;
  deviceId: string;
  actorId: string;
}

export interface PosCompatibleLine {
  lineId: string | null;
  lineIdEvidence: "persisted" | "not-recorded";
  productId: string | null;
  name: string | null;
  quantity: number;
  modifiers: string | null;
  modifierSelections: Array<{
    groupId: string | null;
    groupName: string | null;
    optionId: string | null;
    optionName: string | null;
    quantity: number | null;
    unit: string | null;
    priceEffectCents: number | null;
  }>;
  modifierEvidence:
    "captured" | "selection-ids-only" | "display-text-only" | "not-recorded";
  notes: string | null;
  price: {
    currency: "MXN";
    baseUnitPriceCents: number | null;
    modifierTotalCents: number | null;
    unitPriceCents: number | null;
    lineTotalCents: number | null;
    catalogPriceVersionId: null;
    evidence:
      | "captured-prototype-catalog"
      | "stored-legacy-unit"
      | "sale-line-total-only"
      | "unknown";
  };
  tax: {
    status: "captured" | "unknown";
    rateBasisPoints: number | null;
    amountCents: number | null;
    source: string | null;
  };
}

export interface PosCompatibleActorEvent {
  action: string | null;
  actorId: string | null;
  actorName: string | null;
  occurredAt: string | null;
  reason: string | null;
}

export interface PosCompatibleMoney {
  currency: "MXN";
  subtotalCents: number | null;
  discountCents: number | null;
  totalCents: number | null;
  reconciliation: "verified" | "partial" | "not-applicable";
}

export interface PosCompatibleOrder {
  folio: string | null;
  status: string | null;
  type: string | null;
  reference: string | null;
  openedAt: string | null;
  creator: { actorId: string | null; name: string | null };
  responsible: string | null;
  contact: {
    name: string | null;
    phone: string | null;
    address: string | null;
  };
  actorHistory: PosCompatibleActorEvent[];
  discount: {
    amountCents: number | null;
    reason: string | null;
    actorId: string | null;
    actorName: string | null;
  };
  items: PosCompatibleLine[];
  money: PosCompatibleMoney;
  splitLineageEvidence: "recorded" | "not-recorded";
  preparation: {
    folio: string | null;
    status: string | null;
    shared: boolean | null;
  };
  splitFrom: { folio: string; operationId: string } | null;
  splitOperations: Array<{
    operationId: string | null;
    childFolio: string | null;
    createdAt: string | null;
    selection: Array<{ lineId: string | null; quantity: number | null }>;
  }>;
  reprints: Array<{
    id: string | null;
    kind: string | null;
    occurredAt: string | null;
    reason: string | null;
    actorId: string | null;
    actorName: string | null;
  }>;
}

export interface PosCompatibleSale {
  folio: string | null;
  status: string | null;
  occurredAt: string | null;
  type: string | null;
  creator: { actorId: string | null; name: string | null };
  paidBy: { actorId: string | null; name: string | null };
  cancelledBy: {
    actorId: string | null;
    name: string | null;
    occurredAt: string | null;
  };
  cancellationReason: string | null;
  items: PosCompatibleLine[];
  money: PosCompatibleMoney & { tipCents: number | null };
  discount: {
    reason: string | null;
    actorId: string | null;
    actorName: string | null;
  };
  payments: Array<{
    paymentId: string | null;
    method: string | null;
    netAmountCents: number | null;
    tipCents: number | null;
    recordMode: string | null;
    verificationStatus: string | null;
    cashReceivedCents: number | null;
    changeCents: number | null;
  }>;
  tenders: Array<{
    tenderId: string | null;
    method: string | null;
    tenderedCents: number | null;
    netAmountCents: number | null;
    tipCents: number | null;
    changeCents: number | null;
  }>;
  compensations: Array<{
    commandId: string | null;
    kind: string | null;
    paymentId: string | null;
    amountCents: number;
    reason: string;
    actorId: string;
    actorName: string;
    occurredAt: string;
    recordMode: string | null;
    inventoryCompensation: string | null;
    allocations: Array<{
      paymentId: string | null;
      method: string | null;
      amountCents: number;
      externalVerification: string | null;
    }>;
  }>;
  splitFrom: { folio: string; operationId: string } | null;
  splitLineageEvidence: "recorded" | "not-recorded";
  reprints: PosCompatibleOrder["reprints"];
}

export interface PosCompatibleSnapshot {
  kind: typeof POS_COMPATIBLE_SNAPSHOT_KIND;
  schemaVersion: typeof POS_COMPATIBLE_SNAPSHOT_VERSION;
  snapshotId: string;
  capturedAt: string;
  branchId: string;
  deviceId: string;
  capturedByActorId: string;
  stationDraft: PosCompatibleOrder | null;
  openAccounts: PosCompatibleOrder[];
  kitchenTickets: Array<{
    folio: string | null;
    status: string | null;
    openedAt: string | null;
    creator: { actorId: string | null; name: string | null };
    actorHistory: PosCompatibleActorEvent[];
    items: PosCompatibleLine[];
    preparation: PosCompatibleOrder["preparation"];
    splitFrom: PosCompatibleOrder["splitFrom"];
    splitLineageEvidence: PosCompatibleOrder["splitLineageEvidence"];
    splitOperations: PosCompatibleOrder["splitOperations"];
    reprints: PosCompatibleOrder["reprints"];
  }>;
  sales: PosCompatibleSale[];
}

type Obj = Record<string, unknown>;

function object(value: unknown, label: string): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Obj;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function text(value: unknown, label: string, max = 500): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > max) {
    throw new TypeError(
      `${label} must be a string of at most ${max} characters`,
    );
  }
  return value;
}

function requiredText(value: unknown, label: string, max = 500): string {
  const result = text(value, label, max);
  if (!result || !result.trim()) throw new TypeError(`${label} is required`);
  return result;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new RangeError(`${label} must be a safe integer >= ${minimum}`);
  }
  return value as number;
}

function centsFromMajor(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative MXN amount`);
  }
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 1e-7) {
    throw new RangeError(`${label} must have at most two decimal places`);
  }
  return cents;
}

function cents(
  source: Obj,
  centKeys: readonly string[],
  majorKeys: readonly string[] = [],
): number | null {
  let centValue: number | null = null;
  let majorValue: number | null = null;
  for (const key of centKeys) {
    if (source[key] !== undefined && source[key] !== null) {
      centValue = integer(source[key], key);
      break;
    }
  }
  for (const key of majorKeys) {
    if (source[key] !== undefined && source[key] !== null) {
      majorValue = centsFromMajor(source[key], key);
      break;
    }
  }
  if (centValue !== null && majorValue !== null && centValue !== majorValue) {
    throw new RangeError(`${centKeys[0]} conflicts with ${majorKeys[0]}`);
  }
  return centValue ?? majorValue;
}

function timestamp(value: unknown, label: string): string | null {
  // Legacy POS rows include display strings such as "Hoy · 12:41"; keep that
  // source fact as text instead of silently fabricating an ISO timestamp.
  return text(value, label, 80);
}

function actorEvent(value: unknown): PosCompatibleActorEvent {
  const item = object(value, "actorHistory entry");
  return {
    action: text(item.action ?? item.event, "actorHistory.action", 100),
    actorId: text(item.actorId, "actorHistory.actorId", 160),
    actorName: text(item.actorName ?? item.name, "actorHistory.actorName", 160),
    occurredAt: timestamp(
      item.occurredAt ?? item.at ?? item.time,
      "actorHistory.occurredAt",
    ),
    reason: text(item.reason, "actorHistory.reason", 250),
  };
}

function actorHistory(value: unknown): PosCompatibleActorEvent[] {
  if (value === undefined || value === null) return [];
  return list(value, "actorHistory").map(actorEvent);
}

function modifierSelections(
  captured: Obj | null,
  item: Obj,
): Pick<PosCompatibleLine, "modifierSelections" | "modifierEvidence"> {
  if (
    captured &&
    captured.modifiers !== undefined &&
    !Array.isArray(captured.modifiers)
  ) {
    throw new TypeError("captured modifiers must be an array");
  }
  if (Array.isArray(captured?.modifiers)) {
    return {
      modifierSelections: captured.modifiers.map((raw, index) => {
        const modifier = object(raw, `captured modifiers[${index}]`);
        return {
          groupId: text(modifier.groupId, "modifier.groupId", 160),
          groupName: text(modifier.groupName, "modifier.groupName", 160),
          optionId: text(modifier.optionId, "modifier.optionId", 160),
          optionName: text(modifier.optionName, "modifier.optionName", 160),
          quantity:
            modifier.quantity === undefined || modifier.quantity === null
              ? null
              : integer(modifier.quantity, "modifier.quantity", 1),
          unit: text(modifier.unit, "modifier.unit", 40),
          priceEffectCents: cents(modifier, ["priceEffectCents"]),
        };
      }),
      modifierEvidence: "captured",
    };
  }
  if (item.mods && typeof item.mods === "object" && !Array.isArray(item.mods)) {
    const modifierSelections: PosCompatibleLine["modifierSelections"] = [];
    for (const [groupId, rawOptions] of Object.entries(item.mods)) {
      if (groupId.length > 160 || !Array.isArray(rawOptions)) {
        throw new TypeError("legacy modifier selection is malformed");
      }
      for (const rawOptionId of rawOptions) {
        modifierSelections.push({
          groupId,
          groupName: null,
          optionId: requiredText(rawOptionId, "modifier optionId", 160),
          optionName: null,
          quantity: null,
          unit: null,
          priceEffectCents: null,
        });
      }
    }
    return { modifierSelections, modifierEvidence: "selection-ids-only" };
  }
  return {
    modifierSelections: [],
    modifierEvidence:
      item.modsText == null && item.mods == null
        ? "not-recorded"
        : "display-text-only",
  };
}

function line(value: unknown, index: number, sale = false): PosCompatibleLine {
  const item = object(value, `items[${index}]`);
  const quantity = integer(
    item.qty ?? item.quantity,
    `items[${index}].quantity`,
    1,
  );
  const captured =
    item.capturedSnapshot == null
      ? null
      : object(item.capturedSnapshot, `items[${index}].capturedSnapshot`);
  const productId = text(
    captured?.productId ?? item.prodId ?? item.productId,
    "productId",
    160,
  );
  const name = text(
    captured?.name ?? item.productNameSnapshot ?? item.name,
    "productName",
    200,
  );
  const lineId = text(item.lineId ?? item.id, "lineId", 160);
  let baseUnitPriceCents: number | null = null;
  let modifierTotalCents: number | null = null;
  let unitPriceCents: number | null = null;
  let lineTotalCents: number | null = null;
  let evidence: PosCompatibleLine["price"]["evidence"] = "unknown";

  if (captured) {
    baseUnitPriceCents = integer(
      captured.baseUnitPriceCents,
      "baseUnitPriceCents",
    );
    modifierTotalCents = integer(
      captured.modifiersTotalCents,
      "modifiersTotalCents",
    );
    unitPriceCents = integer(captured.unitPriceCents, "unitPriceCents");
    if (baseUnitPriceCents + modifierTotalCents !== unitPriceCents) {
      throw new RangeError(
        "captured unit price does not reconcile to base plus modifiers",
      );
    }
    lineTotalCents = cents(captured, ["lineTotalCents"]);
    if (lineTotalCents === null) lineTotalCents = unitPriceCents * quantity;
    integer(lineTotalCents, "lineTotalCents");
    if (
      !Number.isSafeInteger(unitPriceCents * quantity) ||
      lineTotalCents !== unitPriceCents * quantity
    ) {
      throw new RangeError(
        "captured line total does not reconcile to unit price and quantity",
      );
    }
    evidence = "captured-prototype-catalog";
  } else {
    const storedUnit = cents(item, ["unitPriceCents"], ["unit"]);
    const saleTotal = cents(item, ["lineTotalCents", "totalCents"], ["total"]);
    if (storedUnit !== null) {
      unitPriceCents = storedUnit;
      lineTotalCents = saleTotal ?? storedUnit * quantity;
      if (
        !Number.isSafeInteger(storedUnit * quantity) ||
        lineTotalCents !== storedUnit * quantity
      ) {
        throw new RangeError(
          "stored line total does not reconcile to unit price and quantity",
        );
      }
      evidence = "stored-legacy-unit";
    } else if (sale && saleTotal !== null) {
      lineTotalCents = saleTotal;
      evidence = "sale-line-total-only";
    } else if (saleTotal !== null) {
      lineTotalCents = saleTotal;
      evidence = "sale-line-total-only";
    }
  }

  const tax =
    captured?.taxSnapshot == null
      ? null
      : object(captured.taxSnapshot, `items[${index}].taxSnapshot`);
  const rateBasisPoints = tax
    ? integer(tax.rateBasisPoints, "taxSnapshot.rateBasisPoints")
    : null;
  const taxAmountCents = tax
    ? integer(tax.amountCents, "taxSnapshot.amountCents")
    : null;
  if (tax && tax.currency !== "MXN")
    throw new TypeError("taxSnapshot.currency must be MXN");
  const modifierData = modifierSelections(captured, item);
  return {
    lineId,
    lineIdEvidence: lineId ? "persisted" : "not-recorded",
    productId,
    name,
    quantity,
    modifiers: text(
      item.modsText ?? (typeof item.mods === "string" ? item.mods : null),
      "modifiers",
      500,
    ),
    ...modifierData,
    notes: text(captured?.notes ?? item.notes, "notes", 500),
    price: {
      currency: "MXN",
      baseUnitPriceCents,
      modifierTotalCents,
      unitPriceCents,
      lineTotalCents,
      catalogPriceVersionId: null,
      evidence,
    },
    tax: {
      status: tax ? "captured" : "unknown",
      rateBasisPoints,
      amountCents: taxAmountCents,
      source: tax ? requiredText(tax.source, "taxSnapshot.source", 120) : null,
    },
  };
}

function splitFrom(value: unknown): PosCompatibleOrder["splitFrom"] {
  if (value === undefined || value === null) return null;
  const input = object(value, "splitFrom");
  return {
    folio: requiredText(input.folio, "splitFrom.folio", 100),
    operationId: requiredText(input.operationId, "splitFrom.operationId", 180),
  };
}

function splitOperations(
  value: unknown,
): PosCompatibleOrder["splitOperations"] {
  if (value === undefined || value === null) return [];
  return list(value, "splitOperations").map((raw) => {
    const input = object(raw, "splitOperations entry");
    const selection =
      input.selection == null
        ? []
        : list(input.selection, "splitOperations.selection").map(
            (rawSelection) => {
              const selected = object(rawSelection, "split selection");
              return {
                lineId: text(selected.lineId, "split selection lineId", 160),
                quantity:
                  selected.quantity === undefined || selected.quantity === null
                    ? null
                    : integer(selected.quantity, "split selection quantity", 1),
              };
            },
          );
    return {
      operationId: text(input.operationId, "split operationId", 180),
      childFolio: text(input.childFolio, "split childFolio", 100),
      createdAt: timestamp(input.createdAt, "split createdAt"),
      selection,
    };
  });
}

function reprints(value: unknown): PosCompatibleOrder["reprints"] {
  if (value === undefined || value === null) return [];
  return list(value, "reprints").map((raw) => {
    const item = object(raw, "reprint entry");
    return {
      id: text(item.id, "reprint.id", 180),
      kind: text(item.kind, "reprint.kind", 80),
      occurredAt: timestamp(item.occurredAt, "reprint.occurredAt"),
      reason: text(item.reason, "reprint.reason", 250),
      actorId: text(item.actorId, "reprint.actorId", 160),
      actorName: text(item.actorName, "reprint.actorName", 160),
    };
  });
}

function order(value: unknown): PosCompatibleOrder {
  const input = object(value, "POS order");
  const items = list(input.items ?? [], "order.items").map((item, index) =>
    line(item, index),
  );
  const subtotalFromLines = items.every(
    (item) => item.price.lineTotalCents !== null,
  )
    ? items.reduce(
        (sum, item) => sum + (item.price.lineTotalCents as number),
        0,
      )
    : null;
  if (subtotalFromLines !== null && !Number.isSafeInteger(subtotalFromLines)) {
    throw new RangeError("order subtotal exceeds safe integer cents");
  }
  const storedSubtotalCents = cents(input, ["subtotalCents"], ["subtotal"]);
  if (
    storedSubtotalCents !== null &&
    subtotalFromLines !== null &&
    storedSubtotalCents !== subtotalFromLines
  ) {
    throw new RangeError(
      "order subtotal does not reconcile to its captured lines",
    );
  }
  const subtotalCents = storedSubtotalCents ?? subtotalFromLines;
  const discountCents = cents(input, ["discountCents"], ["discount"]);
  const explicitTotal = cents(input, ["totalCents"], ["total"]);
  const calculatedTotal =
    subtotalCents !== null && discountCents !== null
      ? Math.max(0, subtotalCents - discountCents)
      : null;
  if (
    subtotalCents !== null &&
    discountCents !== null &&
    discountCents > subtotalCents
  ) {
    throw new RangeError("order discount exceeds subtotal");
  }
  if (
    explicitTotal !== null &&
    calculatedTotal !== null &&
    explicitTotal !== calculatedTotal
  ) {
    throw new RangeError(
      "order total does not reconcile to subtotal and discount",
    );
  }
  const discountActor = {
    actorId: text(input.discountActorId, "discountActorId", 160),
    actorName: text(input.discountActorName, "discountActorName", 160),
  };
  const prepFolio = text(input.preparationFolio, "preparationFolio", 100);
  const splitOps = splitOperations(input.splitOperations);
  return {
    folio: text(input.folio, "folio", 100),
    status: text(input.status ?? input.sync, "order.status", 80),
    type: text(input.type, "order.type", 80),
    reference: text(input.reference ?? input.ref, "order.reference", 180),
    openedAt: timestamp(input.time ?? input.createdTime, "order.time"),
    creator: {
      actorId: text(input.actorId, "order.actorId", 160),
      name: text(
        input.actorName ?? input.user ?? input.creo,
        "order.actorName",
        160,
      ),
    },
    responsible: text(input.responsible, "order.responsible", 160),
    contact: {
      name: text(input.name, "contact.name", 200),
      phone: text(input.phone, "contact.phone", 80),
      address: text(input.address, "contact.address", 300),
    },
    actorHistory: actorHistory(input.actorHistory),
    discount: {
      amountCents: discountCents,
      reason: text(input.discountReason, "discountReason", 250),
      actorId: discountActor.actorId,
      actorName: discountActor.actorName,
    },
    items,
    money: {
      currency: "MXN",
      subtotalCents,
      discountCents,
      totalCents: explicitTotal ?? calculatedTotal,
      reconciliation:
        subtotalCents !== null &&
        discountCents !== null &&
        (explicitTotal !== null || calculatedTotal !== null)
          ? "verified"
          : "partial",
    },
    splitLineageEvidence: Object.prototype.hasOwnProperty.call(
      input,
      "splitFrom",
    )
      ? "recorded"
      : "not-recorded",
    preparation: {
      folio: prepFolio,
      status: text(input.prep, "order.prep", 80),
      shared:
        typeof input.sharedPreparation === "boolean"
          ? input.sharedPreparation
          : null,
    },
    splitFrom: splitFrom(input.splitFrom),
    splitOperations: splitOps,
    reprints: reprints(input.reprints),
  };
}

function payment(
  value: unknown,
  index: number,
): PosCompatibleSale["payments"][number] {
  const input = object(value, `payments[${index}]`);
  const net = cents(input, ["netAmountCents", "amountCents"], ["amount"]);
  const cashReceived = cents(input, ["cashReceivedCents"]);
  const change = cents(input, ["changeCents"]);
  if (
    cashReceived !== null &&
    net !== null &&
    change !== null &&
    cashReceived - net !== change
  ) {
    throw new RangeError(
      `payments[${index}] cash received does not reconcile to net and change`,
    );
  }
  return {
    paymentId: text(input.paymentId, "payment.paymentId", 180),
    method: text(input.method, "payment.method", 80),
    netAmountCents: net,
    tipCents: cents(input, ["tipCents"]),
    recordMode: text(input.recordMode, "payment.recordMode", 80),
    verificationStatus: text(
      input.verificationStatus,
      "payment.verificationStatus",
      80,
    ),
    cashReceivedCents: cashReceived,
    changeCents: change,
  };
}

function tender(
  value: unknown,
  index: number,
): PosCompatibleSale["tenders"][number] {
  const input = object(value, `tenders[${index}]`);
  const tendered = cents(input, ["tenderedCents", "cashReceivedCents"]);
  const net = cents(input, ["netAmountCents", "amountCents"], ["amount"]);
  const change = cents(input, ["changeCents"]);
  if (
    tendered !== null &&
    net !== null &&
    change !== null &&
    tendered - net !== change
  ) {
    throw new RangeError(
      `tenders[${index}] does not reconcile to net plus change`,
    );
  }
  return {
    tenderId: text(input.tenderId, "tender.tenderId", 180),
    method: text(input.method, "tender.method", 80),
    tenderedCents: tendered,
    netAmountCents: net,
    tipCents: cents(input, ["tipCents"]),
    changeCents: change,
  };
}

function compensation(
  value: unknown,
  index: number,
): PosCompatibleSale["compensations"][number] {
  const input = object(value, `compensations[${index}]`);
  const allocations = list(
    input.allocations ?? [],
    "compensation.allocations",
  ).map((raw, allocationIndex) => {
    const allocation = object(raw, `allocations[${allocationIndex}]`);
    return {
      paymentId: text(allocation.paymentId, "allocation.paymentId", 180),
      method: text(allocation.method, "allocation.method", 80),
      amountCents: integer(allocation.amountCents, "allocation.amountCents"),
      externalVerification: text(
        allocation.externalVerification,
        "allocation.externalVerification",
        100,
      ),
    };
  });
  const amountCents = integer(input.amountCents, "compensation.amountCents");
  if (
    allocations.reduce((sum, entry) => sum + entry.amountCents, 0) !==
    amountCents
  ) {
    throw new RangeError(
      "compensation allocations do not reconcile to its amount",
    );
  }
  return {
    commandId: text(input.commandId, "compensation.commandId", 180),
    kind: text(input.kind, "compensation.kind", 80),
    paymentId: text(input.paymentId, "compensation.paymentId", 180),
    amountCents,
    reason: requiredText(input.reason, "compensation.reason", 250),
    actorId: requiredText(input.actorId, "compensation.actorId", 160),
    actorName: requiredText(input.actorName, "compensation.actorName", 160),
    occurredAt: requiredText(input.occurredAt, "compensation.occurredAt", 80),
    recordMode: text(input.recordMode, "compensation.recordMode", 80),
    inventoryCompensation: text(
      input.inventoryCompensation,
      "compensation.inventoryCompensation",
      100,
    ),
    allocations,
  };
}

function sale(value: unknown): PosCompatibleSale {
  const input = object(value, "POS sale");
  const items = list(input.items ?? [], "sale.items").map((item, index) =>
    line(item, index, true),
  );
  const payments = list(input.payments ?? [], "sale.payments").map(payment);
  const tenders = list(input.tenders ?? [], "sale.tenders").map(tender);
  const compensations = list(
    input.compensations ?? [],
    "sale.compensations",
  ).map(compensation);
  const totalCents = cents(input, ["totalCents"], ["total"]);
  const lineSubtotalCents = items.every(
    (item) => item.price.lineTotalCents !== null,
  )
    ? items.reduce(
        (sum, item) => sum + (item.price.lineTotalCents as number),
        0,
      )
    : null;
  if (lineSubtotalCents !== null && !Number.isSafeInteger(lineSubtotalCents)) {
    throw new RangeError("sale subtotal exceeds safe integer cents");
  }
  const storedSubtotalCents = cents(input, ["subtotalCents"], ["subtotal"]);
  if (
    storedSubtotalCents !== null &&
    lineSubtotalCents !== null &&
    storedSubtotalCents !== lineSubtotalCents
  ) {
    throw new RangeError(
      "sale subtotal does not reconcile to its captured lines",
    );
  }
  const subtotalCents = storedSubtotalCents ?? lineSubtotalCents;
  const discountCents = cents(input, ["discountCents"], ["discount"]);
  const tipCents = cents(input, ["tipCents"], ["tip"]);
  if (
    subtotalCents !== null &&
    discountCents !== null &&
    discountCents > subtotalCents
  ) {
    throw new RangeError("sale discount exceeds subtotal");
  }
  if (
    subtotalCents !== null &&
    discountCents !== null &&
    totalCents !== null &&
    tipCents !== null &&
    subtotalCents - discountCents + tipCents !== totalCents
  ) {
    throw new RangeError(
      "sale total does not reconcile to subtotal, discount and tip",
    );
  }
  const status = text(input.status, "sale.status", 80);
  for (const [kind, rows] of [
    ["payments", payments],
    ["tenders", tenders],
  ] as const) {
    const netAmounts = rows.map((row) => row.netAmountCents);
    if (
      status === "completada" &&
      totalCents !== null &&
      netAmounts.length > 0 &&
      netAmounts.every((amount) => amount !== null)
    ) {
      if (
        netAmounts.reduce((sum, amount) => sum + (amount as number), 0) !==
        totalCents
      ) {
        throw new RangeError(`sale ${kind} do not reconcile to total`);
      }
    }
  }
  if (totalCents !== null && compensations.length) {
    const compensatedCents = compensations.reduce(
      (sum, event) => sum + event.amountCents,
      0,
    );
    if (
      !Number.isSafeInteger(compensatedCents) ||
      compensatedCents > totalCents
    ) {
      throw new RangeError("sale compensation exceeds the captured sale total");
    }
    const paymentTotals = new Map(
      payments.flatMap((entry) =>
        entry.paymentId && entry.netAmountCents !== null
          ? [[entry.paymentId, entry.netAmountCents] as const]
          : [],
      ),
    );
    const allocationsByPayment = new Map<string, number>();
    for (const event of compensations) {
      for (const allocation of event.allocations) {
        const paymentId = allocation.paymentId ?? event.paymentId;
        if (!paymentId || !paymentTotals.has(paymentId)) continue;
        const prior = allocationsByPayment.get(paymentId) ?? 0;
        const allocated = prior + allocation.amountCents;
        if (
          !Number.isSafeInteger(allocated) ||
          allocated > paymentTotals.get(paymentId)!
        ) {
          throw new RangeError(
            "sale compensation exceeds its captured payment",
          );
        }
        allocationsByPayment.set(paymentId, allocated);
      }
    }
  }
  return {
    folio: text(input.folio, "sale.folio", 100),
    status,
    occurredAt: timestamp(input.occurredAt ?? input.fecha, "sale.occurredAt"),
    type: text(input.tipo ?? input.type, "sale.type", 100),
    creator: {
      actorId: text(input.actorId, "sale.actorId", 160),
      name: text(input.creo ?? input.actorName, "sale.creator", 160),
    },
    paidBy: {
      actorId: text(input.paidByActorId, "sale.paidByActorId", 160),
      name: text(
        input.paidByActorName ?? input.cobro,
        "sale.paidByActorName",
        160,
      ),
    },
    cancelledBy: {
      actorId: text(
        input.cancelledByActorId ?? input.cancelledById,
        "sale.cancelledByActorId",
        160,
      ),
      name: text(
        input.cancelledByActorName ?? input.cancelledBy,
        "sale.cancelledBy",
        160,
      ),
      occurredAt: timestamp(input.cancelledAt, "sale.cancelledAt"),
    },
    cancellationReason: text(
      input.cancellationReason ?? input.motivo,
      "sale.cancellationReason",
      250,
    ),
    items,
    money: {
      currency: "MXN",
      subtotalCents,
      discountCents,
      totalCents,
      tipCents,
      reconciliation:
        subtotalCents !== null &&
        discountCents !== null &&
        tipCents !== null &&
        totalCents !== null
          ? "verified"
          : totalCents !== null
            ? "partial"
            : "not-applicable",
    },
    discount: {
      reason: text(input.discountReason, "sale.discountReason", 250),
      actorId: text(input.discountActorId, "sale.discountActorId", 160),
      actorName: text(input.discountActorName, "sale.discountActorName", 160),
    },
    payments,
    tenders,
    compensations,
    splitFrom: splitFrom(input.splitFrom),
    splitLineageEvidence: Object.prototype.hasOwnProperty.call(
      input,
      "splitFrom",
    )
      ? "recorded"
      : "not-recorded",
    reprints: reprints(input.reprints),
  };
}

function validateInput(
  input: PosCompatibleSnapshotInput,
): PosCompatibleSnapshotInput {
  const snapshotId = requiredText(input.snapshotId, "snapshotId", 180);
  const capturedAt = requiredText(input.capturedAt, "capturedAt", 80);
  if (Number.isNaN(Date.parse(capturedAt)))
    throw new TypeError("capturedAt must be a parseable timestamp");
  return {
    snapshotId,
    capturedAt,
    branchId: requiredText(input.branchId, "branchId", 160),
    deviceId: requiredText(input.deviceId, "deviceId", 160),
    actorId: requiredText(input.actorId, "actorId", 160),
  };
}

/** Builds a versioned, allowlisted snapshot from a persisted POS state object. */
export function adaptPosStateToCompatibleSnapshot(
  stateValue: unknown,
  metadata: PosCompatibleSnapshotInput,
): PosCompatibleSnapshot {
  const state = object(stateValue, "POS state");
  const scope = validateInput(metadata);
  const stationDraft = state.order == null ? null : order(state.order);
  const openAccounts = list(state.open ?? [], "POS open accounts").map(order);
  const kitchenTickets = list(
    state.kitchenTickets ?? [],
    "POS kitchen tickets",
  ).map((raw) => {
    const input = object(raw, "kitchen ticket");
    const compatible = order(input);
    return {
      folio: compatible.folio,
      status: text(input.status ?? input.prep, "ticket.status", 80),
      openedAt: compatible.openedAt,
      creator: compatible.creator,
      actorHistory: compatible.actorHistory,
      items: compatible.items,
      preparation: compatible.preparation,
      splitFrom: compatible.splitFrom,
      splitLineageEvidence: compatible.splitLineageEvidence,
      splitOperations: compatible.splitOperations,
      reprints: compatible.reprints,
    };
  });
  const sales = list(state.sales ?? [], "POS sales").map(sale);
  return {
    kind: POS_COMPATIBLE_SNAPSHOT_KIND,
    schemaVersion: POS_COMPATIBLE_SNAPSHOT_VERSION,
    snapshotId: scope.snapshotId,
    capturedAt: scope.capturedAt,
    branchId: scope.branchId,
    deviceId: scope.deviceId,
    capturedByActorId: scope.actorId,
    stationDraft,
    openAccounts,
    kitchenTickets,
    sales,
  };
}
