// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PosApp from './PosApp.jsx';
import './karma-data.js';
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
afterEach(() => { cleanup(); if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView; else delete HTMLElement.prototype.scrollIntoView; });
function setup(options = {}) {
  const sale = { folio: 'A-REFUND', day: 0, status: 'completada', total: 50, totalCents: 5000, tip: 0, tipo: 'En local', fecha: 'Hoy', creo: 'Original', cobro: 'Cashier', sync: 'pendiente', items: [{ name: 'Café', qty: 1, total: 50 }], payments: [{ paymentId: 'pay-1', method: 'cash', netAmountCents: 5000, cashReceivedCents: 10000, changeCents: 5000 }], audit: [] };
  Object.assign(sale, options.sale || {});
  const key = options.props?.accessStorageKey || 'karma-pos-v1';
  const values = new Map([[key, JSON.stringify({ session: 'u1', sales: [sale], open: [], kitchenTickets: [], pending: [] })]]);
  let failure = false;
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (failure) throw new Error('Quota'); values.set(key, String(value)); } };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  const ref = React.createRef();
  const view = render(<PosApp ref={ref} {...options.props} />);
  act(() => ref.current.setState({ loading: false }));
  return { app: ref.current, view, read: () => JSON.parse(storage.getItem(key)), storage, fail: next => { failure = next; }, sale };
}
const open = (app, kind = 'refund') => { act(() => app.openSaleCompensation('A-REFUND', kind)); return app.state.dlg?.onConfirm; };
const confirm = (fn, amount = '20', reason = 'Corrección autorizada') => { let result; act(() => { result = fn({ reason, fields: [{ value: amount }] }); }); return result; };

it('records a refund offline once, keeps sale/payment snapshots and displays gross/refunded/net separately', () => {
  const { app, read, sale } = setup();
  const callback = open(app);
  confirm(callback);
  expect(read().sales[0]).toMatchObject({ status: 'completada', total: 50, payments: sale.payments, items: sale.items, compensations: [{ kind: 'refund', amountCents: 2000, actorId: 'u1', reason: 'Corrección autorizada' }] });
  expect(read().pending).toHaveLength(1);
  expect(app.renderVals()).toMatchObject({ repVentas: '$50.00', repRefunds: '$20.00', repNet: '$30.00' });
  confirm(callback);
  expect(read().sales[0].compensations).toHaveLength(1);
  expect(read().pending).toHaveLength(1);
});
it('requires current Dueña/Encargado authority at confirmation and leaves dismissal intact', () => {
  const { app, read } = setup();
  const original = read();
  open(app);
  act(() => app.setState({ dlg: null }));
  expect(read()).toEqual(original);
  const callback = open(app);
  act(() => app.setState({ session: 'u3' }));
  expect(confirm(callback)).toBe('keep');
  expect(read()).toEqual(original);
});
it('preserves history through invalid input, stale source and failed-write retry', () => {
  const { app, read, storage, fail } = setup();
  const callback = open(app);
  const original = read();
  expect(confirm(callback, '51')).toBe('keep');
  expect(confirm(callback, '20', '  ')).toBe('keep');
  fail(true);
  expect(confirm(callback)).toBe('keep');
  expect(read()).toEqual(original);
  expect(app.state.sales[0].compensations).toBeUndefined();
  fail(false);
  storage.setItem('karma-pos-v1', JSON.stringify({ ...original, sales: [{ ...original.sales[0], audit: [['now', 'Otro cambio', 'Other']] }] }));
  expect(confirm(callback)).toBe('keep');
  storage.setItem('karma-pos-v1', JSON.stringify(original));
  confirm(callback);
  expect(read().sales[0].compensations).toHaveLength(1);
});
it('fully voids manually without removing a closed sale or reopening a chargeable account', () => {
  const { app, read } = setup();
  confirm(open(app, 'void'));
  expect(read().sales[0]).toMatchObject({ status: 'completada', total: 50, compensations: [{ kind: 'void', amountCents: 5000 }] });
  expect(read().open).toHaveLength(0);
  expect(read().kitchenTickets).toHaveLength(0);
  expect(app.renderVals()).toMatchObject({ repVentas: '$50.00', repRefunds: '$50.00', repNet: '$0.00', repVoids: 1 });
});
it('exposes the actual report refund flow with a required reason', async () => {
  setup();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Reportes', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Abrir detalle de venta A-REFUND' }));
  await user.click(await screen.findByRole('button', { name: 'Registrar reembolso', exact: true }));
  await user.clear(screen.getByRole('textbox', { name: 'Importe devuelto' }));
  await user.type(screen.getByRole('textbox', { name: 'Importe devuelto' }), '20');
  await user.type(screen.getByRole('textbox', { name: 'Motivo (obligatorio)', exact: true }), 'Corrección autorizada');
  await user.click(screen.getByRole('button', { name: 'Registrar reembolso manual', exact: true }));
  await waitFor(() => expect(screen.getByText('Reembolso manual · $20.00')).toBeTruthy());
});

