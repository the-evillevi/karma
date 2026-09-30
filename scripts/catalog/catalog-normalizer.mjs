const CATALOG_SCHEMA = 'karma.catalog/v1';

const toStableOptionId = (option) => option.id;

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
      priceEffect: { kind: option.price === 0 ? 'none' : 'fixed-addition', amount: option.price, currency: null },
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
      price: { amount: product.price, currency: null, provenance: 'prototype-seed-unverified' },
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
    currency: null,
    sourceStatus: 'prototype-seed-only',
    importGate: {
      readyForValidatedBusinessUse: false,
      blockers: [
        'Source workbooks and product photos have not been reconciled against the prototype seed.',
        'Carlos has not validated menu names, prices, availability, options, or stock control.',
      ],
    },
    sources: [
      { id: 'prototype-seed', path: 'src/karma-data.js', status: 'available-unverified' },
      { id: 'stock-workbook', name: 'ReporteDeStock_52000822_2026-8-6-1813618144.xlsx', status: 'unavailable-expired-linear-link' },
      { id: 'products-workbook', name: 'products-Today.xlsx', status: 'unavailable-expired-linear-link' },
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
  const checkUnique = (records, label) => {
    const seen = new Set();
    for (const record of records || []) {
      if (!record.id || typeof record.id !== 'string') errors.push(`${label} has a missing or invalid id`);
      else if (seen.has(record.id)) errors.push(`${label} id is duplicated: ${record.id}`);
      seen.add(record.id);
    }
  };

  if (!catalog || catalog.schema !== CATALOG_SCHEMA) errors.push(`schema must be ${CATALOG_SCHEMA}`);
  if (!catalog) return { errors, blockers: [] };

  checkUnique(catalog.categories, 'category');
  checkUnique(catalog.products, 'product');
  checkUnique(catalog.modifierGroups, 'modifier group');
  const categoryIds = new Set((catalog.categories || []).map((item) => item.id));
  const groups = new Map((catalog.modifierGroups || []).map((item) => [item.id, item]));

  for (const group of catalog.modifierGroups || []) {
    checkUnique(group.options, `option in ${group.id}`);
    const selection = group.selection || {};
    if (!Number.isInteger(selection.min) || !Number.isInteger(selection.max) || selection.min < 0 || selection.max < selection.min) {
      errors.push(`modifier group ${group.id} has invalid selection limits`);
    }
    if (selection.required !== (selection.min > 0)) errors.push(`modifier group ${group.id} required must match min`);
    if (selection.multiple !== (selection.max > 1)) errors.push(`modifier group ${group.id} multiple must match max`);
    if (selection.defaultOptionId !== null && !group.options.some((option) => option.id === selection.defaultOptionId)) {
      errors.push(`modifier group ${group.id} default option does not exist`);
    }
    if (selection.required && selection.defaultOptionId === null) errors.push(`required modifier group ${group.id} must declare a default or be reconciled`);
    for (const option of group.options || []) {
      if (!Number.isFinite(option.priceEffect?.amount) || option.priceEffect.amount < 0) errors.push(`option ${group.id}/${option.id} has invalid price effect`);
    }
  }

  for (const product of catalog.products || []) {
    if (!categoryIds.has(product.categoryId)) errors.push(`product ${product.id} references missing category ${product.categoryId}`);
    if (!Number.isFinite(product.price?.amount) || product.price.amount < 0) errors.push(`product ${product.id} has invalid price`);
    for (const groupId of product.modifierGroupIds || []) if (!groups.has(groupId)) errors.push(`product ${product.id} references missing modifier group ${groupId}`);
    if (!['recipe', 'piece', 'unknown'].includes(product.stockControl?.mode)) errors.push(`product ${product.id} has invalid stock control mode`);
    if (product.stockControl?.validated !== false) errors.push(`product ${product.id} must retain its unvalidated stock-control state`);
  }

  return { errors, blockers: catalog.importGate?.blockers || [] };
}
