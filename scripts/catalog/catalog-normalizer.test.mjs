import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalizeCatalog, validateCatalog } from './catalog-normalizer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.window = {};
await import(path.join(root, 'src/karma-data.js'));
const seed = globalThis.window.KARMA;

test('normalization preserves current seed identifiers, ordering, availability and modifiers', () => {
  const catalog = normalizeCatalog(seed);
  assert.deepEqual(catalog.categories.map(({ id }) => id), seed.categories.map(({ id }) => id));
  assert.deepEqual(catalog.products.map(({ id }) => id), seed.products.map(({ id }) => id));
  assert.deepEqual(catalog.products.map(({ available }) => available), seed.products.map(({ available }) => available));
  assert.deepEqual(catalog.products.map(({ modifierGroupIds }) => modifierGroupIds), seed.products.map(({ mods }) => mods));
  assert.deepEqual(catalog.modifierGroups.map(({ id }) => id), Object.keys(seed.modGroups));
});

test('required and multi-select rules, runtime defaults, and additive price effects are explicit', () => {
  const catalog = normalizeCatalog(seed);
  const leche = catalog.modifierGroups.find(({ id }) => id === 'leche');
  const shot = catalog.modifierGroups.find(({ id }) => id === 'shot');
  assert.deepEqual(leche.selection, {
    required: true, multiple: false, min: 1, max: 1, defaultOptionId: 'entera', defaultProvenance: 'existing-runtime-first-option',
  });
  assert.equal(shot.selection.required, false);
  assert.equal(shot.selection.multiple, true);
  assert.equal(leche.options.find(({ id }) => id === 'deslactosada').priceEffect.amountCents, 1000);
  assert.equal(leche.options[0].priceEffect.currency, 'MXN');
});

test('peso prices use exact integer centavos and preserve unverified provenance', () => {
  const catalog = normalizeCatalog(seed);
  assert.equal(catalog.currency, 'MXN');
  assert.deepEqual(catalog.products.find(({ name }) => name === 'Americano').price, {
    amountCents: 5000, currency: 'MXN', provenance: 'prototype-seed-unverified',
  });

  const fractionalSeed = structuredClone(seed);
  fractionalSeed.products.find(({ name }) => name === 'Americano').price = 50.25;
  assert.equal(normalizeCatalog(fractionalSeed).products.find(({ name }) => name === 'Americano').price.amountCents, 5025);
  fractionalSeed.products.find(({ name }) => name === 'Americano').price = 50.255;
  assert.throws(() => normalizeCatalog(fractionalSeed), /no more than two decimal places/);
});

test('stock control marks only prototype recipe or matching finished-good evidence and leaves validation open', () => {
  const catalog = normalizeCatalog(seed);
  assert.equal(catalog.products.find(({ name }) => name === 'Latte matcha').stockControl.mode, 'recipe');
  assert.equal(catalog.products.find(({ name }) => name === 'Brownie').stockControl.mode, 'piece');
  assert.equal(catalog.products.find(({ name }) => name === 'Americano').stockControl.mode, 'unknown');
  assert.ok(catalog.products.every(({ stockControl }) => stockControl.validated === false));
  assert.equal(catalog.importGate.readyForValidatedBusinessUse, false);
});

test('validator rejects unresolved required defaults and broken references', () => {
  const catalog = normalizeCatalog(seed);
  const invalid = structuredClone(catalog);
  invalid.modifierGroups.find(({ id }) => id === 'leche').selection.defaultOptionId = null;
  invalid.products[0].categoryId = 'missing-category';
  const { errors } = validateCatalog(invalid);
  assert.ok(errors.some((error) => error.includes('must declare a default')));
  assert.ok(errors.some((error) => error.includes('references missing category')));
});

test('validator returns errors for malformed external input without throwing', () => {
  const malformed = {
    schema: 'karma.catalog/v1',
    catalogId: 'broken',
    revision: 1,
    currency: 'MXN',
    sourceStatus: 'draft',
    importGate: { readyForValidatedBusinessUse: false, blockers: [] },
    sources: [],
    categories: [null, { id: 'c', name: '  ', sortOrder: Number.MAX_SAFE_INTEGER + 1, active: true }],
    products: [{ id: 'p', name: 'Product', price: null, modifierGroupIds: null, stockControl: null }],
    modifierGroups: [{ id: 'g', name: 'Group', options: null, selection: null }],
  };
  let result;
  assert.doesNotThrow(() => { result = validateCatalog(malformed); });
  assert.ok(result.errors.some((error) => error.includes('categories[0] must be an object')));
  assert.ok(result.errors.some((error) => error.includes('name must be a non-blank string')));
  assert.ok(result.errors.some((error) => error.includes('options must be an array')));
  assert.ok(result.errors.some((error) => error.includes('price metadata is required')));
  assert.ok(result.errors.some((error) => error.includes('modifierGroupIds must be an array')));
  assert.ok(result.errors.some((error) => error.includes('stockControl metadata is required')));
  for (const value of [null, [], 'bad', undefined]) assert.doesNotThrow(() => validateCatalog(value));
});

test('structurally valid approved stock metadata is accepted while the business gate can remain closed', () => {
  const catalog = structuredClone(normalizeCatalog(seed));
  catalog.products[0].stockControl = { mode: 'none', evidence: 'Carlos-approved no-stock-control classification.', validated: true };
  assert.deepEqual(validateCatalog(catalog).errors, []);
  assert.equal(catalog.importGate.readyForValidatedBusinessUse, false);
});

test('validator rejects centavo values outside the safe integer range', () => {
  const catalog = structuredClone(normalizeCatalog(seed));
  catalog.products[0].price.amountCents = Number.MAX_SAFE_INTEGER + 1;
  assert.ok(validateCatalog(catalog).errors.some((error) => error.includes('price amountCents must be a safe integer')));
});

test('committed JSON is reproducible from the current seed', async () => {
  const expected = JSON.stringify(normalizeCatalog(seed), null, 2) + '\n';
  const actual = await readFile(path.join(root, 'catalog/catalog.json'), 'utf8');
  assert.equal(actual, expected);
});
