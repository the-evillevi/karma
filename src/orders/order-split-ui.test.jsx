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

it('rechecks current authorization and paid status at the confirmation boundary', async () => {
  const { source, ticket } = fixture();
  const storage = memoryStorage({ session: 'u1', open: [source], kitchenTickets: [ticket], sales: [], pending: [] });
  const checkedActions = [];
  class DenyingPosApp extends PosApp {
    requireAction(action) {
      checkedActions.push(action);
      return false;
    }
  }
  const deniedView = mount(DenyingPosApp);
  const actions = deniedView.appRef.current.renderVals().orders.find(order => order.folio === source.folio);
  await act(async () => actions.split());
  const deniedBaseline = storage.getItem('karma-pos-v1');
  await act(async () => expect(deniedView.appRef.current.state.dlg.onConfirm()).toBe('keep'));
  expect(checkedActions).toEqual(['openOrder']);
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
