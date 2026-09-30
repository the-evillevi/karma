/**
 * Adapt a captured catalog line to EVL-113 OrderLineSnapshot without importing
 * unmerged foundation code. All pricing/tax policy identifiers are explicit.
 */
export function toOrderLineSnapshot(capturedLine, policy) {
  if (!capturedLine || typeof capturedLine !== 'object' || Array.isArray(capturedLine)) throw new TypeError('capturedLine must be an object');
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new TypeError('order line policy must be an object');
  const lineId = requireText(policy.lineId, 'lineId');
  const catalogPriceVersionId = requireText(policy.catalogPriceVersionId, 'catalogPriceVersionId');
  if (!Number.isSafeInteger(policy.taxRateBasisPoints) || policy.taxRateBasisPoints < 0) throw new TypeError('taxRateBasisPoints must be a non-negative safe integer');
  if (policy.priceIncludesTax !== true) throw new TypeError('priceIncludesTax must be true for the EVL-113 order-line contract');
  if (capturedLine.taxSnapshot && capturedLine.taxSnapshot.rateBasisPoints !== policy.taxRateBasisPoints) {
    throw new Error('taxRateBasisPoints must match the captured tax snapshot when provided');
  }
  if (!Array.isArray(capturedLine.modifiers)) throw new TypeError('capturedLine.modifiers must be an array');
  const modifierSnapshots = capturedLine.modifiers.map((modifier) => {
    if (!modifier || typeof modifier !== 'object' || Array.isArray(modifier)) throw new TypeError('each captured modifier must be an object');
    const groupId = requireText(modifier.groupId, 'modifier groupId');
    const groupName = requireText(modifier.groupName, 'modifier groupName');
    const optionPart = modifier.optionId ?? `measure-${modifier.unit}`;
    return {
      modifierId: `${groupId}/${requireText(optionPart, 'modifier optionId or measurement unit')}`,
      nameSnapshot: modifier.optionName ? `${groupName}: ${requireText(modifier.optionName, 'modifier optionName')}` : groupName,
      priceDeltaCents: requireCents(modifier.priceEffectCents, 'modifier priceEffectCents'),
      taxRateBasisPoints: policy.taxRateBasisPoints,
      priceIncludesTax: true,
    };
  });
  const result = {
    lineId,
    productId: requireText(capturedLine.productId, 'productId'),
    productNameSnapshot: requireText(capturedLine.name, 'product name'),
    // The reviewed contract stores base price here. Modifiers stay separate and
    // are summed once by order consumers.
    unitPriceCents: requireCents(capturedLine.baseUnitPriceCents, 'baseUnitPriceCents'),
    quantity: requirePositiveInteger(capturedLine.quantity, 'quantity'),
    taxRateBasisPoints: policy.taxRateBasisPoints,
    priceIncludesTax: true,
    catalogPriceVersionId,
    modifierSnapshots,
  };
  if (capturedLine.notes) result.notesSnapshot = String(capturedLine.notes);
  const preparationMeasurements = new Map();
  for (const modifier of capturedLine.modifiers) {
    if (modifier.unit) preparationMeasurements.set(modifier.groupId, {
      modifierGroupId: requireText(modifier.groupId, 'preparation measurement groupId'),
      nameSnapshot: requireText(modifier.groupName, 'preparation measurement groupName'),
      quantity: requirePositiveInteger(modifier.quantity, `preparation measurement ${modifier.groupId} quantity`),
      unitSnapshot: requireText(modifier.unit, `preparation measurement ${modifier.groupId} unit`),
    });
  }
  // Optional extension until the shared OrderLineSnapshot contract formally
  // adopts preparation measurements. It is intentionally outside core fields.
  if (preparationMeasurements.size) result.preparationMeasurements = [...preparationMeasurements.values()];
  return deepFreeze(result);
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}
function requireCents(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer in MXN centavos`);
  return value;
}
function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer`);
  return value;
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
