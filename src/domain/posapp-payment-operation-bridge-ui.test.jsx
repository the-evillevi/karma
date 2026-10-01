// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PosApp from '../PosApp.jsx';
import '../karma-data.js';
import { translatePosAppCapturedPaymentsV1 } from './posapp-payment-operation-bridge-v1.ts';

afterEach(cleanup);
beforeAll(() => { HTMLElement.prototype.scrollIntoView ??= () => {}; });

function memoryStorage(initial) {
  const values = new Map([['karma-pos-v1', JSON.stringify(initial)]]);
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  return storage;
}

it('translates the sale emitted by a mounted PosApp checkout without reconstructing its payment rows', async () => {
  const ticket = {
    folio: 'A-126-BRIDGE-UI', type: 'mesa', ref: 'Mesa 14', time: '12:00', user: 'Sofía',
    prep: 'en-cola', sync: 'sincronizada', name: 'Mesa 14', discount: 0,
    items: [{ prodId: 'concafe-americano', name: 'Americano', qty: 1, mods: {}, modsText: '', notes: '', unit: 60 }],
  };
  const storage = memoryStorage({ session: 'u1', open: [ticket], kitchenTickets: [ticket], sales: [], pending: [] });
  const user = userEvent.setup();
  render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);

  await user.click(await screen.findByRole('button', { name: /Órdenes abiertas/ }));
  await user.click((await screen.findAllByRole('button', { name: 'Cobrar' }))[0]);
  await user.click(await screen.findByRole('button', { name: 'Continuar al pago' }));
  await user.click(screen.getByRole('button', { name: 'Otra' }));
  await user.type(screen.getByRole('textbox', { name: 'Monto de propina en pesos' }), '7.25');
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  await user.dblClick(await screen.findByRole('button', { name: /Registrar pago/ }));
  await screen.findByText('Pago registrado', {}, { timeout: 4000 });

  const capturedState = JSON.parse(storage.getItem('karma-pos-v1'));
  const sale = capturedState.sales.find(entry => entry.folio === ticket.folio);
  const paymentId = sale.payments[0].paymentId;
  expect(sale.payments[0]).toMatchObject({
    paymentId: `${ticket.folio}:payment:1`,
    method: 'cash',
    netAmountCents: 6725,
    amountCents: 6725,
    amount: 67.25,
    tipCents: 725,
    recordMode: 'manual',
    verificationStatus: 'not_applicable',
    cashReceivedCents: 6725,
    changeCents: 0,
  });
  expect(sale.tenders[0]).toMatchObject({
    tenderId: `${ticket.folio}:tender:1`,
    tenderedCents: 6725,
    netAmountCents: 6725,
    changeCents: 0,
    tipCents: 725,
  });

  const expectedFoodNet = sale.lineSnapshots.reduce((sum, line) => sum + line.lineTotalCents, 0);
  expect(expectedFoodNet).toBe(6000);
  const translated = translatePosAppCapturedPaymentsV1(sale, expectedFoodNet);
  expect(translated).toMatchObject({ foodNetCents: 6000, tipCents: 725, totalCents: 6725 });
  expect(translated.payments).toEqual([{
    paymentId,
    method: 'cash',
    netAmountCents: 6000,
    tipCents: 725,
    tenderedCents: 6725,
    changeCents: 0,
    recordMode: 'manual',
    verification: 'not-applicable',
  }]);
});