it('preserves newer unrelated saved work in live state and through the next save, then survives restart', () => {
  const { app, read, storage, view } = setup();
  const callback = open(app);
  const draft = { ...app.blank(), name: 'Nueva captura de otra pestaña', items: [] };
  const openOrder = { folio: 'A-NEWER', type: 'local', items: [], total: 0, prep: 'en-cola', sync: 'pendiente' };
  storage.setItem('karma-pos-v1', JSON.stringify({ ...read(), order: draft, open: [openOrder], folioSeq: 1200, orderSettings: { tableCount: 15 } }));
  confirm(callback);
  expect(app.state.order.name).toBe(draft.name);
  expect(app.state.open).toEqual([openOrder]);
  act(() => app.up({ search: 'unrelated search' }));
  expect(read()).toMatchObject({ order: { name: draft.name }, open: [openOrder], folioSeq: 1200 });
  view.unmount();
  const ref = React.createRef();
  render(<PosApp ref={ref} />);
  expect(ref.current.state.sales[0].compensations).toHaveLength(1);
  expect(ref.current.state.sales[0].payments[0].changeCents).toBe(5000);
});
it('uses the verified identity and scoped record, and rejects a revoked role before confirmation', () => {
  const accessContext = { userId: 'verified-manager', displayName: 'Encargado verificado', role: 'encargado', branchId: 'branch-refund', deviceId: 'register-refund', sessionId: 'test-session', capability: 'cash_register', leaseId: 'test-lease', expiresAt: new Date(Date.now() + 60000).toISOString(), verifiedAt: new Date().toISOString() };
  const props = { accessMode: 'secure', accessStorageKey: 'karma-pos-secure-v1:branch-refund:register-refund', accessBranchId: 'branch-refund', accessDeviceId: 'register-refund', accessContext };
  const { app, read, storage, view } = setup({ props });
  const callback = open(app);
  confirm(callback);
  expect(read().sales[0].compensations[0].actorId).toBe('verified-manager');
  expect(storage.getItem('karma-pos-v1')).toBeNull();
  const second = open(app);
  view.rerender(<PosApp accessMode="secure" {...props} accessContext={{ ...accessContext, role: 'barra' }} />);
  expect(confirm(second, '10')).toBe('keep');
  expect(read().sales[0].compensations).toHaveLength(1);
});

it('requires a specific original payment for a partial mixed refund through the actual selector', async () => {
  // jsdom has no layout/scroll implementation; keep the real selection behavior.
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const { app, read } = setup({ sale: { payments: [{ paymentId: 'cash-part', method: 'cash', netAmountCents: 3000 }, { paymentId: 'card-part', method: 'card', netAmountCents: 2000 }] } });
  const user = userEvent.setup();
  open(app);
  await user.clear(screen.getByRole('textbox', { name: 'Importe devuelto' }));
  await user.type(screen.getByRole('textbox', { name: 'Importe devuelto' }), '10');
  await user.type(screen.getByRole('textbox', { name: 'Motivo (obligatorio)', exact: true }), 'Tarjeta devuelta manualmente');
  await user.click(screen.getByRole('button', { name: 'Registrar reembolso manual', exact: true }));
  expect(read().sales[0].compensations).toBeUndefined();
  const selector = screen.getByRole('combobox', { name: 'Pago devuelto' });
  selector.focus();
  await user.keyboard('{ArrowDown}');
  await user.click(await screen.findByRole('option', { name: 'Tarjeta · pago 2' }));
  await user.click(screen.getByRole('button', { name: 'Registrar reembolso manual', exact: true }));
  await waitFor(() => expect(read().sales[0].compensations?.[0]?.allocations).toEqual([{ paymentId: 'card-part', method: 'card', amountCents: 1000, externalVerification: 'manual_unverified' }]));
});
