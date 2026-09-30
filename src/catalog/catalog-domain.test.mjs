import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { applyCatalogCommand, captureProductLine, validateCatalog } from './catalog-domain.mjs';
import { adaptCatalogForRuntime } from './runtime-adapter.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const seed = JSON.parse(await readFile(path.join(root, 'catalog/catalog.json'), 'utf8'));
const command = (type, fields = {}, commandId = 'cmd-1') => ({
  commandId, actorId: 'staff-42', occurredAt: '2026-09-29T16:30:00.000Z', type, ...fields,
});

test('category commands create, edit, reorder and activate with append-only audit metadata', () => {
  const created = applyCatalogCommand(seed, command('category.create', { category: { id: 'seasonal', name: 'Temporada' } }));
  assert.equal(created.catalog.categories.at(-1).sortOrder, seed.categories.length);
  assert.equal(created.catalog.auditEvents[0].actorId, 'staff-42');
  assert.equal(created.catalog.auditEvents[0].occurredAt, '2026-09-29T16:30:00.000Z');
  assert.equal(created.catalog.auditEvents[0].commandId, 'cmd-1');
  const edited = applyCatalogCommand(created.catalog, command('category.edit', { categoryId: 'seasonal', changes: { name: 'Especiales' } }, 'cmd-2'));
  const reordered = applyCatalogCommand(edited.catalog, command('category.reorder', { categoryId: 'seasonal', sortOrder: 0 }, 'cmd-3'));
  const disabled = applyCatalogCommand(reordered.catalog, command('category.setActive', { categoryId: 'seasonal', active: false }, 'cmd-4'));
  assert.equal(disabled.catalog.categories.at(-1).name, 'Especiales');
  assert.equal(disabled.catalog.categories.at(-1).sortOrder, 0);
  assert.equal(disabled.catalog.categories.at(-1).active, false);
  assert.equal(disabled.catalog.auditEvents.length, 4);
  assert.equal(seed.categories.some(({ id }) => id === 'seasonal'), false);
});

test('product commands require a name, existing category, and exact MXN centavos', () => {
  const added = applyCatalogCommand(seed, command('product.create', {
    product: { id: 'special-drink', name: 'Bebida especial', categoryId: 'postres', price: { amountCents: 1205, currency: 'MXN' } },
  }));
  const item = added.catalog.products.at(-1);
  assert.equal(item.price.amountCents, 1205);
  assert.equal(item.active, true);
  assert.equal(item.stockControl.mode, 'unknown');
  assert.equal(item.stockControl.validated, false);
  assert.throws(() => applyCatalogCommand(seed, command('product.create', {
    product: { id: 'blank', name: '  ', categoryId: 'postres', price: { amountCents: 1205, currency: 'MXN' } },
  })), /name must be a non-blank string/);
  assert.throws(() => applyCatalogCommand(seed, command('product.create', {
    product: { id: 'bad-cat', name: 'Drink', categoryId: 'missing', price: { amountCents: 1205, currency: 'MXN' } },
  })), /category missing does not exist/);
  assert.throws(() => applyCatalogCommand(seed, command('product.create', {
    product: { id: 'bad-cents', name: 'Drink', categoryId: 'postres', price: { amountCents: 12.05, currency: 'MXN' } },
  })), /safe integer in MXN centavos/);
});

test('stock-control create/edit copies inputs and validates mode; unknown edit fields fail', () => {
  const stockControl = { mode: 'none', evidence: 'Synthetic test classification.', validated: true };
  const added = applyCatalogCommand(seed, command('product.create', {
    product: { id: 'stock-test', name: 'Stock test', categoryId: 'postres', price: { amountCents: 99, currency: 'MXN' }, stockControl },
  }));
  assert.equal(Object.isFrozen(stockControl), false);
  assert.equal(Object.isFrozen(added.catalog.products.at(-1).stockControl), true);
  const edited = applyCatalogCommand(added.catalog, command('product.edit', {
    productId: 'stock-test', changes: { stockControl: { mode: 'recipe', evidence: 'Synthetic edited classification.', validated: false } },
  }, 'cmd-2'));
  assert.equal(edited.catalog.products.at(-1).stockControl.mode, 'recipe');
  assert.throws(() => applyCatalogCommand(edited.catalog, command('product.edit', {
    productId: 'stock-test', changes: { stockControl: { mode: 'mystery', evidence: 'Invalid.', validated: false } },
  }, 'cmd-3')), /invalid stock control mode/);
  assert.throws(() => applyCatalogCommand(edited.catalog, command('product.edit', {
    productId: 'stock-test', changes: { unsupported: true },
  }, 'cmd-4')), /unsupported product edit field unsupported/);
});

