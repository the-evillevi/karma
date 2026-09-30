// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import React from 'react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

function mount() {
  return render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
}

async function beginSplit(user) {
  await user.click(await screen.findByRole('button', { name: /Órdenes abiertas/ }));
  await user.click(await screen.findByRole('button', { name: 'Dividir' }));
  await screen.findByRole('region', { name: 'Seleccionar unidades para la cuenta nueva' });
}

it('uses operator-chosen quantities and preserves each captured price, discount, tax, modifiers, notes, and shared preparation', async () => {
  const { source, ticket } = fixture();
  source.discount = 5;
  source.totalCents = 6500;
  source.items = [
    {
      ...source.items[0], qty: 3, unit: 10, modsTextSnapshot: 'Leche de avena',
      capturedSnapshot: { ...source.items[0].capturedSnapshot, quantity: 3, unitPriceCents: 1000, lineTotalCents: 3000, taxSnapshot: { amountCents: 5, rateBasisPoints: 800 } },
      taxSnapshot: { amountCents: 5, rateBasisPoints: 800 },
    },
    {
      lineId: 'captured-tea', prodId: 'tea', name: 'Té de prueba', qty: 2, unit: 20,
      mods: { temperature: ['hot'] }, modsTextSnapshot: 'Caliente', notes: 'Sin limón',
      capturedSnapshot: { productId: 'tea', name: 'Té de prueba', quantity: 2, unitPriceCents: 2000, lineTotalCents: 4000, mods: { temperature: { optionIds: ['hot'] } }, notes: 'Sin limón', taxSnapshot: { amountCents: 7, rateBasisPoints: 800 } },
      taxSnapshot: { amountCents: 7, rateBasisPoints: 800 },
    },
  ];
  const originalTicket = { ...ticket, items: source.items.map(({ lineId, qty, name }) => ({ lineId, qty, name })) };
  const storage = memoryStorage({ session: 'u1', online: false, open: [source], kitchenTickets: [originalTicket], sales: [], pending: [] });
  const user = userEvent.setup();
  mount();
  await beginSplit(user);

  const coffeeQuantity = screen.getByRole('textbox', { name: 'Unidades para la nueva cuenta · Café de prueba · Leche de avena · Sin canela · línea 1' });
  const teaQuantity = screen.getByRole('textbox', { name: 'Unidades para la nueva cuenta · Té de prueba · Caliente · Sin limón · línea 2' });
  await user.clear(coffeeQuantity);
  await user.type(coffeeQuantity, '3');
  await user.clear(teaQuantity);
  await user.type(teaQuantity, '0');

  expect(screen.getByRole('region', { name: 'Asignación de A-2200' }).textContent).toContain('2× Té de prueba · Caliente · Sin limón');
  expect(screen.getByRole('region', { name: 'Asignación de A-1051' }).textContent).toContain('3× Café de prueba · Leche de avena · Sin canela');
  const combined = screen.getByLabelText('Totales combinados');
  expect(combined.textContent).toContain('$70.00');
  expect(combined.textContent).toContain('$5.00');
  expect(combined.textContent).toContain('$65.00');

  await user.click(screen.getByRole('button', { name: 'Dividir cuenta' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).open).toHaveLength(2));
  const saved = JSON.parse(storage.getItem('karma-pos-v1'));
  const sourceNext = saved.open.find(order => order.folio === source.folio);
  const child = saved.open.find(order => order.folio === 'A-1051');
  expect(sourceNext).toMatchObject({ discount: 2.86, totalCents: 3714, preparationFolio: source.folio, sharedPreparation: true });
  expect(child).toMatchObject({ discount: 2.14, totalCents: 2786, preparationFolio: source.folio, sharedPreparation: true });
  expect(sourceNext.items).toHaveLength(1);
  expect(sourceNext.items[0]).toMatchObject({ lineId: 'captured-tea', qty: 2, mods: { temperature: ['hot'] }, modsTextSnapshot: 'Caliente', notes: 'Sin limón', capturedSnapshot: { quantity: 2, unitPriceCents: 2000, lineTotalCents: 4000, taxSnapshot: { amountCents: 7 } } });
  expect(child.items).toHaveLength(1);
  expect(child.items[0]).toMatchObject({ lineId: 'captured-coffee', qty: 3, mods: { milk: ['oat'] }, modsTextSnapshot: 'Leche de avena', notes: 'Sin canela', capturedSnapshot: { quantity: 3, unitPriceCents: 1000, lineTotalCents: 3000, taxSnapshot: { amountCents: 5 } } });
  expect(sourceNext.discount + child.discount).toBe(5);
  expect(sourceNext.totalCents + child.totalCents).toBe(6500);
  expect(sourceNext.splitOperations[0].selection).toEqual([{ lineId: 'captured-coffee', quantity: 3 }]);
  expect(saved.kitchenTickets).toEqual([originalTicket]);
});

