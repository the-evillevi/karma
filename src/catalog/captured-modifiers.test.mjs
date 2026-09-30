import test from 'node:test';
import assert from 'node:assert/strict';
import { sameCapturedModifiers } from './captured-modifiers.mjs';

test('compares captured selections without changing their option ordering', () => {
  const before = { leche: ['avena'], extras: ['b', 'a'] };
  assert.equal(sameCapturedModifiers(before, { extras: ['a', 'b'], leche: ['avena'] }), true);
  assert.deepEqual(before.extras, ['b', 'a']);
  assert.equal(sameCapturedModifiers(before, { leche: ['entera'], extras: ['a', 'b'] }), false);
  assert.equal(sameCapturedModifiers({}, { extras: [] }), true);
});

test('rejects reserved storage keys on either side without accessing prototypes', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const tainted = JSON.parse(`{"${key}":["avena"]}`);
    assert.equal(sameCapturedModifiers(tainted, {}), false);
    assert.equal(sameCapturedModifiers({}, tainted), false);
    assert.equal(sameCapturedModifiers(tainted, tainted), false);
  }
  assert.equal(Object.hasOwn(Object.prototype, 'avena'), false);
});

test('rejects inherited and malformed captured selections without throwing', () => {
  for (const value of [null, [], 'leche', { leche: null }, { leche: 'avena' }, { leche: [1] }, Object.create({ leche: ['avena'] })]) {
    assert.equal(sameCapturedModifiers(value, {}), false);
    assert.equal(sameCapturedModifiers({}, value), false);
  }
});
