const CATALOG_SCHEMA = 'karma.catalog/v1';
const CURRENCY = 'MXN';

const toStableOptionId = (option) => option.id;

function amountToCents(amount, context) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    throw new TypeError(`${context} must be a finite, non-negative peso amount`);
  }
  const match = String(amount).match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new RangeError(`${context} must have no more than two decimal places`);
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new RangeError(`${context} exceeds the safe integer centavo range`);
  return cents;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Convert the current prototype seed into a portable, explicit catalog shape. */
export function normalizeCatalog(seed) {
  const recipeNames = new Set((seed.recipes || []).map((recipe) => recipe.product));
  const finishedGoods = new Set(
    (seed.inventory || [])
      .filter((item) => item.kind === 'Producto terminado')
      .map((item) => item.name.toLocaleLowerCase('es-MX')),
  );

  const categories = seed.categories.map((category, index) => ({
    id: category.id,
    name: category.label,
    sortOrder: index,
    active: true,
    source: { kind: 'prototype-seed', path: 'src/karma-data.js#categories' },
  }));

  const modifierGroups = Object.entries(seed.modGroups).map(([id, group], index) => ({
    id,
    name: group.label,
    sortOrder: index,
    selection: {
      required: group.min > 0,
      multiple: group.max > 1,
      min: group.min,
      max: group.max,
      // The current POS initializes required groups to their first option.
      // Keeping that behavior explicit avoids silently changing existing orders.
      defaultOptionId: group.min > 0 ? toStableOptionId(group.options[0]) : null,
      defaultProvenance: group.min > 0 ? 'existing-runtime-first-option' : 'none',
    },
    options: group.options.map((option, optionOrder) => ({
      id: toStableOptionId(option),
      name: option.label,
      sortOrder: optionOrder,
      priceEffect: {
        kind: option.price === 0 ? 'none' : 'fixed-addition',
        amountCents: amountToCents(option.price, `modifier ${id}/${option.id} price`),
        currency: CURRENCY,
      },
      active: true,
      source: { kind: 'prototype-seed', path: 'src/karma-data.js#modGroups.' + id },
    })),
    source: { kind: 'prototype-seed', path: 'src/karma-data.js#modGroups.' + id },
  }));

  const products = seed.products.map((product, index) => {
    const recipeMatched = recipeNames.has(product.name);
    const pieceMatched = finishedGoods.has(product.name.toLocaleLowerCase('es-MX'));
    return {
      id: product.id,
      name: product.name,
      categoryId: product.cat,
      sortOrder: index,
      price: { amountCents: amountToCents(product.price, `product ${product.id} price`), currency: CURRENCY, provenance: 'prototype-seed-unverified' },
      available: Boolean(product.available),
      modifierGroupIds: [...product.mods],
      stockControl: {
        mode: recipeMatched ? 'recipe' : pieceMatched ? 'piece' : 'unknown',
        evidence: recipeMatched
          ? 'Prototype recipe is present; quantities and applicability need source validation.'
          : pieceMatched
            ? 'Prototype finished-good inventory item has the same name; mapping needs source validation.'
            : 'No direct recipe or finished-good inventory mapping exists in the prototype seed.',
        validated: false,
      },
      source: { kind: 'prototype-seed', path: 'src/karma-data.js#products' },
    };
  });

  return {
    schema: CATALOG_SCHEMA,
    catalogId: 'karma-cafe',
    revision: 1,
    currency: CURRENCY,
    sourceStatus: 'prototype-seed-only',
    importGate: {
      readyForValidatedBusinessUse: false,
      blockers: [
        'Source workbooks are only partially reconciled; product photos remain unavailable.',
        'Carlos has not validated menu names, prices, availability, options, or stock control.',
      ],
    },
    sources: [
      { id: 'prototype-seed', path: 'src/karma-data.js', status: 'available-unverified' },
      {
        id: 'stock-workbook',
        name: 'ReporteDeStock_52000822_2026-8-6-1813618144.xlsx',
        status: 'available-inspected-private-copy',
        sizeBytes: 20375,
        sha256: 'bf0f2d5db6c3a8084d58dad5bc2b0e809a2a926dbd8843bf43ecd911dedc732f',
        coverage: { sheets: 1, dataRows: 107, headerRow: 8, embeddedMediaFiles: 1, columns: ['Categoría', 'Nombre', 'SKU', 'Stock Actual', 'Unidad'] },
      },
      {
        id: 'products-workbook',
        name: 'products-Today.xlsx',
        status: 'available-inspected-private-copy',
        sizeBytes: 76754,
        sha256: '57efde7545fbaa18a035e5dd20ab7b1036687678f7b90b7210bc860445335499',
        coverage: {
          sheets: 1,
          dataRows: 115,
          headerRow: 2,
          embeddedMediaFiles: 0,
          mappedColumns: ['Categoría', 'Nombre', 'Sku', 'Precio del menu', 'Iva del menu', 'Disponible?'],
          otherColumns: ['Descripción', 'Imagen', 'Es Pesable?', 'Unidad de medida', 'Carta', 'IEPS', 'Clave de producto CFDI', 'Unidad CFDI', 'Combo?'],
        },
      },
      { id: 'product-photos', count: 3, status: 'unavailable-expired-linear-links' },
      { id: 'carlos-review', status: 'pending' },
    ],
    categories,
    modifierGroups,
    products,
  };
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
    if (!minValid || !maxValid || (minValid && maxValid && selection.max < selection.min)) {
      errors.push(`modifier group ${group.id} has invalid selection limits`);
    }
    if (minValid && selection.min > options.length) errors.push(`${label} min exceeds its option count`);
    if (maxValid && selection.max > options.length) errors.push(`${label} max exceeds its option count`);
    if (typeof selection.required !== 'boolean') errors.push(`${label} required must be boolean`);
    else if (minValid && selection.required !== (selection.min > 0)) errors.push(`${label} required must match min`);
    if (typeof selection.multiple !== 'boolean') errors.push(`${label} multiple must be boolean`);
    else if (maxValid && selection.multiple !== (selection.max > 1)) errors.push(`${label} multiple must match max`);
    if (selection.defaultOptionId !== null && typeof selection.defaultOptionId !== 'string') errors.push(`${label} defaultOptionId must be a string or null`);
    if (typeof selection.defaultOptionId === 'string' && !options.some((option) => option.id === selection.defaultOptionId)) {
      errors.push(`${label} default option does not exist`);
    }
    if (selection.required === true && selection.defaultOptionId === null) errors.push(`required modifier group ${group.id} must declare a default or be reconciled`);
    requireString(selection.defaultProvenance, `${label} defaultProvenance`);
    for (const option of options) {
      const optionLabel = `option ${group.id}/${option.id || '(missing id)'}`;
      requireSafeInteger(option.sortOrder, `${optionLabel} sortOrder`);
      if (typeof option.active !== 'boolean') errors.push(`${optionLabel} active must be boolean`);
      checkSource(option.source, optionLabel);
      const effect = option.priceEffect;
      if (!isRecord(effect)) {
        errors.push(`${optionLabel} priceEffect metadata is required`);
      } else {
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
    if (typeof product.available !== 'boolean') errors.push(`${label} available must be boolean`);
    checkSource(product.source, label);
    if (!categoryIds.has(product.categoryId)) errors.push(`${label} references missing category ${product.categoryId}`);
    if (!isRecord(product.price)) {
      errors.push(`${label} price metadata is required`);
    } else {
      requireSafeInteger(product.price.amountCents, `${label} price amountCents`);
      if (product.price.currency !== catalog.currency) errors.push(`${label} price currency must match catalog currency`);
      requireString(product.price.provenance, `${label} price provenance`);
    }
    for (const [index, groupId] of requireArray(product.modifierGroupIds, `${label} modifierGroupIds`).entries()) {
      if (typeof groupId !== 'string' || !groups.has(groupId)) errors.push(`${label} references missing modifier group ${groupId} at index ${index}`);
    }
    const stock = product.stockControl;
    if (!isRecord(stock)) {
      errors.push(`${label} stockControl metadata is required`);
    } else {
      if (!['recipe', 'piece', 'none', 'unknown'].includes(stock.mode)) errors.push(`${label} has invalid stock control mode`);
      requireString(stock.evidence, `${label} stock control evidence`);
      if (typeof stock.validated !== 'boolean') errors.push(`${label} stockControl.validated must be boolean`);
    }
  }

  const blockers = isRecord(catalog.importGate) && Array.isArray(catalog.importGate.blockers) ? catalog.importGate.blockers : [];
  return { errors, blockers };
}
