import assert from 'node:assert/strict';
import test from 'node:test';
import { planSaleCompensation, compensationTotalCents } from './sale-compensation.js';
const sale = () => ({ folio: 'A-CLOSED', status: 'completada', total: 100, totalCents: 10000, payments: [{ paymentId: '__proto__', method: 'cash', netAmountCents: 4000, cashReceivedCents: 10000, changeCents: 6000 }, { paymentId: 'card', method: 'card', netAmountCents: 6000 }], items: [{ name: 'Coffee', qty: 2, unit: 50 }], audit: [], tip: 0 });
const input = patch => ({ commandId: 'refund-1', kind: 'refund', amount: '20.00', paymentId: 'card', reason: 'Pedido corregido', actorId: 'manager', actorName: 'Encargado', occurredAt: '2026-09-30T12:00:00.000Z', ...patch });

test('refunds net payment only, associates the chosen method and preserves immutable sale/tender evidence', () => {
  const original = sale();
  const frozen = structuredClone(original);
  const result = planSaleCompensation(original, input());
  assert.deepEqual(original, frozen);
  assert.deepEqual(result.sale.payments, frozen.payments);
  assert.deepEqual(result.sale.items, frozen.items);
  assert.equal(result.sale.status, 'completada');
  assert.equal(result.sale.totalCents, 10000);
  assert.deepEqual(result.event.allocations, [{ paymentId: 'card', method: 'card', amountCents: 2000, externalVerification: 'manual_unverified' }]);
  assert.equal(result.event.inventoryCompensation, 'pending');
  assert.equal(compensationTotalCents(result.sale), 2000);
  assert.equal(planSaleCompensation(result.sale, input()).changed, false);
  assert.throws(() => planSaleCompensation(result.sale, input({ amount: '21' })), /reused/);
});

test('full void compensates exact original payment nets once without treating returned change as refund', () => {
  const original = sale();
  const result = planSaleCompensation(original, input({ kind: 'void', amount: '100', paymentId: null }));
  assert.deepEqual(result.event.allocations.map(a => a.amountCents), [4000, 6000]);
  assert.equal(compensationTotalCents(result.sale), 10000);
  assert.equal(planSaleCompensation(result.sale, input({ kind: 'void', amount: '100', paymentId: null })).changed, false);
  assert.throws(() => planSaleCompensation(result.sale, input({ commandId: 'second', paymentId: null, amount: '1' })), /remaining/);
});

test('partial refunds require a payment selection for mixed methods and cannot exceed that payment or void an already refunded sale', () => {
  assert.throws(() => planSaleCompensation(sale(), input({ paymentId: null })), /select/);
  assert.throws(() => planSaleCompensation(sale(), input({ amount: '61' })), /allocation/);
  const first = planSaleCompensation(sale(), input());
  assert.throws(() => planSaleCompensation(first.sale, input({ commandId: 'void-after', kind: 'void', amount: '80', paymentId: null })), /whole/);
  const rest = planSaleCompensation(first.sale, input({ commandId: 'rest', amount: '80', paymentId: null }));
  assert.equal(compensationTotalCents(rest.sale), 10000);
});

test('rejects malformed money, history, missing payment reconciliation and unauditable identity', () => {
  assert.throws(() => planSaleCompensation(sale(), input({ amount: '0' })), /remaining/);
  assert.throws(() => planSaleCompensation(sale(), input({ amount: '20.001' })), /decimals|centavos/);
  assert.throws(() => planSaleCompensation(sale(), input({ reason: ' ' })), /reason/);
  assert.throws(() => planSaleCompensation(sale(), input({ actorId: '' })), /identity/);
  assert.throws(() => planSaleCompensation({ ...sale(), totalCents: 9999 }, input()), /reconcile/);
  assert.throws(() => planSaleCompensation({ ...sale(), compensations: {} }, input()), /history/);
  assert.throws(() => planSaleCompensation({ ...sale(), compensations: [{ commandId: 'old', kind: 'refund', occurredAt: '2026-09-30T12:00:00.000Z', amountCents: 1, allocations: [{ paymentId: 'missing', amountCents: 1 }] }] }, input()), /unknown prior/);
  assert.throws(() => planSaleCompensation({ ...sale(), payments: [{ method: 'cash', netAmountCents: -1, amount: 100 }] }, input({ paymentId: null })), /invalid compensation amount/);
});

test('a retry cannot accept a corrupted payment or prior allocation record as successful', () => {
  const valid = planSaleCompensation(sale(), input()).sale;
  assert.throws(() => planSaleCompensation({ ...valid, payments: [null] }, input()), /invalid captured payment/);
  const broken = structuredClone(valid);
  broken.compensations[0].allocations[0].amountCents = 2001;
  assert.throws(() => planSaleCompensation(broken, input()), /reconcile/);
  assert.throws(() => planSaleCompensation({ ...sale(), audit: 'invalid' }, input()), /audit/);
});
