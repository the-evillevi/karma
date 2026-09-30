const CATALOG_SCHEMA = 'karma.catalog/v1';
const CURRENCY = 'MXN';
export { validateCatalog } from '../../src/catalog/catalog-domain.mjs';

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
    active: true,
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
      active: true,
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
        coverage: {
          sheets: 1,
          dataRows: 107,
          headerRow: 8,
          embeddedMediaFiles: 1,
          columns: ['Categoría', 'Nombre', 'SKU', 'Stock Actual', 'Unidad'],
          reconciliationSummary: { matchedProductSkuAndName: 17, unmappedRows: 90, pieceUnitCandidates: 0, skuNameConflicts: 0 },
        },
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
          reconciliationSummary: {
            exactNormalizedNameMatches: 17,
            prototypeProductsUnmatched: 61,
            ambiguousExactMatches: 0,
            menuPriceDifferences: 6,
            menuAvailability: { available: 0, unavailable: 51, unknown: 64 },
            availabilityDifferencesAmongExactMatches: 5,
            categoryLabelDifferences: 11,
            duplicateNormalizedNameGroups: 3,
            duplicateSkuGroups: 0,
          },
        },
      },
      { id: 'product-photos', count: 3, status: 'unavailable-expired-linear-links' },
      { id: 'carlos-review', status: 'pending' },
    ],
    categories,
    modifierGroups,
    products,
    auditEvents: [],
  };
}
