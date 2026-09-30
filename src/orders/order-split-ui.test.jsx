// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import React from 'react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PosApp from '../PosApp.jsx';
import '../karma-data.js';

afterEach(cleanup);

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView ??= () => {};
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
});

function memoryStorage(value) {
  const values = new Map([['karma-pos-v1', JSON.stringify(value)]]);
  let failingWrites = 0;
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, nextValue) => {
      if (failingWrites > 0) {
        failingWrites -= 1;
        throw new Error('local storage unavailable');
      }
      values.set(key, String(nextValue));
    },
    removeItem: key => values.delete(key),
    failNextWrites: count => { failingWrites = count; },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  return storage;
}

function fixture() {
  const source = {
    folio: 'A-2200', type: 'local', ref: 'En local', reference: 'En local', time: '10:00',
    user: 'Sofía Delgado', responsible: 'Sofía Delgado', discount: 20, totalCents: 8000,
    sync: 'pendiente', prep: 'preparando',
    items: [{
      lineId: 'captured-coffee', prodId: 'coffee', name: 'Café de prueba', productNameSnapshot: 'Café de prueba',
      qty: 2, unit: 50, mods: { milk: ['oat'] }, modsTextSnapshot: 'Leche de avena', notes: 'Sin canela',
      capturedSnapshot: {
        productId: 'coffee', name: 'Café de prueba', quantity: 2, unitPriceCents: 5000, lineTotalCents: 10000,
        mods: { milk: { optionIds: ['oat'] } }, notes: 'Sin canela',
        taxSnapshot: { amountCents: 3, rateBasisPoints: 800 },
      },
      taxSnapshot: { amountCents: 3, rateBasisPoints: 800 },
    }],
  };
  const ticket = { folio: source.folio, prep: 'preparando', items: [{ lineId: 'captured-coffee', qty: 2, name: 'Café de prueba' }] };
  return { source, ticket };
}

function mount(App = PosApp) {
  const appRef = React.createRef();
  return { ...render(<App ref={appRef} vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />), appRef };
}

async function openOrders(user) {
  await user.click(await screen.findByRole('button', { name: /Órdenes abiertas/ }));
}

