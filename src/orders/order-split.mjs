import { moneyToCents } from '../domain/payment-tender.js';

function owns(record, key) {
  return !!record && Object.prototype.hasOwnProperty.call(record, key);
}

export function splitLineId(line, index) {
  return typeof line?.lineId === 'string' && line.lineId.length > 0
    ? line.lineId
    : `legacy-line-${index}`;
}

function checkedUnitCents(line) {
  if (owns(line?.capturedSnapshot, 'unitPriceCents')) {
    const cents = line.capturedSnapshot.unitPriceCents;
    if (!Number.isSafeInteger(cents) || cents < 0) throw new TypeError('captured unit price must be a non-negative safe integer in centavos');
    return cents;
  }
  return moneyToCents(line?.unit);
}

function roundProductRatio(value, multiplier, denominator) {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(multiplier) || multiplier < 0 || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError('split ratio must use non-negative safe integer centavos');
  }
  const top = BigInt(value) * BigInt(multiplier);
  const bottom = BigInt(denominator);
  const whole = top / bottom;
  const remainder = top % bottom;
  const rounded = whole + (remainder * 2n >= bottom ? 1n : 0n);
  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) throw new RangeError('split allocation exceeds safe integer centavos');
  return result;
}

function splitTaxSnapshot(snapshot, selectedQty, quantity) {
  if (snapshot == null) return { source: snapshot, child: snapshot };
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError('tax snapshot must be a record');
  const amountCents = snapshot.amountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new TypeError('tax snapshot amount must be non-negative safe integer centavos');
  const childCents = roundProductRatio(amountCents, selectedQty, quantity);
  const sourceCents = amountCents - childCents;
  return {
    source: { ...snapshot, amountCents: sourceCents },
    child: { ...snapshot, amountCents: childCents },
  };
}

function buildLine(line, lineId, quantity, unitPriceCents, capturedTaxSnapshot, lineTaxSnapshot) {
  const result = { ...line, lineId, qty: quantity };
  if (line.capturedSnapshot && typeof line.capturedSnapshot === 'object' && !Array.isArray(line.capturedSnapshot)) {
    const captured = line.capturedSnapshot;
    const lineTotalCents = unitPriceCents * quantity;
    if (!Number.isSafeInteger(lineTotalCents)) throw new RangeError('split line total exceeds safe integer centavos');
    result.capturedSnapshot = {
      ...captured,
      quantity,
      lineTotalCents,
      ...(owns(captured, 'taxSnapshot') ? { taxSnapshot: capturedTaxSnapshot } : {}),
    };
  }
  if (owns(line, 'taxSnapshot')) result.taxSnapshot = lineTaxSnapshot;
  return result;
}

function normalizeSelection(selection) {
  let entries;
  if (selection instanceof Map) entries = [...selection.entries()].map(([lineId, quantity]) => ({ lineId, quantity }));
  else if (Array.isArray(selection)) entries = selection.map(entry => ({ lineId: entry?.lineId, quantity: entry?.quantity }));
  else throw new TypeError('split selection must be a Map or an array of line selections');
  const seen = new Set();
  for (const entry of entries) {
    if (typeof entry.lineId !== 'string' || entry.lineId.length === 0) throw new TypeError('split selection needs a non-empty line id');
    if (seen.has(entry.lineId)) throw new TypeError('split selection contains a duplicate line id');
    if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 1) throw new TypeError('split quantities must be positive safe integers');
    seen.add(entry.lineId);
  }
  return entries;
}

/** Propose half of the account's individual units for the new account. */
export function suggestSplitSelection(items) {
  if (!Array.isArray(items)) throw new TypeError('split items must be an array');
  let totalQuantity = 0;
  const identities = items.map((line, index) => {
    if (!Number.isSafeInteger(line?.qty) || line.qty < 1) throw new TypeError('split item quantities must be positive safe integers');
    totalQuantity += line.qty;
    if (!Number.isSafeInteger(totalQuantity)) throw new RangeError('split item quantity total exceeds the safe integer range');
    return splitLineId(line, index);
  });
  if (totalQuantity < 2) return new Map();
  let remaining = Math.floor(totalQuantity / 2) + totalQuantity % 2;
  const selection = new Map();
  for (let index = items.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const quantity = Math.min(items[index].qty, remaining);
    selection.set(identities[index], quantity);
    remaining -= quantity;
  }
  return selection;
}

/**
 * Plan a split without mutating the source. Selection is expressed as child
 * quantities by line id, using a Map or array so untrusted ids are never used
 * as object keys. Any order-level discount is rounded half-up for the child;
 * the source receives the exact remainder so both accounts conserve cents.
 */
