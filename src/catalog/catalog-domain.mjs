const CATALOG_SCHEMA = 'karma.catalog/v1';
const CURRENCY = 'MXN';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Return structural errors and readiness blockers without mutating the catalog. */
export function validateCatalog(catalog) {
  const errors = [];
  const requireString = (value, label) => {
    if (typeof value !== 'string' || value.trim().length === 0) errors.push(`${label} must be a non-blank string`);
  };
  const requireArray = (value, label) => {
    if (!Array.isArray(value)) {
      errors.push(`${label} must be an array`);
      return [];
    }
    return value;
  };
  const requireSafeInteger = (value, label, { min = 0 } = {}) => {
    if (!Number.isSafeInteger(value) || value < min) errors.push(`${label} must be a safe integer >= ${min}`);
  };
  const checkSource = (source, label) => {
    if (!isRecord(source)) {
      errors.push(`${label} source metadata is required`);
      return;
    }
    requireString(source.kind, `${label} source.kind`);
    requireString(source.path, `${label} source.path`);
  };
  const checkUnique = (records, label, { names = false } = {}) => {
    const seen = new Set();
    const validRecords = requireArray(records, label).filter((record, index) => {
      if (!isRecord(record)) {
        errors.push(`${label}[${index}] must be an object`);
        return false;
      }
      return true;
    });
    for (const record of validRecords) {
      if (typeof record.id !== 'string' || record.id.trim().length === 0) errors.push(`${label} has a missing or invalid id`);
      else if (seen.has(record.id)) errors.push(`${label} id is duplicated: ${record.id}`);
      seen.add(record.id);
      if (names) requireString(record.name, `${label} ${record.id || '(missing id)'} name`);
    }
    return validRecords;
  };

  if (!isRecord(catalog)) return { errors: [`catalog must be an object with schema ${CATALOG_SCHEMA}`], blockers: [] };
  if (catalog.schema !== CATALOG_SCHEMA) errors.push(`schema must be ${CATALOG_SCHEMA}`);
  requireString(catalog.catalogId, 'catalogId');
  requireSafeInteger(catalog.revision, 'revision', { min: 1 });
  if (catalog.currency !== CURRENCY) errors.push(`currency must be ${CURRENCY}`);
  requireString(catalog.sourceStatus, 'sourceStatus');
  if (!isRecord(catalog.importGate)) {
    errors.push('importGate metadata is required');
  } else {
    if (typeof catalog.importGate.readyForValidatedBusinessUse !== 'boolean') errors.push('importGate.readyForValidatedBusinessUse must be boolean');
    for (const [index, blocker] of requireArray(catalog.importGate.blockers, 'importGate.blockers').entries()) {
      requireString(blocker, `importGate.blockers[${index}]`);
    }
  }
  for (const [index, source] of requireArray(catalog.sources, 'sources').entries()) {
    if (!isRecord(source)) {
      errors.push(`sources[${index}] must be an object`);
      continue;
    }
    requireString(source.id, `sources[${index}].id`);
    requireString(source.status, `sources[${index}].status`);
  }

  const categories = checkUnique(catalog.categories, 'categories', { names: true });
  const products = checkUnique(catalog.products, 'products', { names: true });
  const modifierGroups = checkUnique(catalog.modifierGroups, 'modifierGroups', { names: true });
  const categoryIds = new Set(categories.filter((item) => typeof item.id === 'string').map((item) => item.id));
  const groups = new Map(modifierGroups.filter((item) => typeof item.id === 'string').map((item) => [item.id, item]));

  for (const category of categories) {
    requireSafeInteger(category.sortOrder, `category ${category.id} sortOrder`);
    if (typeof category.active !== 'boolean') errors.push(`category ${category.id} active must be boolean`);
    checkSource(category.source, `category ${category.id}`);
  }

  for (const group of modifierGroups) {
    const label = `modifier group ${group.id || '(missing id)'}`;
    requireSafeInteger(group.sortOrder, `${label} sortOrder`);
    checkSource(group.source, label);
    const options = checkUnique(group.options, `${label} options`, { names: true });
    const selection = isRecord(group.selection) ? group.selection : {};
    if (!isRecord(group.selection)) errors.push(`${label} selection metadata is required`);
    const minValid = Number.isSafeInteger(selection.min) && selection.min >= 0;
    const maxValid = Number.isSafeInteger(selection.max) && selection.max >= 0;
    if (!minValid || !maxValid || (minValid && maxValid && selection.max < selection.min)) errors.push(`modifier group ${group.id} has invalid selection limits`);
    if (minValid && selection.min > options.length) errors.push(`${label} min exceeds its option count`);
    if (maxValid && selection.max > options.length) errors.push(`${label} max exceeds its option count`);
    if (typeof selection.required !== 'boolean') errors.push(`${label} required must be boolean`);
    else if (minValid && selection.required !== (selection.min > 0)) errors.push(`${label} required must match min`);
    if (typeof selection.multiple !== 'boolean') errors.push(`${label} multiple must be boolean`);
    else if (maxValid && selection.multiple !== (selection.max > 1)) errors.push(`${label} multiple must match max`);
    if (selection.defaultOptionId !== null && typeof selection.defaultOptionId !== 'string') errors.push(`${label} defaultOptionId must be a string or null`);
    if (typeof selection.defaultOptionId === 'string' && !options.some((option) => option.id === selection.defaultOptionId)) errors.push(`${label} default option does not exist`);
    if (selection.required === true && selection.defaultOptionId === null) errors.push(`required modifier group ${group.id} must declare a default or be reconciled`);
    requireString(selection.defaultProvenance, `${label} defaultProvenance`);
    for (const option of options) {
      const optionLabel = `option ${group.id}/${option.id || '(missing id)'}`;
      requireSafeInteger(option.sortOrder, `${optionLabel} sortOrder`);
      if (typeof option.active !== 'boolean') errors.push(`${optionLabel} active must be boolean`);
      checkSource(option.source, optionLabel);
      const effect = option.priceEffect;
      if (!isRecord(effect)) errors.push(`${optionLabel} priceEffect metadata is required`);
      else {
        if (!['none', 'fixed-addition'].includes(effect.kind)) errors.push(`${optionLabel} price effect kind is invalid`);
        requireSafeInteger(effect.amountCents, `${optionLabel} price effect amountCents`);
        if (effect.currency !== catalog.currency) errors.push(`${optionLabel} price effect currency must match catalog currency`);
        if (effect.kind === 'none' && effect.amountCents !== 0) errors.push(`${optionLabel} none price effect must be zero`);
      }
    }
  }

  for (const product of products) {
    const label = `product ${product.id || '(missing id)'}`;
    requireSafeInteger(product.sortOrder, `${label} sortOrder`);
    if (typeof product.active !== 'boolean') errors.push(`${label} active must be boolean`);
    if (typeof product.available !== 'boolean') errors.push(`${label} available must be boolean`);
    checkSource(product.source, label);
    if (!categoryIds.has(product.categoryId)) errors.push(`${label} references missing category ${product.categoryId}`);
    if (!isRecord(product.price)) errors.push(`${label} price metadata is required`);
    else {
      requireSafeInteger(product.price.amountCents, `${label} price amountCents`);
      if (product.price.currency !== catalog.currency) errors.push(`${label} price currency must match catalog currency`);
      requireString(product.price.provenance, `${label} price provenance`);
    }
    for (const [index, groupId] of requireArray(product.modifierGroupIds, `${label} modifierGroupIds`).entries()) {
      if (typeof groupId !== 'string' || !groups.has(groupId)) errors.push(`${label} references missing modifier group ${groupId} at index ${index}`);
    }
    const stock = product.stockControl;
    if (!isRecord(stock)) errors.push(`${label} stockControl metadata is required`);
    else {
      if (!['recipe', 'piece', 'none', 'unknown'].includes(stock.mode)) errors.push(`${label} has invalid stock control mode`);
      requireString(stock.evidence, `${label} stock control evidence`);
      if (typeof stock.validated !== 'boolean') errors.push(`${label} stockControl.validated must be boolean`);
    }
  }

  const auditEvents = requireArray(catalog.auditEvents, 'auditEvents');
  for (const [index, event] of auditEvents.entries()) {
    const label = `auditEvents[${index}]`;
    if (!isRecord(event)) { errors.push(`${label} must be an object`); continue; }
    for (const field of ['commandId', 'actorId', 'occurredAt', 'type']) requireString(event[field], `${label} ${field}`);
    if (typeof event.occurredAt === 'string' && Number.isNaN(Date.parse(event.occurredAt))) errors.push(`${label} occurredAt must be a valid date`);
  }
  const auditIds = auditEvents.map((event) => event?.commandId).filter((id) => typeof id === 'string');
  if (new Set(auditIds).size !== auditIds.length) errors.push('auditEvents commandId values must be unique');
  const blockers = isRecord(catalog.importGate) && Array.isArray(catalog.importGate.blockers) ? catalog.importGate.blockers : [];
  return { errors, blockers };
}