test('product edit, reorder and deactivate do not mutate prior catalog or order price snapshots', () => {
  const productId = seed.products[0].id;
  const orderLine = Object.freeze({ productId, name: seed.products[0].name, unit: 50, quantity: 1 });
  const changed = applyCatalogCommand(seed, command('product.edit', {
    productId, changes: { name: 'Nuevo nombre', price: { amountCents: 5001, currency: 'MXN' } },
  }));
  const reordered = applyCatalogCommand(changed.catalog, command('product.reorder', { productId, sortOrder: 7 }, 'cmd-2'));
  const disabled = applyCatalogCommand(reordered.catalog, command('product.setActive', { productId, active: false }, 'cmd-3'));
  assert.equal(seed.products[0].name, 'Americano');
  assert.equal(seed.products[0].price.amountCents, 5000);
  assert.deepEqual(orderLine, { productId, name: 'Americano', unit: 50, quantity: 1 });
  assert.equal(disabled.catalog.products[0].active, false);
  assert.equal(disabled.catalog.products[0].sortOrder, 7);
});

test('retries with same command id are replay safe and changed payloads conflict', () => {
  const first = command('category.create', { category: { id: 'special', name: 'Especial' } });
  const applied = applyCatalogCommand(seed, first);
  const replayed = applyCatalogCommand(applied.catalog, { ...first, category: { name: 'Especial', id: 'special' } });
  assert.equal(replayed.replayed, true);
  assert.notEqual(replayed.catalog, applied.catalog);
  assert.ok(Object.isFrozen(replayed.catalog));
  assert.ok(Object.isFrozen(replayed.catalog.auditEvents[0]));
  assert.equal(replayed.catalog.auditEvents.length, 1);
  assert.throws(() => applyCatalogCommand(applied.catalog, { ...first, category: { id: 'special', name: 'Otro' } }), /already used for a different command/);
  assert.ok(Object.isFrozen(applied.catalog.auditEvents[0]));
});

test('runtime adapter blocks disabled category or product while retaining cents and demo status', () => {
  const disabledCategory = applyCatalogCommand(seed, command('category.setActive', { categoryId: seed.products[0].categoryId, active: false }));
  const adaptedCategory = adaptCatalogForRuntime(disabledCategory.catalog, { sales: [{ id: 'historic' }] });
  assert.equal(adaptedCategory.products[0].available, false);
  assert.equal(adaptedCategory.products[0].priceCents, seed.products[0].price.amountCents);
  assert.equal(adaptedCategory.catalogInfo.demoOnly, true);
  assert.deepEqual(adaptedCategory.sales, [{ id: 'historic' }]);

  const disabledProduct = applyCatalogCommand(seed, command('product.setActive', { productId: seed.products[0].id, active: false }));
  assert.equal(adaptCatalogForRuntime(disabledProduct.catalog).products[0].available, false);
});

test('adapter maps centavo amounts without rounding and validates structure', () => {
  const added = applyCatalogCommand(seed, command('product.create', {
    product: { id: 'cents', name: 'Centavos', categoryId: 'postres', price: { amountCents: 29, currency: 'MXN' } },
  }));
  const runtime = adaptCatalogForRuntime(added.catalog);
  assert.equal(runtime.products.find(({ id }) => id === 'cents').price, 0.29);
  assert.equal(runtime.products.find(({ id }) => id === 'cents').priceCents, 29);
  assert.deepEqual(validateCatalog(added.catalog).errors, []);
  const invalid = structuredClone(added.catalog);
  invalid.products.at(-1).price.amountCents = Number.MAX_SAFE_INTEGER + 1;
  assert.ok(validateCatalog(invalid).errors.some((error) => error.includes('safe integer')));
  assert.throws(() => adaptCatalogForRuntime(invalid), /invalid catalog/);
});

test('runtime adapter applies explicit category and product order with stable id tie breaks', () => {
  const altered = structuredClone(seed);
  altered.categories[0].sortOrder = 3;
  altered.categories[1].sortOrder = 3;
  altered.products[0].sortOrder = 5;
  altered.products[1].sortOrder = 5;
  const runtime = adaptCatalogForRuntime(altered);
  const categoryIds = runtime.categories.map(({ id }) => id);
  assert.ok(categoryIds.indexOf('concafe') > categoryIds.indexOf('frappes'));
  const sortedEqualProducts = altered.products.slice(0, 2).map(({ id }) => id).sort();
  const actualEqualProducts = runtime.products.filter(({ id }) => altered.products.slice(0, 2).some((p) => p.id === id)).map(({ id }) => id);
  assert.deepEqual(actualEqualProducts, sortedEqualProducts);
});