export function planOrderSplit(order, selection) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) throw new TypeError('split order must be a record');
  if (!Array.isArray(order.items) || order.items.length === 0) throw new TypeError('split order must include captured items');
  const selected = normalizeSelection(selection);
  if (selected.length === 0) throw new TypeError('split must allocate at least one unit to the new account');

  const selectionById = new Map(selected.map(entry => [entry.lineId, entry.quantity]));
  const seenIds = new Set();
  let fullSubtotalCents = 0;
  let childSubtotalCents = 0;
  const sourceItems = [];
  const childItems = [];
  const normalizedSelection = [];

  order.items.forEach((line, index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) throw new TypeError('each split item must be a record');
    if (!Number.isSafeInteger(line.qty) || line.qty < 1) throw new TypeError('split item quantities must be positive safe integers');
    const lineId = splitLineId(line, index);
    if (seenIds.has(lineId)) throw new TypeError('split order contains duplicate line ids');
    seenIds.add(lineId);
    const selectedQty = selectionById.get(lineId) || 0;
    if (selectedQty > line.qty) throw new RangeError('split quantity cannot exceed the captured line quantity');
    const unitPriceCents = checkedUnitCents(line);
    const fullLineCents = unitPriceCents * line.qty;
    const childLineCents = unitPriceCents * selectedQty;
    if (!Number.isSafeInteger(fullLineCents) || !Number.isSafeInteger(childLineCents)) throw new RangeError('split line total exceeds safe integer centavos');
    fullSubtotalCents += fullLineCents;
    childSubtotalCents += childLineCents;
    if (!Number.isSafeInteger(fullSubtotalCents) || !Number.isSafeInteger(childSubtotalCents)) throw new RangeError('split order total exceeds safe integer centavos');

    const remainingQty = line.qty - selectedQty;
    if (line.capturedSnapshot && owns(line.capturedSnapshot, 'quantity') && line.capturedSnapshot.quantity !== line.qty) {
      throw new TypeError('captured quantity does not match the order line quantity');
    }
    if (line.capturedSnapshot && owns(line.capturedSnapshot, 'lineTotalCents') && line.capturedSnapshot.lineTotalCents !== fullLineCents) {
      throw new TypeError('captured line total does not match the order line price and quantity');
    }
    const capturedTax = splitTaxSnapshot(line.capturedSnapshot?.taxSnapshot, selectedQty, line.qty);
    const lineTax = splitTaxSnapshot(line.taxSnapshot, selectedQty, line.qty);
    if (remainingQty > 0) sourceItems.push(buildLine(line, lineId, remainingQty, unitPriceCents, capturedTax.source, lineTax.source));
    if (selectedQty > 0) childItems.push(buildLine(line, lineId, selectedQty, unitPriceCents, capturedTax.child, lineTax.child));
    if (selectedQty > 0) normalizedSelection.push({ lineId, quantity: selectedQty });
    selectionById.delete(lineId);
  });

  if (selectionById.size) throw new TypeError('split selection contains an unknown line id');
  if (sourceItems.length === 0 || childItems.length === 0) throw new TypeError('each account must retain at least one unit');
  const discountCents = Math.min(moneyToCents(order.discount || 0), fullSubtotalCents);
  const childDiscountCents = fullSubtotalCents === 0 ? 0 : Math.min(discountCents, roundProductRatio(discountCents, childSubtotalCents, fullSubtotalCents));
  const sourceDiscountCents = discountCents - childDiscountCents;
  const sourceSubtotalCents = fullSubtotalCents - childSubtotalCents;
  const childTotalCents = childSubtotalCents - childDiscountCents;
  const sourceTotalCents = sourceSubtotalCents - sourceDiscountCents;
  const combinedTotalCents = fullSubtotalCents - discountCents;
  for (const total of [sourceDiscountCents, childDiscountCents, sourceTotalCents, childTotalCents, combinedTotalCents]) {
    if (!Number.isSafeInteger(total) || total < 0) throw new RangeError('split allocation exceeds safe integer centavos');
  }
  return {
    sourceItems,
    childItems,
    selection: normalizedSelection,
    sourceSubtotalCents,
    childSubtotalCents,
    combinedSubtotalCents: fullSubtotalCents,
    sourceDiscountCents,
    childDiscountCents,
    combinedDiscountCents: discountCents,
    sourceTotalCents,
    childTotalCents,
    combinedTotalCents,
  };
}
