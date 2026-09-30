import test from 'node:test';
import assert from 'node:assert/strict';
import { activeKitchenTickets, advanceKitchenTicket, cancelKitchenTicket, upsertKitchenTicket } from './kitchen-queue.js';

const ticket = (overrides = {}) => ({
  folio: 'A-TEST', type: 'mesa', ref: 'Mesa 7', time: '12:00', user: 'Cajera', prep: 'en-cola',
  items: [{ name: 'Americano', qty: 1, modsText: 'Avena +$10', notes: 'Sin canela' }],
  ...overrides,
});

test('refreshing a kitchen ticket keeps preparation progress, original origin, and edited snapshots', () => {
  const original = ticket({ prep: 'preparando', time: '12:00', user: 'Cajera' });
  const next = upsertKitchenTicket([original], ticket({ ref: 'Mesa 8', time: '12:15', user: 'Encargado', items: [{ name: 'Americano', qty: 2, modsText: 'Coco +$10', notes: 'Extra caliente' }] }));
  assert.equal(next.length, 1);
  assert.equal(next[0].prep, 'preparando');
  assert.equal(next[0].time, '12:00');
  assert.equal(next[0].user, 'Cajera');
  assert.equal(next[0].ref, 'Mesa 8');
  assert.deepEqual(next[0].items[0], { name: 'Americano', qty: 2, modsText: 'Coco +$10', notes: 'Extra caliente' });
  assert.equal(original.ref, 'Mesa 7', 'upsert does not mutate the original ticket');
});

test('kitchen lifecycle advances to delivered and ignores stale duplicate actions', () => {
  let tickets = [ticket()];
  tickets = advanceKitchenTicket(tickets, 'A-TEST', 'en-cola');
  assert.equal(tickets[0].prep, 'preparando');
  const duplicate = advanceKitchenTicket(tickets, 'A-TEST', 'en-cola');
  assert.equal(duplicate[0].prep, 'preparando');
  tickets = advanceKitchenTicket(tickets, 'A-TEST', 'preparando');
  tickets = advanceKitchenTicket(tickets, 'A-TEST', 'listo');
  assert.equal(tickets[0].prep, 'entregado');
  assert.deepEqual(activeKitchenTickets(tickets), []);
});

test('authorized cancellation records reason, actor, and time and removes only that ticket from active queue', () => {
  const tickets = [ticket(), ticket({ folio: 'A-DONE', prep: 'entregado' })];
  const cancelled = cancelKitchenTicket(tickets, 'A-TEST', 'Encargado', '2026-09-29T12:30:00.000Z', 'Cliente se retiró');
  assert.equal(cancelled[0].prep, 'cancelada');
  assert.equal(cancelled[0].cancelledBy, 'Encargado');
  assert.equal(cancelled[0].cancelledAt, '2026-09-29T12:30:00.000Z');
  assert.equal(cancelled[0].cancellationReason, 'Cliente se retiró');
  assert.deepEqual(cancelled[0].audit.at(-1), ['2026-09-29T12:30:00.000Z', 'Cancelada · Cliente se retiró', 'Encargado']);
  assert.deepEqual(activeKitchenTickets(cancelled).map((item) => item.folio), []);
  assert.equal(cancelled[1].prep, 'entregado', 'delivery remains terminal');
  assert.throws(() => cancelKitchenTicket(tickets, 'A-TEST', '', 'not-a-date', ''), /actor/);
  assert.throws(() => cancelKitchenTicket(tickets, 'A-TEST', 'Encargado', '2026-09-29T12:30:00.000Z', '  '), /reason/);
});