test('modifier groups and options are reusable, ordered, editable and deactivatable', () => {
  const group = applyCatalogCommand(seed, command('modifierGroup.create', {
    group: { id: 'extras-test', name: 'Extras test', selection: { required: false, multiple: false, min: 0, max: 0, defaultOptionId: null, defaultProvenance: 'none' } },
  }));
  const first = applyCatalogCommand(group.catalog, command('modifierOption.create', {
    groupId: 'extras-test', option: { id: 'a', name: 'Primero', sortOrder: 1, priceEffect: { kind: 'fixed-addition', amountCents: 125, currency: 'MXN' } },
  }, 'cmd-2'));
  const second = applyCatalogCommand(first.catalog, command('modifierOption.create', {
    groupId: 'extras-test', option: { id: 'b', name: 'Segundo', priceEffect: { kind: 'fixed-addition', amountCents: 250, currency: 'MXN' } },
  }, 'cmd-3'));
  const configured = applyCatalogCommand(second.catalog, command('modifierGroup.edit', {
    groupId: 'extras-test', changes: { selection: { required: true, multiple: true, min: 1, max: 2, defaultOptionId: 'a', defaultProvenance: 'synthetic-test' } },
  }, 'cmd-4'));
  const productId = seed.products[0].id;
  const assigned = applyCatalogCommand(configured.catalog, command('product.edit', {
    productId, changes: { modifierGroupIds: [...seed.products[0].modifierGroupIds, 'extras-test'] },
  }, 'cmd-5'));
  const reordered = applyCatalogCommand(assigned.catalog, command('modifierOption.reorder', {
    groupId: 'extras-test', optionId: 'b', sortOrder: 0,
  }, 'cmd-6'));
  const renamed = applyCatalogCommand(reordered.catalog, command('modifierOption.edit', {
    groupId: 'extras-test', optionId: 'b', changes: { name: 'Segundo editado' },
  }, 'cmd-7'));
  const deactivated = applyCatalogCommand(renamed.catalog, command('modifierOption.setActive', {
    groupId: 'extras-test', optionId: 'b', active: false,
  }, 'cmd-8'));
  assert.deepEqual(validateCatalog(deactivated.catalog).errors, []);
  const runtime = adaptCatalogForRuntime(deactivated.catalog);
  assert.equal(runtime.modGroups['extras-test'].options[0].id, 'b');
  assert.equal(runtime.modGroups['extras-test'].options[0].active, false);
  assert.throws(() => applyCatalogCommand(deactivated.catalog, command('modifierGroup.reorder', {
    groupId: 'missing', sortOrder: 0,
  }, 'cmd-9')), /modifier group missing does not exist/);
});

test('line capture applies defaults, validates active selection limits, and freezes modifier/charge/note/tax snapshots', () => {
  const group = applyCatalogCommand(seed, command('modifierGroup.create', {
    group: { id: 'charge-test', name: 'Cargo de prueba' },
  }));
  const optionA = applyCatalogCommand(group.catalog, command('modifierOption.create', {
    groupId: 'charge-test', option: { id: 'one', name: 'Extra uno', priceEffect: { kind: 'fixed-addition', amountCents: 75, currency: 'MXN' } },
  }, 'cmd-2'));
  const optionB = applyCatalogCommand(optionA.catalog, command('modifierOption.create', {
    groupId: 'charge-test', option: { id: 'two', name: 'Extra dos', priceEffect: { kind: 'fixed-addition', amountCents: 125, currency: 'MXN' } },
  }, 'cmd-3'));
  const configured = applyCatalogCommand(optionB.catalog, command('modifierGroup.edit', {
    groupId: 'charge-test', changes: { selection: { required: false, multiple: true, min: 0, max: 2, defaultOptionId: null, defaultProvenance: 'none' } },
  }, 'cmd-4'));
  const productId = seed.products[0].id;
  const linked = applyCatalogCommand(configured.catalog, command('product.edit', {
    productId, changes: { modifierGroupIds: [...seed.products[0].modifierGroupIds, 'charge-test'] },
  }, 'cmd-5'));
  const line = captureProductLine(linked.catalog, {
    productId, quantity: 2, selections: { 'charge-test': { optionIds: ['one', 'two'] } }, notes: '  sin canela  ',
    taxSnapshot: { rateBasisPoints: 1600, amountCents: 1628, currency: 'MXN', source: 'synthetic-fixture' },
  });
  assert.equal(line.name, 'Americano');
  assert.equal(line.modifiersTotalCents, 200);
  assert.equal(line.unitPriceCents, 5200);
  assert.equal(line.lineTotalCents, 10400);
  assert.equal(line.notes, 'sin canela');
  assert.deepEqual(line.taxSnapshot, { rateBasisPoints: 1600, amountCents: 1628, currency: 'MXN', source: 'synthetic-fixture' });
  assert.equal(line.modifiers.find(({ optionId }) => optionId === 'one').optionName, 'Extra uno');
  assert.ok(Object.isFrozen(line));
  assert.ok(Object.isFrozen(line.modifiers[0]));
  const changedOption = applyCatalogCommand(linked.catalog, command('modifierOption.edit', {
    groupId: 'charge-test', optionId: 'one', changes: { name: 'Nombre posterior', priceEffect: { kind: 'fixed-addition', amountCents: 900, currency: 'MXN' } },
  }, 'cmd-6'));
  assert.equal(line.modifiers.find(({ optionId }) => optionId === 'one').optionName, 'Extra uno');
  assert.equal(line.modifiersTotalCents, 200);
  assert.equal(changedOption.catalog.modifierGroups.find(({ id }) => id === 'charge-test').options[0].priceEffect.amountCents, 900);
});

