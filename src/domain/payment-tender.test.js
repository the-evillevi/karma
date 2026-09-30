import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTender, moneyToCents, paymentMethodTotalsCents } from './payment-tender.js';

test('cash tender of 100 for a 50 sale records 50 net and 50 change', () => {
  const result = calculateTender(5000, [{ id: 'cash-1', method: 'efectivo', amount: '100.00' }]);
  assert.equal(result.valid, true);
  assert.equal(result.tenderedCents, 10000);
  assert.equal(result.changeCents, 5000);
  assert.deepEqual(result.payments.map(({ method, tenderedCents, netAmountCents, changeCents, tipCents }) => ({ method, tenderedCents, netAmountCents, changeCents, tipCents })), [
    { method: 'cash', tenderedCents: 10000, netAmountCents: 5000, changeCents: 5000, tipCents: 0 },
  ]);
  assert.deepEqual(paymentMethodTotalsCents([{ payments: [{ method: 'Efectivo', amount: 50, amountCents: 5000, cashReceivedCents: 10000, changeCents: 5000 }] }]), { Efectivo: 5000 });
});

test('exact cash and mixed tenders settle exact net amounts with change only from cash', () => {
  const exact = calculateTender(5000, [{ id: 'cash', method: 'efectivo', amount: '50.00' }]);
  assert.equal(exact.valid, true);
  assert.equal(exact.changeCents, 0);
  assert.equal(exact.payments[0].netAmountCents, 5000);

  const split = calculateTender(10000, [
    { id: 'cash', method: 'efectivo', amount: '75.00' },
    { id: 'card', method: 'tarjeta', amount: '30.00' },
  ]);
  assert.equal(split.valid, true);
  assert.equal(split.changeCents, 500);
  assert.equal(split.payments[0].netAmountCents, 7000);
  assert.equal(split.payments[1].netAmountCents, 3000);
  assert.equal(split.payments[1].changeCents, 0);
  assert.equal(split.payments.reduce((sum, payment) => sum + payment.netAmountCents, 0), 10000);
});

test('multiple cash tender rows return change without making any net row negative', () => {
  const result = calculateTender(5000, [
    { id: 'cash-one', method: 'efectivo', amount: '20.00' },
    { id: 'cash-two', method: 'efectivo', amount: '40.00' },
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.changeCents, 1000);
  assert.deepEqual(result.payments.map(payment => [payment.tenderedCents, payment.netAmountCents, payment.changeCents]), [
    [2000, 1000, 1000],
    [4000, 4000, 0],
  ]);
  assert.ok(result.payments.every(payment => payment.netAmountCents >= 0));
});

test('tips stay separately identified while net payments include the amount due', () => {
  const result = calculateTender(1100, [
    { id: 'cash', method: 'efectivo', amount: '8.00' },
    { id: 'card', method: 'tarjeta', amount: '3.00' },
  ], { tipCents: 100 });
  assert.equal(result.valid, true);
  assert.equal(result.payments.reduce((sum, payment) => sum + payment.netAmountCents, 0), 1100);
  assert.equal(result.payments.reduce((sum, payment) => sum + payment.tipCents, 0), 100);
  assert.equal(result.payments[0].tipCents, 100);
  assert.equal(result.payments[1].tipCents, 0);
});

test('rejects non-cash overpayment, insufficient cash for mixed change, and malformed amounts', () => {
  assert.equal(calculateTender(5000, [{ method: 'tarjeta', amount: '60.00' }]).valid, false);
  assert.equal(calculateTender(10000, [
    { method: 'efectivo', amount: '1.00' },
    { method: 'tarjeta', amount: '104.00' },
  ]).valid, false);
  for (const amount of ['-1.00', '1.001', '1e3', '90071992547409.92']) {
    assert.equal(calculateTender(5000, [{ method: 'efectivo', amount }]).valid, false, amount);
  }
  assert.throws(() => moneyToCents('1.001'), /two decimals/);
  assert.equal(moneyToCents(0.29), 29, 'binary floating representation of an exact cent amount is accepted');
  assert.throws(() => moneyToCents(1.001), /two decimal places/);
});

test('legacy amount-only payments remain readable without guessed historical change', () => {
  const sales = [{ payments: [{ method: 'Efectivo', amount: 100 }] }];
  assert.deepEqual(paymentMethodTotalsCents(sales), { Efectivo: 10000 });
});