it('blocks zero, whole-account, and malformed quantity selections in the actual split dialog', async () => {
  const { source, ticket } = fixture();
  const storage = memoryStorage({ session: 'u1', open: [source], kitchenTickets: [ticket], sales: [], pending: [] });
  const user = userEvent.setup();
  mount();
  await beginSplit(user);
  const baseline = storage.getItem('karma-pos-v1');
  const quantity = screen.getByRole('textbox', { name: 'Unidades para la nueva cuenta · Café de prueba · Leche de avena · Sin canela · línea 1' });
  const confirm = screen.getByRole('button', { name: 'Dividir cuenta' });

  await user.clear(quantity);
  await user.type(quantity, '0');
  expect((await screen.findByRole('alert')).textContent).toContain('Selecciona al menos una unidad para la nueva cuenta.');
  expect(confirm.disabled).toBe(true);

  await user.clear(quantity);
  await user.type(quantity, '2');
  expect((await screen.findByRole('alert')).textContent).toContain('Deja al menos una unidad en la cuenta original.');
  expect(confirm.disabled).toBe(true);

  await user.clear(quantity);
  await user.type(quantity, '1.5');
  expect((await screen.findByRole('alert')).textContent).toContain('Captura cantidades enteras válidas dentro de las unidades disponibles.');
  expect(confirm.disabled).toBe(true);
  expect(storage.getItem('karma-pos-v1')).toBe(baseline);
  expect(JSON.parse(baseline).open).toEqual([source]);
});

it('rejects a source changed after the operator selected quantities without overwriting the newer saved state', async () => {
  const { source, ticket } = fixture();
  source.items[0].qty = 3;
  source.items[0].capturedSnapshot.quantity = 3;
  source.items[0].capturedSnapshot.lineTotalCents = 15000;
  const storage = memoryStorage({ session: 'u1', open: [source], kitchenTickets: [ticket], sales: [], pending: [] });
  const user = userEvent.setup();
  mount();
  await beginSplit(user);
  const quantity = screen.getByRole('textbox', { name: 'Unidades para la nueva cuenta · Café de prueba · Leche de avena · Sin canela · línea 1' });
  await user.clear(quantity);
  await user.type(quantity, '1');

  const newer = JSON.parse(storage.getItem('karma-pos-v1'));
  newer.open[0].responsible = 'Actualizado en otra estación';
  storage.setItem('karma-pos-v1', JSON.stringify(newer));
  const baseline = storage.getItem('karma-pos-v1');
  await user.click(screen.getByRole('button', { name: 'Dividir cuenta' }));

  expect(await screen.findByText('La cuenta cambió mientras se confirmaba la división. Revisa sus versiones antes de continuar.')).toBeTruthy();
  expect(storage.getItem('karma-pos-v1')).toBe(baseline);
  expect(JSON.parse(storage.getItem('karma-pos-v1')).open).toHaveLength(1);
});

it('keeps a chosen quantity retryable after local storage rejects the split write', async () => {
  const { source, ticket } = fixture();
  source.items[0].qty = 3;
  source.items[0].capturedSnapshot.quantity = 3;
  source.items[0].capturedSnapshot.lineTotalCents = 15000;
  const storage = memoryStorage({ session: 'u1', online: false, open: [source], kitchenTickets: [ticket], sales: [], pending: [] });
  const user = userEvent.setup();
  mount();
  await beginSplit(user);
  const quantity = screen.getByRole('textbox', { name: 'Unidades para la nueva cuenta · Café de prueba · Leche de avena · Sin canela · línea 1' });
  await user.clear(quantity);
  await user.type(quantity, '1');
  const baseline = storage.getItem('karma-pos-v1');
  storage.failNextWrites(1);

  await user.click(screen.getByRole('button', { name: 'Dividir cuenta' }));
  expect(await screen.findByText('No se guardó la división; las cuentas siguen intactas. Intenta de nuevo.')).toBeTruthy();
  expect(storage.getItem('karma-pos-v1')).toBe(baseline);
  expect(screen.getByRole('textbox', { name: 'Unidades para la nueva cuenta · Café de prueba · Leche de avena · Sin canela · línea 1' }).value).toBe('1');

  await user.click(screen.getByRole('button', { name: 'Dividir cuenta' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).open).toHaveLength(2));
  const saved = JSON.parse(storage.getItem('karma-pos-v1'));
  expect(saved.open.find(order => order.folio === source.folio).items[0]).toMatchObject({ qty: 2, capturedSnapshot: { quantity: 2, lineTotalCents: 10000 } });
  expect(saved.open.find(order => order.folio === 'A-1051').items[0]).toMatchObject({ qty: 1, capturedSnapshot: { quantity: 1, lineTotalCents: 5000 } });
  expect(saved.open.find(order => order.folio === source.folio).splitOperations[0].selection).toEqual([{ lineId: 'captured-coffee', quantity: 1 }]);
  expect(saved.kitchenTickets).toEqual([ticket]);
});
