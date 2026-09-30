import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleModifierSelection } from './sales-selection.mjs';

test('optional single-choice options can be deselected', () => {
  assert.deepEqual(toggleModifierSelection(['small'], 'small', { min: 0, max: 1 }), []);
  assert.deepEqual(toggleModifierSelection([], 'large', { min: 0, max: 1 }), ['large']);
  assert.deepEqual(toggleModifierSelection(['small'], 'large', { min: 0, max: 1 }), ['large']);
});

test('required and multiple-choice groups retain their limits', () => {
  assert.deepEqual(toggleModifierSelection(['required'], 'required', { min: 1, max: 1 }), ['required']);
  assert.deepEqual(toggleModifierSelection(['a'], 'b', { min: 1, max: 2 }), ['a', 'b']);
  assert.deepEqual(toggleModifierSelection(['a', 'b'], 'c', { min: 1, max: 2 }), ['a', 'b']);
  assert.deepEqual(toggleModifierSelection(['a', 'b'], 'b', { min: 1, max: 2 }), ['a']);
});