test('line capture rejects missing required choices, inactive options, invalid counts and unsafe totals', () => {
  const product = seed.products.find(({ name }) => name === 'Té');
  assert.throws(() => captureProductLine(seed, { productId: product.id, selections: { teVar: { optionIds: [] } } }), /between 1 and 1/);
  assert.throws(() => captureProductLine(seed, { productId: product.id, selections: { teVar: { optionIds: ['missing'] } } }), /missing or inactive/);
  assert.throws(() => captureProductLine(seed, { productId: product.id, selections: { teVar: { optionIds: ['t-negro', 't-verde'] } } }), /between 1 and 1/);
  const inactiveOption = applyCatalogCommand(seed, command('modifierOption.setActive', { groupId: 'teVar', optionId: 't-verde', active: false }));
  assert.throws(() => captureProductLine(inactiveOption.catalog, { productId: product.id, selections: { teVar: { optionIds: ['t-verde'] } } }), /missing or inactive/);
  const unsafe = structuredClone(seed);
  unsafe.products.find(({ id }) => id === product.id).price.amountCents = Number.MAX_SAFE_INTEGER;
  unsafe.products.find(({ id }) => id === product.id).modifierGroupIds = ['shot'];
  unsafe.modifierGroups.find(({ id }) => id === 'shot').options[0].priceEffect.amountCents = 1;
  assert.throws(() => captureProductLine(unsafe, { productId: product.id, selections: { shot: { optionIds: ['amareto'] } } }), /unit price exceeds/);
});

test('ounce measurement groups can declare a two-ounce default without changing seed approval', () => {
  const configured = applyCatalogCommand(seed, command('modifierGroup.create', {
    group: { id: 'espresso-measure-test', name: 'Medida de espresso', selection: { required: false, multiple: false, min: 0, max: 0, defaultOptionId: null, defaultProvenance: 'synthetic-test', unit: 'oz', defaultQuantity: 2 } },
  }));
  const productId = seed.products[0].id;
  const linked = applyCatalogCommand(configured.catalog, command('product.edit', {
    productId, changes: { modifierGroupIds: [...seed.products[0].modifierGroupIds, 'espresso-measure-test'] },
  }, 'cmd-2'));
  const line = captureProductLine(linked.catalog, { productId });
  const espresso = line.modifiers.find(({ groupId }) => groupId === 'espresso-measure-test');
  assert.equal(espresso.quantity, 2);
  assert.equal(espresso.unit, 'oz');
  assert.equal(espresso.priceEffectCents, 0);
  assert.equal(linked.catalog.importGate.readyForValidatedBusinessUse, false);
});

test('duplicate product modifier-group references are rejected before they can double-charge', () => {
  const invalid = structuredClone(seed);
  const coffee = invalid.products.find(({ name }) => name === 'Americano');
  coffee.price.amountCents = 6000;
  coffee.modifierGroupIds = ['leche', 'leche'];
  assert.ok(validateCatalog(invalid).errors.some((error) => error.includes('modifierGroupIds must not contain duplicates')));
  assert.throws(() => captureProductLine(invalid, { productId: coffee.id, selections: { leche: { optionIds: ['deslactosada'] } } }), /modifierGroupIds must not contain duplicates/);

  const product = { id: 'duplicate-groups', name: 'Duplicate groups', categoryId: 'lattes', price: { amountCents: 6000, currency: 'MXN' }, modifierGroupIds: ['leche', 'leche'] };
  assert.throws(() => applyCatalogCommand(seed, command('product.create', { product })), /modifierGroupIds must not contain duplicates/);
  assert.throws(() => applyCatalogCommand(seed, command('product.edit', { productId: seed.products[0].id, changes: { modifierGroupIds: ['leche', 'leche'] } })), /modifierGroupIds must not contain duplicates/);
});
