import assert from 'node:assert/strict';
import test from 'node:test';
import { planOrderSplit, suggestSplitSelection } from './order-split.mjs';

test('partial split conserves the order discount and updates captured quantity, total, tax, and notes', () => {
  const order = {
    folio: 'A-1048', discount: 20,
    items: [{
      lineId: '__proto__', prodId: 'latte', name: 'Latte', qty: 2, unit: 50,
      mods: { leche: ['avena'] }, modsText: 'Avena', notes: 'Extra caliente',
      capturedSnapshot: {
        name: 'Latte', quantity: 2, baseUnitPriceCents: 5000, modifiersTotalCents: 0,
        unitPriceCents: 5000, lineTotalCents: 10000,
        modifiers: [{ groupId: 'leche', groupName: 'Leche', optionId: 'avena', optionName: 'Avena', priceEffectCents: 0 }],
        notes: 'Extra caliente',
        taxSnapshot: { rateBasisPoints: 1600, amountCents: 3, currency: 'MXN', source: 'synthetic-test' },
      },
    }],
  };

  const plan = planOrderSplit(order, new Map([['__proto__', 1]]));
  assert.deepEqual({
    sourceSubtotal: plan.sourceSubtotalCents,
    childSubtotal: plan.childSubtotalCents,
    combinedSubtotal: plan.combinedSubtotalCents,
    sourceDiscount: plan.sourceDiscountCents,
    childDiscount: plan.childDiscountCents,
    combinedDiscount: plan.combinedDiscountCents,
    sourceTotal: plan.sourceTotalCents,
    childTotal: plan.childTotalCents,
    combinedTotal: plan.combinedTotalCents,
  }, {
    sourceSubtotal: 5000, childSubtotal: 5000, combinedSubtotal: 10000,
    sourceDiscount: 1000, childDiscount: 1000, combinedDiscount: 2000,
    sourceTotal: 4000, childTotal: 4000, combinedTotal: 8000,
  });
  assert.equal(plan.sourceItems[0].qty, 1);
  assert.equal(plan.childItems[0].qty, 1);
  assert.equal(plan.sourceItems[0].capturedSnapshot.quantity, 1);
  assert.equal(plan.sourceItems[0].capturedSnapshot.lineTotalCents, 5000);
  assert.equal(plan.sourceItems[0].capturedSnapshot.taxSnapshot.amountCents, 1);
  assert.equal(plan.childItems[0].capturedSnapshot.taxSnapshot.amountCents, 2);
  assert.deepEqual(plan.sourceItems[0].capturedSnapshot.modifiers, order.items[0].capturedSnapshot.modifiers);
  assert.deepEqual(plan.childItems[0].mods, order.items[0].mods);
  assert.equal(plan.childItems[0].capturedSnapshot.notes, 'Extra caliente');
  assert.equal(Object.hasOwn(Object.prototype, 'Latte'), false);
});

test('accepts array selections, conserves zero discounts, and proposes partial quantities safely', () => {
  const order = {
    folio: 'A-2', discount: 0,
    items: [{ lineId: 'large-qty', qty: 3, unit: 0.1, name: 'Small item' }],
  };
  const suggestion = suggestSplitSelection(order.items);
  assert.deepEqual([...suggestion], [['large-qty', 2]]);
  const plan = planOrderSplit(order, [{ lineId: 'large-qty', quantity: 1 }]);
  assert.deepEqual([plan.sourceSubtotalCents, plan.childSubtotalCents, plan.combinedSubtotalCents], [20, 10, 30]);
  assert.deepEqual([plan.sourceDiscountCents, plan.childDiscountCents, plan.combinedDiscountCents], [0, 0, 0]);
  assert.deepEqual([plan.sourceTotalCents, plan.childTotalCents, plan.combinedTotalCents], [20, 10, 30]);
  assert.equal(plan.sourceItems[0].qty, 2);
  assert.equal(plan.childItems[0].qty, 1);
});

test('allocates discount rounding deterministically and conserves the original centavo', () => {
  const plan = planOrderSplit({
    discount: 0.01,
    items: [
      { lineId: 'source', qty: 1, unit: 0.33 },
      { lineId: 'child', qty: 1, unit: 0.67 },
    ],
  }, new Map([['child', 1]]));
  assert.deepEqual([plan.sourceDiscountCents, plan.childDiscountCents], [0, 1]);
  assert.equal(plan.sourceDiscountCents + plan.childDiscountCents, 1);
  assert.equal(plan.sourceTotalCents + plan.childTotalCents, 99);
  assert.equal(plan.combinedDiscountCents, 1);
  assert.equal(plan.combinedTotalCents, 99);
});

test('rejects unsafe quantities, malformed captured prices, object-key selections, and empty allocations', () => {
  assert.throws(() => planOrderSplit({ items: [{ lineId: 'a', qty: 0, unit: 1 }] }, new Map([['a', 1]])), /quantities/);
  assert.throws(() => planOrderSplit({ items: [{ lineId: 'a', qty: 1, unit: 1, capturedSnapshot: { unitPriceCents: -1 } }] }, new Map([['a', 1]])), /captured unit price/);
  assert.throws(() => planOrderSplit({ items: [{ lineId: 'a', qty: 1, unit: 1 }] }, { a: 1 }), /Map or an array/);
  assert.throws(() => planOrderSplit({ items: [{ lineId: 'a', qty: 1, unit: 1 }] }, new Map()), /at least one unit/);
  assert.throws(() => planOrderSplit({ items: [{ lineId: 'a', qty: 1, unit: Number.MAX_SAFE_INTEGER / 100 + 1 }] }, new Map([['a', 1]])), /safe|centavos/);
});
