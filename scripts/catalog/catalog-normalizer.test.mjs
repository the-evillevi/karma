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
  assert.equal(leche.options.find(({ id }) => id === 'deslactosada').priceEffect.amount, 10);
  assert.equal(leche.options[0].priceEffect.currency, null);
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

test('committed JSON is reproducible from the current seed', async () => {
  const expected = JSON.stringify(normalizeCatalog(seed), null, 2) + '\n';
  const actual = await readFile(path.join(root, 'catalog/catalog.json'), 'utf8');
  assert.equal(actual, expected);
});
