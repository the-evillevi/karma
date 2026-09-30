// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import PosApp from './PosApp.jsx';
import './karma-data.js';

afterEach(cleanup);
const blank = () => ({ folio: null, type: 'local', mesa: '', name: '', items: [], discount: 0 });
function setup(session = 'u1', station = false) {
  const account = { ...structuredClone(window.KARMA.seedOrders[0]), folio: 'A-CANCEL-187', user: 'Original', time: '09:25' };
  const initial = { session, online: false, open: station ? [] : [account], sales: [], pending: [], kitchenTickets: [account], order: station ? { ...account } : blank() };
  const values = new Map([['karma-pos-v1', JSON.stringify(initial)]]);
  let failWrite = false;
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (failWrite) throw new Error('Quota'); values.set(key, String(value)); } };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  const ref = React.createRef();
  const view = render(<PosApp ref={ref} />);
  act(() => ref.current.setState({ loading: false }));
  return { app: ref.current, storage, account, view, read: () => JSON.parse(storage.getItem('karma-pos-v1')), fail: () => { failWrite = true; } };
}
function open(app, station = false) {
  act(() => station ? app.renderVals().cancelOrder() : app.cancelOpen('A-CANCEL-187'));
  return app.state.dlg?.onConfirm;
}
function confirm(callback, reason = 'Cliente corrigió el pedido') {
  let result;
  act(() => { result = callback({ reason }); });
  return result;
}

it.each([false, true])('cancels both entry points with actor, timestamp, snapshots and one audit after retry/reload (station=%s)', station => {
  const { app, read, view } = setup('u2', station);
  const callback = open(app, station);
  confirm(callback);
  const first = read();
  expect(first.sales).toHaveLength(1);
  const sale = first.sales[0];
  expect(sale).toMatchObject({ folio: 'A-CANCEL-187', status: 'cancelada', creo: 'Original', createdTime: '09:25', cancelledById: 'u2', cancelledBy: 'Iván Cabrera', payments: [], motivo: 'Cliente corrigió el pedido' });
  expect(Number.isNaN(Date.parse(sale.cancelledAt))).toBe(false);
  expect(sale.items[0].unit).toBe(first.kitchenTickets[0].items[0].unit);
  expect(sale.items[0].name).toBe(first.kitchenTickets[0].items[0].name);
  expect(sale.audit).toHaveLength(1);
  expect(first.kitchenTickets[0].prep).toBe('cancelada');
  expect(first.open).toHaveLength(0);
  expect(first.order.items).toHaveLength(0);
  confirm(callback);
  expect(read().sales).toHaveLength(1);
  view.unmount();
  const ref = React.createRef();
  render(<PosApp ref={ref} />);
  act(() => ref.current.setState({ loading: false }));
  expect(ref.current.state.sales[0]).toEqual(sale);
});

it.each([false, true])('denies Barra and rechecks changed identity before cancellation (station=%s)', station => {
  const { app, read } = setup('u3', station);
  expect(open(app, station)).toBeFalsy();
  act(() => app.setState({ session: 'u1' }));
  const callback = open(app, station);
  act(() => app.setState({ session: 'u3' }));
  expect(confirm(callback)).toBe('keep');
  expect(read().sales).toHaveLength(0);
  expect(read().kitchenTickets[0].prep).not.toBe('cancelada');
});

it('does not mutate on dismissal, invalid reason, changed account, or storage failure', () => {
  const { app, read, storage, fail } = setup();
  const before = read();
  open(app);
  act(() => app.setState({ dlg: null }));
  expect(read()).toEqual(before);
  const callback = open(app);
  expect(confirm(callback, '  ')).toBe('keep');
  expect(confirm(callback, 'x'.repeat(251))).toBe('keep');
  const newer = { ...before, open: before.open.map(order => ({ ...order, name: 'Otro cliente' })) };
  storage.setItem('karma-pos-v1', JSON.stringify(newer));
  expect(confirm(callback)).toBe('keep');
  expect(read()).toEqual(newer);
  storage.setItem('karma-pos-v1', JSON.stringify(before));
  fail();
  expect(confirm(callback)).toBe('keep');
  expect(app.state.open).toHaveLength(1);
  expect(app.state.sales).toHaveLength(0);
  expect(read()).toEqual(before);
});

it('does not cancel a remotely paid account or overwrite another cancellation', () => {
  const { app, read, storage } = setup();
  const callback = open(app);
  const newer = { ...read(), open: [], sales: [{ folio: 'A-CANCEL-187', status: 'completada' }] };
  storage.setItem('karma-pos-v1', JSON.stringify(newer));
  expect(confirm(callback)).toBe('keep');
  expect(read()).toEqual(newer);
});

it('blocks conflicting accounts and records a previously unsaved station cancellation', () => {
  const { app, read } = setup('u1', true);
  act(() => app.setState({ order: { ...app.state.order, sync: 'conflicto' } }));
  expect(open(app, true)).toBeFalsy();
  act(() => app.up({ order: { ...app.state.order, folio: null, sync: 'pendiente' } }));
  confirm(open(app, true));
  expect(read().sales).toHaveLength(1);
  expect(read().sales[0].folio).toMatch(/^A-\d+$/);
});

it('keeps origin and captured items when an actual saved account is resumed before cancellation', () => {
  const { app, read, account } = setup();
  act(() => app.renderVals().orders[0].resume());
  expect(app.state.open).toHaveLength(0);
  confirm(open(app, true));
  const sale = read().sales[0];
  expect(sale).toMatchObject({ folio: account.folio, creo: 'Original', createdTime: '09:25', status: 'cancelada' });
  expect(sale.items.map(item => [item.name, item.qty, item.unit])).toEqual(account.items.map(item => [item.name, item.qty, item.unit]));
});
