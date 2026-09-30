import { centsToMoney, moneyToCents, paymentNetCents } from './payment-tender.js';

const kinds = new Set(['refund', 'void']);
const methods = new Map([['cash', 'cash'], ['efectivo', 'cash'], ['card', 'card'], ['tarjeta', 'card'], ['transfer', 'transfer'], ['transferencia', 'transfer']]);
const cents = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('invalid compensation amount');
  return value;
};
export function compensationTotalCents(sale) {
  if (sale.compensations != null && !Array.isArray(sale.compensations)) throw new TypeError('invalid compensation history');
  return (sale.compensations || []).reduce((sum, event) => cents(sum + cents(event.amountCents)), 0);
}
export function saleTotalCents(sale) {
  return Object.hasOwn(sale, 'totalCents') ? cents(sale.totalCents) : moneyToCents(sale.total);
}
/** Plan manual financial evidence. Never changes original sale, tender or preparation. */
export function planSaleCompensation(sale, { commandId, kind, amount, paymentId, reason, actorId, actorName, occurredAt }) {
  if (!sale || sale.status !== 'completada') throw new TypeError('only a closed completed sale can be compensated');
  if (!kinds.has(kind) || typeof commandId !== 'string' || !commandId || typeof actorId !== 'string' || !actorId || typeof actorName !== 'string' || !actorName.trim() || !Number.isFinite(Date.parse(occurredAt))) throw new TypeError('invalid compensation identity');
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 250) throw new TypeError('invalid compensation reason');
  if (sale.audit != null && !Array.isArray(sale.audit)) throw new TypeError('invalid sale audit');
  const amountCents = moneyToCents(amount);
  const history = sale.compensations || [];
  const totalCents = saleTotalCents(sale);
  const refundedCents = compensationTotalCents(sale);
  const prior = history.find(event => event.commandId === commandId);
  if (!Array.isArray(sale.payments)) throw new TypeError('missing captured payments');
  const payments = sale.payments.map((payment, index) => {
    if (!payment || typeof payment !== 'object' || Array.isArray(payment)) throw new TypeError('invalid captured payment');
    const method = methods.get(String(payment.method || payment.methodLabel).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
    if (Object.hasOwn(payment, 'netAmountCents')) cents(payment.netAmountCents);
    else if (Object.hasOwn(payment, 'amountCents')) cents(payment.amountCents);
    if (Object.hasOwn(payment, 'paymentId') && (typeof payment.paymentId !== 'string' || !payment.paymentId || payment.paymentId.length > 160)) throw new TypeError('invalid payment identity');
    const netAmountCents = paymentNetCents(payment);
    if (!method || netAmountCents === null) throw new TypeError('unverified payment amount or unsupported method');
    return { paymentId: payment.paymentId || `${sale.folio}:legacy-payment:${index}`, method, netAmountCents };
  });
  if (new Set(payments.map(payment => payment.paymentId)).size !== payments.length) throw new TypeError('duplicate captured payment');
  const collected = payments.reduce((sum, payment) => cents(sum + cents(payment.netAmountCents)), 0);
  if (collected !== totalCents) throw new RangeError('captured payments do not reconcile with the closed sale');
  const remaining = new Map(payments.map(payment => [payment.paymentId, payment.netAmountCents]));
  const seenCommands = new Set();
  for (const event of history) {
    if (!event || !kinds.has(event.kind) || typeof event.commandId !== 'string' || !event.commandId || seenCommands.has(event.commandId) || !Number.isFinite(Date.parse(event.occurredAt))) throw new TypeError('invalid prior compensation');
    seenCommands.add(event.commandId);
    if (!Array.isArray(event.allocations)) throw new TypeError('missing prior payment allocation');
    let allocated = 0;
    for (const entry of event.allocations) {
      if (!remaining.has(entry.paymentId)) throw new TypeError('unknown prior payment');
      const available = remaining.get(entry.paymentId);
      const value = cents(entry.amountCents);
      if (value > available) throw new RangeError('prior refund exceeds payment');
      remaining.set(entry.paymentId, available - value);
      allocated = cents(allocated + value);
    }
    if (allocated !== event.amountCents) throw new RangeError('prior allocation does not reconcile');
  }
  if (prior) {
    if (prior.kind !== kind || prior.amountCents !== amountCents || prior.reason !== reason.trim() || prior.actorId !== actorId || (prior.paymentId || null) !== (paymentId || null)) throw new Error('compensation command reused with different content');
    return { sale, event: prior, changed: false };
  }
  if (amountCents < 1 || amountCents > totalCents - refundedCents) throw new RangeError('compensation exceeds remaining collected amount');
  if (kind === 'void' && (refundedCents !== 0 || amountCents !== totalCents)) throw new RangeError('void requires the whole unrefunded sale');
  const availablePayments = payments.filter(payment => remaining.get(payment.paymentId) > 0);
  if (!paymentId && amountCents !== totalCents - refundedCents && availablePayments.length > 1) throw new RangeError('select the payment being refunded');
  if (paymentId && !remaining.has(paymentId)) throw new TypeError('unknown refund payment');
  let unallocated = amountCents;
  const allocations = [];
  for (const payment of payments) {
    if (paymentId && payment.paymentId !== paymentId) continue;
    const value = Math.min(unallocated, remaining.get(payment.paymentId));
    if (value > 0) allocations.push({ paymentId: payment.paymentId, method: payment.method, amountCents: value, externalVerification: payment.method === 'cash' ? 'not_applicable' : 'manual_unverified' });
    unallocated -= value;
  }
  if (unallocated !== 0) throw new RangeError('refund allocation failed');
  const event = { commandId, kind, paymentId: paymentId || null, amountCents, reason: reason.trim(), actorId, actorName, occurredAt, allocations, recordMode: 'manual', inventoryCompensation: 'pending' };
  return { sale: { ...sale, compensations: [...history, event], sync: 'pendiente', audit: [...(sale.audit || []), [occurredAt, `${kind === 'void' ? 'Anulación' : 'Reembolso'} manual · ${centsToMoney(amountCents).toFixed(2)} · ${event.reason}`, actorName]] }, event, changed: true };
}
