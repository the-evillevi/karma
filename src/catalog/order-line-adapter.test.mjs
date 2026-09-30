import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { applyCatalogCommand, captureProductLine } from './catalog-domain.mjs';
import { toOrderLineSnapshot } from './order-line-adapter.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalogPath = path.join(root, 'catalog/catalog.json');
const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/order-line-snapshot.contract.json');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const command = (type, fields, commandId) => ({
  commandId, actorId: 'synthetic-actor', occurredAt: '2026-09-29T00:00:00Z', type, ...fields,
});

test('adapter maps captured base price and modifier charge once to the shared contract fixture', async () => {
  let catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const product = {
    id: fixture.expected.productId,
    name: 'Synthetic coffee',
    categoryId: 'lattes',
    price: { amountCents: 6900, currency: 'MXN' },
    modifierGroupIds: ['leche'],
  };
  catalog = applyCatalogCommand(catalog, command('product.create', { product }, 'create-synthetic-product')).catalog;
  const captured = captureProductLine(catalog, {
    productId: product.id,
    selections: { leche: { optionIds: ['deslactosada'] } },
    notes: 'synthetic note',
    taxSnapshot: { rateBasisPoints: 0, amountCents: 0, currency: 'MXN', source: 'synthetic-test-policy' },
  });
  const snapshot = toOrderLineSnapshot(captured, {
    lineId: fixture.expected.lineId,
    catalogPriceVersionId: fixture.expected.catalogPriceVersionId,
    taxRateBasisPoints: 0,
    priceIncludesTax: true,
  });
  assert.deepEqual(snapshot, fixture.expected);
  if (consumerPath) {
    const consumer = await import(pathToFileURL(path.resolve(consumerPath)).href);
    assert.equal(consumer.validateLineSnapshot(snapshot), true);
  }
  const calculatedSubtotal = snapshot.unitPriceCents * snapshot.quantity
    + snapshot.modifierSnapshots.reduce((sum, modifier) => sum + modifier.priceDeltaCents * snapshot.quantity, 0);
  assert.equal(calculatedSubtotal, fixture.subtotalCents);
  assert.equal(calculatedSubtotal, 7900);
});

test('order line adapter requires explicit identifiers and tax policy', async () => {
  const captured = captureProductLine(JSON.parse(await readFile(catalogPath, 'utf8')), { productId: 'te-t-' });
  assert.throws(() => toOrderLineSnapshot(captured, { catalogPriceVersionId: 'v1', taxRateBasisPoints: 0, priceIncludesTax: true }), /lineId is required/);
  assert.throws(() => toOrderLineSnapshot(captured, { lineId: 'l1', taxRateBasisPoints: 0, priceIncludesTax: true }), /catalogPriceVersionId is required/);
  assert.throws(() => toOrderLineSnapshot(captured, { lineId: 'l1', catalogPriceVersionId: 'v1', priceIncludesTax: true }), /taxRateBasisPoints/);
  assert.throws(() => toOrderLineSnapshot(captured, { lineId: 'l1', catalogPriceVersionId: 'v1', taxRateBasisPoints: 0, priceIncludesTax: false }), /must be true/);
});

test('modifier and product snapshots survive later catalog edits', async () => {
  let catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const product = { id: 'snapshot-cafe', name: 'Café snapshot', categoryId: 'lattes', price: { amountCents: 6900, currency: 'MXN' }, modifierGroupIds: ['leche'] };
  catalog = applyCatalogCommand(catalog, command('product.create', { product }, 'create-product')).catalog;
  const captured = captureProductLine(catalog, { productId: product.id, selections: { leche: { optionIds: ['deslactosada'] } }, notes: 'sin espuma' });
  const line = toOrderLineSnapshot(captured, { lineId: 'snapshot-line', catalogPriceVersionId: 'price-version-1', taxRateBasisPoints: 0, priceIncludesTax: true });
  const changedOption = applyCatalogCommand(catalog, command('modifierOption.edit', {
    groupId: 'leche', optionId: 'deslactosada', changes: { name: 'Name changed', priceEffect: { kind: 'fixed-addition', amountCents: 9900, currency: 'MXN' } },
  }, 'edit-option'));
  applyCatalogCommand(changedOption.catalog, command('product.edit', {
    productId: product.id, changes: { name: 'Renamed café', price: { amountCents: 8700, currency: 'MXN' } },
  }, 'edit-product'));
  assert.equal(line.productNameSnapshot, 'Café snapshot');
  assert.equal(line.unitPriceCents, 6900);
  assert.equal(line.modifierSnapshots[0].nameSnapshot, 'Tipo de leche: Deslactosada');
  assert.equal(line.modifierSnapshots[0].priceDeltaCents, 1000);
  assert.ok(Object.isFrozen(line.modifierSnapshots[0]));
  if (consumerPath) {
    const consumer = await import(pathToFileURL(path.resolve(consumerPath)).href);
    assert.equal(consumer.validateLineSnapshot(line), true);
  }
});

test('documented preparation-measurement extension maps to line snapshot without setting a real menu default', async () => {
  let catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  catalog = applyCatalogCommand(catalog, command('modifierGroup.create', {
    group: { id: 'measure-fixture', name: 'Synthetic espresso amount', selection: { required: false, multiple: false, min: 0, max: 0, defaultOptionId: null, defaultProvenance: 'synthetic', unit: 'oz', defaultQuantity: 2 } },
  }, 'create-measure-group')).catalog;
  const productId = catalog.products[0].id;
  catalog = applyCatalogCommand(catalog, command('product.edit', {
    productId, changes: { modifierGroupIds: [...catalog.products[0].modifierGroupIds, 'measure-fixture'] },
  }, 'link-measure-group')).catalog;
  const captured = captureProductLine(catalog, { productId });
  const line = toOrderLineSnapshot(captured, { lineId: 'measure-line', catalogPriceVersionId: 'synthetic-v1', taxRateBasisPoints: 0, priceIncludesTax: true });
  assert.deepEqual(line.preparationMeasurements, [{ modifierGroupId: 'measure-fixture', nameSnapshot: 'Synthetic espresso amount', quantity: 2, unitSnapshot: 'oz' }]);
  assert.equal(line.modifierSnapshots.at(-1).modifierId, 'measure-fixture/measure-oz');
  if (consumerPath) {
    const consumer = await import(pathToFileURL(path.resolve(consumerPath)).href);
    assert.equal(consumer.validateLineSnapshot(line), true);
  }
});

const consumerPath = process.env.KARMA_113_ORDER_DOMAIN_MODULE;
test('reviewed EVL-113 snapshot validator accepts the adapted line', { skip: !consumerPath }, async () => {
  const consumer = await import(pathToFileURL(path.resolve(consumerPath)).href);
  assert.equal(typeof consumer.validateLineSnapshot, 'function');
  const expected = fixture.expected;
  assert.equal(consumer.validateLineSnapshot(expected), true);
});