it('previews and saves a quantity split while conserving discount, tax, and shared kitchen preparation', async () => {
  const { source, ticket } = fixture();
  const storage = memoryStorage({ session: 'u1', online: false, open: [source], kitchenTickets: [ticket], sales: [], pending: [] });
  const user = userEvent.setup();
  const view = mount();
  await openOrders(user);
  await user.click(await screen.findByRole('button', { name: 'Dividir' }));

  expect(await screen.findByRole('region', { name: 'Vista previa de la división' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Asignación de A-2200' }).textContent).toContain('1× Café de prueba · Leche de avena · Sin canela');
  expect(screen.getByRole('region', { name: 'Asignación de A-1051' }).textContent).toContain('1× Café de prueba · Leche de avena · Sin canela');
  const combined = screen.getByLabelText('Totales combinados');
  expect(combined.textContent).toContain('$100.00');
  expect(combined.textContent).toContain('$20.00');
  expect(combined.textContent).toContain('$80.00');
  expect(screen.getAllByText('−$10.00')).toHaveLength(2);
  expect(screen.getAllByText('$40.00')).toHaveLength(2);

  await user.click(screen.getByRole('button', { name: 'Dividir cuenta' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).open).toHaveLength(2));
  const saved = JSON.parse(storage.getItem('karma-pos-v1'));
  const sourceNext = saved.open.find(order => order.folio === source.folio);
  const child = saved.open.find(order => order.folio === 'A-1051');
  expect(sourceNext).toMatchObject({ discount: 10, totalCents: 4000, preparationFolio: source.folio, sharedPreparation: true });
  expect(child).toMatchObject({ discount: 10, totalCents: 4000, preparationFolio: source.folio, sharedPreparation: true, splitFrom: { folio: source.folio } });
  expect(sourceNext.splitOperations).toHaveLength(1);
  expect(child.splitFrom.operationId).toBe(sourceNext.splitOperations[0].operationId);
  for (const account of [sourceNext, child]) {
    expect(account.items[0]).toMatchObject({
      lineId: 'captured-coffee', qty: 1, mods: { milk: ['oat'] }, modsTextSnapshot: 'Leche de avena', notes: 'Sin canela',
      capturedSnapshot: { quantity: 1, unitPriceCents: 5000, lineTotalCents: 5000, notes: 'Sin canela', taxSnapshot: { amountCents: expect.any(Number) } },
      taxSnapshot: { amountCents: expect.any(Number) },
    });
  }
  expect(sourceNext.items[0].capturedSnapshot.taxSnapshot.amountCents + child.items[0].capturedSnapshot.taxSnapshot.amountCents).toBe(3);
  expect(sourceNext.items[0].taxSnapshot.amountCents + child.items[0].taxSnapshot.amountCents).toBe(3);
  expect(saved.kitchenTickets).toEqual([ticket]);
  expect(saved.folioSeq).toBe(1052);

  await user.click((await screen.findAllByRole('button', { name: 'Abrir' }))[1]);
  expect(view.appRef.current.state.order).toMatchObject({
    folio: child.folio, preparationFolio: source.folio, sharedPreparation: true,
    items: [{ lineId: 'captured-coffee', qty: 1 }],
  });
  await user.click(await screen.findByRole('button', { name: 'Guardar cuenta' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).open[0].folio).toBe(child.folio));
  expect(JSON.parse(storage.getItem('karma-pos-v1')).open[0]).toMatchObject({ preparationFolio: source.folio, sharedPreparation: true });
  expect(JSON.parse(storage.getItem('karma-pos-v1')).kitchenTickets).toEqual([ticket]);

  await openOrders(user);
  await user.click((await screen.findAllByRole('button', { name: 'Cobrar' }))[0]);
  await screen.findByText('Revisa la orden');
  expect(view.appRef.current.state.ck).toMatchObject({ preparationFolio: source.folio, sharedPreparation: true, splitFrom: child.splitFrom });
  expect(view.appRef.current.state.ck.lines[0]).toMatchObject({ lineId: 'captured-coffee', unitPriceCents: 5000, qty: 1, notes: 'Sin canela' });
  await user.click(screen.getByRole('button', { name: 'Continuar al pago' }));
  await screen.findByRole('textbox', { name: 'Monto con Efectivo' });
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  await user.click(screen.getByRole('button', { name: /Registrar pago/ }));
  await screen.findByText('Pago registrado', {}, { timeout: 4000 });
  const paid = JSON.parse(storage.getItem('karma-pos-v1'));
  expect(paid.sales[0]).toMatchObject({
    folio: child.folio, preparationFolio: source.folio, sharedPreparation: true, splitFrom: child.splitFrom,
    lineSnapshots: [{ lineId: 'captured-coffee', qty: 1, unitPriceCents: 5000, lineTotalCents: 5000, notes: 'Sin canela', capturedSnapshot: { taxSnapshot: { amountCents: 2 } } }],
  });
  expect(paid.kitchenTickets).toEqual([ticket]);
});

it('leaves account and folio state untouched when the operator cancels the split preview', async () => {
  const { source, ticket } = fixture();
  const storage = memoryStorage({ session: 'u1', online: false, open: [source], kitchenTickets: [ticket], sales: [], pending: [] });
  const user = userEvent.setup();
  mount();
  await openOrders(user);
  const baseline = storage.getItem('karma-pos-v1');
  await user.click(await screen.findByRole('button', { name: 'Dividir' }));
  await user.click(screen.getByRole('button', { name: 'Volver' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Vista previa de la división' })).toBeNull());
  expect(storage.getItem('karma-pos-v1')).toBe(baseline);
  expect(JSON.parse(storage.getItem('karma-pos-v1')).open).toEqual([source]);
});

it('keeps a failed local write retryable with the same operation identity and never duplicates the child account', async () => {
  const { source, ticket } = fixture();
  const storage = memoryStorage({ session: 'u1', online: false, open: [source], kitchenTickets: [ticket], sales: [], pending: [] });
  const user = userEvent.setup();
  const view = mount();
  await openOrders(user);
  await user.click(await screen.findByRole('button', { name: 'Dividir' }));
  const baseline = storage.getItem('karma-pos-v1');
  const staleConfirmation = view.appRef.current.state.dlg.onConfirm;
  storage.failNextWrites(1);

  await user.click(screen.getByRole('button', { name: 'Dividir cuenta' }));
  expect(await screen.findByText('No se guardó la división; las cuentas siguen intactas. Intenta de nuevo.')).toBeTruthy();
  expect(storage.getItem('karma-pos-v1')).toBe(baseline);
  expect(view.appRef.current.state.open).toHaveLength(1);
  expect(view.appRef.current.state.dlg).not.toBeNull();

  await user.click(screen.getByRole('button', { name: 'Dividir cuenta' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).open).toHaveLength(2));
  await act(async () => staleConfirmation());
  const saved = JSON.parse(storage.getItem('karma-pos-v1'));
  expect(saved.open).toHaveLength(2);
  expect(saved.open.find(order => order.folio === source.folio).splitOperations).toHaveLength(1);
  expect(saved.open.filter(order => order.splitFrom?.folio === source.folio)).toHaveLength(1);
});

it('accepts an identical split retry but rejects changed allocation content under the same operation identity', async () => {
  const { source, ticket } = fixture();
  source.items[0].qty = 3;
  source.items[0].capturedSnapshot.quantity = 3;
  source.items[0].capturedSnapshot.lineTotalCents = 15000;
  ticket.items[0].qty = 3;
  const storage = memoryStorage({ session: 'u1', open: [source], kitchenTickets: [ticket], sales: [], pending: [] });
  const view = mount();
  const app = view.appRef.current;
  const actions = app.renderVals().orders.find(order => order.folio === source.folio);
  act(() => actions.split());
  const retryConfirmation = app.state.dlg.onConfirm;

  await act(async () => expect(retryConfirmation()).toBe(true));
  const firstSave = storage.getItem('karma-pos-v1');
  const firstSaved = JSON.parse(firstSave);
  expect(firstSaved.open).toHaveLength(2);
  expect(firstSaved.open.find(order => order.folio === source.folio).splitOperations[0].selection).toEqual([{ lineId: 'captured-coffee', quantity: 2 }]);

  await act(async () => expect(retryConfirmation()).toBe(true));
  expect(storage.getItem('karma-pos-v1')).toBe(firstSave);

  await act(async () => expect(retryConfirmation({ splitSelection: [{ lineId: 'captured-coffee', quantityText: '1' }] })).toBe('keep'));
  expect(await screen.findByText('Esta identidad de división ya existe con otras cantidades o vínculos. La operación requiere revisión y no se repetirá.')).toBeTruthy();
  expect(storage.getItem('karma-pos-v1')).toBe(firstSave);
  expect(JSON.parse(storage.getItem('karma-pos-v1')).open.filter(order => order.splitFrom?.folio === source.folio)).toHaveLength(1);
});

it('rechecks current authorization and paid status at the confirmation boundary', async () => {
  const { source, ticket } = fixture();
  const storage = memoryStorage({ session: 'u1', open: [source], kitchenTickets: [ticket], sales: [], pending: [] });
  const checkedActions = [];
  class DenyingPosApp extends PosApp {
    requireAction(action) {
      checkedActions.push(action);
      return this.deny ? false : super.requireAction(action);
    }
  }
  const deniedView = mount(DenyingPosApp);
  const actions = deniedView.appRef.current.renderVals().orders.find(order => order.folio === source.folio);
  await act(async () => actions.split());
  deniedView.appRef.current.deny = true;
  const deniedBaseline = storage.getItem('karma-pos-v1');
  await act(async () => expect(deniedView.appRef.current.state.dlg.onConfirm()).toBe('keep'));
  expect(checkedActions).toEqual(['openOrder', 'openOrder']);
  expect(storage.getItem('karma-pos-v1')).toBe(deniedBaseline);
  expect(deniedView.appRef.current.state.open).toEqual([source]);
  deniedView.unmount();

  const paidView = mount();
  const paidActions = paidView.appRef.current.renderVals().orders.find(order => order.folio === source.folio);
  await act(async () => paidActions.split());
  const beforePaidConfirmation = JSON.parse(storage.getItem('karma-pos-v1'));
  storage.setItem('karma-pos-v1', JSON.stringify({
    ...beforePaidConfirmation,
    sales: [{ folio: source.folio, status: 'completada' }],
  }));
  const paidBaseline = storage.getItem('karma-pos-v1');
  await act(async () => expect(paidView.appRef.current.state.dlg.onConfirm()).toBe('keep'));
  expect(storage.getItem('karma-pos-v1')).toBe(paidBaseline);
  expect(paidView.appRef.current.state.open).toEqual([source]);
});

it.each(['state', 'saved record'])('rejects malformed split-operation history in the %s without throwing', async location => {
  const { source, ticket } = fixture();
  const malformedSource = location === 'state' ? { ...source, splitOperations: 'corrupt-history' } : source;
  const storage = memoryStorage({ session: 'u1', open: [malformedSource], kitchenTickets: [ticket], sales: [], pending: [] });
  const view = mount();
  const actions = view.appRef.current.renderVals().orders.find(order => order.folio === source.folio);
  await act(async () => actions.split());
  if (location === 'saved record') {
    const saved = JSON.parse(storage.getItem('karma-pos-v1'));
    saved.open[0].splitOperations = { malformed: true };
    storage.setItem('karma-pos-v1', JSON.stringify(saved));
  }

  await act(async () => expect(view.appRef.current.state.dlg.onConfirm()).toBe('keep'));
  expect(await screen.findByText('No se puede dividir: el historial de divisiones está mal formado y requiere revisión.')).toBeTruthy();
  expect(view.appRef.current.state.open).toEqual([malformedSource]);
});

it('uses the latest stored folio sequence and declines a folio made stale after preview', async () => {
  const { source, ticket } = fixture();
  let storage = memoryStorage({ session: 'u1', open: [source], kitchenTickets: [ticket], sales: [], pending: [], folioSeq: 1051 });
  let view = mount();
  const actions = view.appRef.current.renderVals().orders.find(order => order.folio === source.folio);
  const latest = JSON.parse(storage.getItem('karma-pos-v1'));
  latest.folioSeq = 3000;
  storage.setItem('karma-pos-v1', JSON.stringify(latest));
  await act(async () => actions.split());
  expect(view.appRef.current.state.dlg.splitPreview.childFolio).toBe('A-3000');
  await act(async () => expect(view.appRef.current.state.dlg.onConfirm()).toBe(true));
  expect(JSON.parse(storage.getItem('karma-pos-v1')).folioSeq).toBe(3001);
  expect(JSON.parse(storage.getItem('karma-pos-v1')).open.some(order => order.folio === 'A-3000')).toBe(true);
  view.unmount();

  storage = memoryStorage({ session: 'u1', open: [source], kitchenTickets: [ticket], sales: [], pending: [], folioSeq: 1051 });
  view = mount();
  const staleActions = view.appRef.current.renderVals().orders.find(order => order.folio === source.folio);
  await act(async () => staleActions.split());
  const staleSaved = JSON.parse(storage.getItem('karma-pos-v1'));
  staleSaved.folioSeq = 4000;
  storage.setItem('karma-pos-v1', JSON.stringify(staleSaved));
  const latestBaseline = storage.getItem('karma-pos-v1');
  await act(async () => expect(view.appRef.current.state.dlg.onConfirm()).toBe('keep'));
  expect(storage.getItem('karma-pos-v1')).toBe(latestBaseline);
  expect(view.appRef.current.state.open).toEqual([source]);
  expect(await screen.findByText('El siguiente folio cambió mientras revisabas la división. Cierra esta ventana y vuelve a intentarlo.')).toBeTruthy();
});

it('applies the split to the latest saved state and synchronizes unrelated orders, sales, kitchen work, draft, and settings', async () => {
  const { source, ticket } = fixture();
  const storage = memoryStorage({ session: 'u1', open: [source], kitchenTickets: [ticket], sales: [], pending: [], folioSeq: 1051 });
  const view = mount();
  const actions = view.appRef.current.renderVals().orders.find(order => order.folio === source.folio);
  await act(async () => actions.split());

  const newer = JSON.parse(storage.getItem('karma-pos-v1'));
  const unrelatedOrder = { folio: 'A-3300', type: 'local', reference: 'Otra cuenta', items: [], discount: 0 };
  const unrelatedTicket = { folio: 'A-3301', prep: 'en-cola', items: [] };
  const unrelatedSale = { folio: 'S-3302', status: 'completada', items: [], total: 0, tip: 0, payments: [], cobro: 'Sofía Delgado' };
  const stationDraft = { folio: 'A-3303', type: 'local', items: [{ lineId: 'draft-line', prodId: 'draft', qty: 1, unit: 12 }], discount: 0 };
  newer.open = [source, unrelatedOrder];
  newer.kitchenTickets = [ticket, unrelatedTicket];
  newer.sales = [unrelatedSale];
  newer.order = stationDraft;
  newer.orderSettings = { tableCount: 7 };
  newer.pending = ['Unrelated update'];
  storage.setItem('karma-pos-v1', JSON.stringify(newer));

  await act(async () => expect(view.appRef.current.state.dlg.onConfirm()).toBe(true));
  const saved = JSON.parse(storage.getItem('karma-pos-v1'));
  expect(saved.open.map(order => order.folio)).toEqual([source.folio, 'A-1051', unrelatedOrder.folio]);
  expect(saved.kitchenTickets).toEqual([ticket, unrelatedTicket]);
  expect(saved.sales).toEqual([unrelatedSale]);
  expect(saved.order).toMatchObject(stationDraft);
  expect(saved.orderSettings).toEqual({ tableCount: 7 });
  expect(saved.pending).toEqual(['Unrelated update']);
  expect(view.appRef.current.state.open).toEqual(saved.open);
  expect(view.appRef.current.state.kitchenTickets).toEqual(saved.kitchenTickets);
  expect(view.appRef.current.state.sales).toEqual(saved.sales);
  expect(view.appRef.current.state.order).toMatchObject(stationDraft);
  expect(view.appRef.current.state.orderSettings).toEqual({ tableCount: 7 });
});


it.each([false, true])('keeps original preparation when either split account is cancelled after its sibling is paid (cancel child=%s)', async cancelChild => {
  const { source, ticket } = fixture();
  const storage = memoryStorage({ session: 'u1', open: [source], kitchenTickets: [ticket], sales: [], pending: [] });
  const view = mount();
  const app = view.appRef.current;
  act(() => app.renderVals().orders[0].split());
  act(() => app.state.dlg.onConfirm());
  const child = app.state.open.find(account => account.folio !== source.folio);
  const target = cancelChild ? child : app.state.open.find(account => account.folio === source.folio);
  const sibling = cancelChild ? app.state.open.find(account => account.folio === source.folio) : child;
  act(() => app.up({ open: [target], sales: [{ ...sibling, status: 'completada', payments: [], tip: 0, total: 40, audit: [], cobro: 'Cashier' }], dlg: null }));
  act(() => app.cancelOpen(target.folio));
  act(() => app.state.dlg.onConfirm({ reason: 'Cambio de pedido' }));
  const saved = JSON.parse(storage.getItem('karma-pos-v1'));
  expect(saved.kitchenTickets).toEqual([ticket]);
  expect(saved.sales.find(sale => sale.folio === target.folio)).toMatchObject({ status: 'cancelada', sharedPreparation: true, preparationFolio: source.folio });
  expect(saved.sales.find(sale => sale.folio === sibling.folio).status).toBe('completada');
});


it.each(['order', 'orderSettings'])('rejects a malformed unrelated saved %s instead of crashing or overwriting it', key => {
  const { source, ticket } = fixture();
  const storage = memoryStorage({ session: 'u1', open: [source], kitchenTickets: [ticket], sales: [], pending: [] });
  const view = mount();
  const app = view.appRef.current;
  act(() => app.renderVals().orders[0].split());
  const current = JSON.parse(storage.getItem('karma-pos-v1'));
  current[key] = key === 'order' ? { items: 'invalid' } : { tableCount: 99 };
  const raw = JSON.stringify(current);
  storage.setItem('karma-pos-v1', raw);
  act(() => expect(app.state.dlg.onConfirm()).toBe('keep'));
  expect(storage.getItem('karma-pos-v1')).toBe(raw);
  expect(app.state.open).toHaveLength(1);
});
