import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMenuPriceCents, saveMenuProduct } from './menu-products.mjs';

test('menu pesos parse to exact safe integer MXN centavos', () => {
  assert.equal(parseMenuPriceCents('0'), 0);
  assert.equal(parseMenuPriceCents('1'), 100);
  assert.equal(parseMenuPriceCents('0.29'), 29);
  assert.equal(parseMenuPriceCents('29.9'), 2990);
  for (const invalid of ['', '-1', '1.001', 'Infinity', '1e2', '90071992547410']) {
    assert.throws(() => parseMenuPriceCents(invalid), /precio/i, `reject ${invalid}`);
  }
});

test('an invalid price cannot be saved, but a persisted invalid row remains repairable', () => {
  const products = [
    { id: 'p-invalid', name: 'Demo defectuoso', cat: 'coffee', price: -1, mods: [], available: true },
    { id: 'p-other', name: 'Otro', cat: 'coffee', price: 2, mods: [], available: true },
  ];
  assert.throws(() => saveMenuProduct(products, 'p-invalid', { name: 'Demo defectuoso', cat: 'coffee', price: '1.001', available: true }), /máximo dos decimales/i);
  assert.equal(products[0].price, -1, 'rejected form leaves existing persisted data untouched');

  const repaired = saveMenuProduct(products, 'p-invalid', { name: 'Demo reparado', cat: 'coffee', price: '0.29', available: true });
  assert.deepEqual(repaired.map((product) => product.price), [0.29, 2]);
  assert.equal(products[0].price, -1, 'save builder does not mutate its input');
});

test('new menu products require a non-blank category and a valid price', () => {
  assert.throws(() => saveMenuProduct([], 'new', { name: 'Nuevo', cat: '', price: '3.00' }, 'new-id'), /categoría/i);
  assert.deepEqual(saveMenuProduct([], 'new', { name: ' Nuevo ', cat: 'coffee', price: '3.00', available: true }, 'new-id'), [
    { id: 'new-id', name: 'Nuevo', cat: 'coffee', price: 3, mods: [], available: true },
  ]);
});