function clone(value) { return structuredClone(value); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
function fail(message) { throw new Error(message); }
function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-blank string`);
  return value.trim();
}
function requireCents(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer in MXN centavos`);
  return value;
}
function assertValid(catalog) {
  const { errors } = validateCatalog(catalog);
  if (errors.length) fail(`Invalid catalog: ${errors.join('; ')}`);
}
function sourceEntry() { return { kind: 'operator-entry', path: 'catalog-command' }; }

/** Apply an append-only catalog command. Authenticated actor identity must come from a trusted caller. */
export function applyCatalogCommand(input, command) {
  assertValid(input);
  if (!isRecord(command)) fail('command must be an object');
  const commandId = requireText(command.commandId, 'commandId');
  const actorId = requireText(command.actorId, 'actorId');
  const occurredAt = requireText(command.occurredAt, 'occurredAt');
  if (Number.isNaN(Date.parse(occurredAt))) fail('occurredAt must be a valid date');
  const type = requireText(command.type, 'type');
  const fingerprint = stable(command);
  const existing = input.auditEvents.find((event) => event.commandId === commandId);
  if (existing) {
    if (existing.fingerprint !== fingerprint) fail(`commandId ${commandId} was already used for a different command`);
    return { catalog: input, replayed: true };
  }
  const catalog = clone(input);
  const event = { commandId, actorId, occurredAt, type, fingerprint };
  const category = (id) => catalog.categories.find((item) => item.id === id) || fail(`category ${id} does not exist`);
  const product = (id) => catalog.products.find((item) => item.id === id) || fail(`product ${id} does not exist`);
  const uniqueId = (collection, id, label) => {
    requireText(id, `${label} id`);
    if (collection.some((item) => item.id === id)) fail(`${label} id ${id} already exists`);
  };
  const name = (value) => requireText(value, 'name');
  switch (type) {
    case 'category.create': {
      const value = command.category || {};
      uniqueId(catalog.categories, value.id, 'category');
      catalog.categories.push({ id: value.id, name: name(value.name), sortOrder: value.sortOrder ?? catalog.categories.length, active: value.active ?? true, source: sourceEntry() });
      break;
    }
    case 'category.edit': {
      const target = category(command.categoryId); const changes = command.changes || {};
      if ('id' in changes) fail('category id is immutable');
      if ('name' in changes) target.name = name(changes.name);
      if ('sortOrder' in changes) target.sortOrder = changes.sortOrder;
      if ('active' in changes) target.active = changes.active;
      break;
    }
    case 'category.reorder': category(command.categoryId).sortOrder = command.sortOrder; break;
    case 'category.setActive': category(command.categoryId).active = command.active; break;
    case 'product.create': {
      const value = command.product || {};
      uniqueId(catalog.products, value.id, 'product');
      if (!catalog.categories.some((item) => item.id === value.categoryId)) fail(`category ${value.categoryId} does not exist`);
      const amountCents = requireCents(value.price?.amountCents, 'price.amountCents');
      if (value.price?.currency !== CURRENCY) fail(`price.currency must be ${CURRENCY}`);
      const modifierGroupIds = value.modifierGroupIds ?? [];
      if (!Array.isArray(modifierGroupIds) || modifierGroupIds.some((id) => !catalog.modifierGroups.some((group) => group.id === id))) fail('modifierGroupIds must reference existing modifier groups');
      catalog.products.push({ id: value.id, name: name(value.name), categoryId: value.categoryId, sortOrder: value.sortOrder ?? catalog.products.length, price: { amountCents, currency: CURRENCY, provenance: value.price.provenance || 'operator-entered-unverified' }, active: value.active ?? true, available: value.available ?? true, modifierGroupIds: [...modifierGroupIds], stockControl: value.stockControl || { mode: 'unknown', evidence: 'Not classified by an approved stock mapping.', validated: false }, source: sourceEntry() });
      break;
    }
    case 'product.edit': {
      const target = product(command.productId); const changes = command.changes || {};
      if ('id' in changes) fail('product id is immutable');
      if ('name' in changes) target.name = name(changes.name);
      if ('categoryId' in changes) {
        if (!catalog.categories.some((item) => item.id === changes.categoryId)) fail(`category ${changes.categoryId} does not exist`);
        target.categoryId = changes.categoryId;
      }
      if ('sortOrder' in changes) target.sortOrder = changes.sortOrder;
      if ('active' in changes) target.active = changes.active;
      if ('available' in changes) target.available = changes.available;
      if ('price' in changes) {
        const amountCents = requireCents(changes.price?.amountCents, 'price.amountCents');
        if (changes.price.currency !== CURRENCY) fail(`price.currency must be ${CURRENCY}`);
        target.price = { amountCents, currency: CURRENCY, provenance: changes.price.provenance || 'operator-entered-unverified' };
      }
      if ('modifierGroupIds' in changes) {
        if (!Array.isArray(changes.modifierGroupIds) || changes.modifierGroupIds.some((id) => !catalog.modifierGroups.some((group) => group.id === id))) fail('modifierGroupIds must reference existing modifier groups');
        target.modifierGroupIds = [...changes.modifierGroupIds];
      }
      break;
    }
    case 'product.reorder': product(command.productId).sortOrder = command.sortOrder; break;
    case 'product.setActive': product(command.productId).active = command.active; break;
    default: fail(`unsupported catalog command type ${type}`);
  }
  catalog.revision += 1;
  catalog.auditEvents.push(event);
  assertValid(catalog);
  return { catalog: deepFreeze(catalog), replayed: false };
}

export const catalogSchema = CATALOG_SCHEMA;
