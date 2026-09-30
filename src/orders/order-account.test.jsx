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

function storageWith(value) {
  const values = new Map([['karma-pos-v1', JSON.stringify(value)]]);
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  return storage;
}

function mountStation(App = PosApp) {
  const appRef = React.createRef();
  return { ...render(<App ref={appRef} vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />), appRef };
}

async function addEspresso(user) {
  const search = await screen.findByRole('searchbox', { name: 'Buscar producto' });
  await user.type(search, 'espresso');
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('button', { name: /^Agregar · \$30\.00$/ }));
}

async function navigate(user, label) {
  await user.click(await screen.findByRole('button', { name: new RegExp(label) }));
}

it('saves, reloads and resumes an unpaid delivery account with captured details and prices', async () => {
  const storage = storageWith({ session: 'u3', online: false });
  const user = userEvent.setup();
  let view = mountStation();
  await addEspresso(user);
  await user.click(screen.getByRole('button', { name: 'Domicilio' }));
  await user.type(screen.getByRole('textbox', { name: 'Nombre de quien recibe · obligatorio' }), 'Lucía Reyes');
  await user.type(screen.getByRole('textbox', { name: 'Teléfono · obligatorio' }), '555 123 4567');
  await user.type(screen.getByRole('textbox', { name: 'Dirección · obligatoria' }), 'Av. Siempre Viva 123, Centro');
  await user.click(screen.getByRole('button', { name: 'Guardar cuenta' }));

  const account = JSON.parse(storage.getItem('karma-pos-v1')).open[0];
  expect(account).toMatchObject({
    type: 'domicilio',
    ref: 'Lucía Reyes',
    reference: 'Lucía Reyes',
    responsible: 'Sofía Delgado',
    phone: '555 123 4567',
    address: 'Av. Siempre Viva 123, Centro',
    totalCents: 3000,
  });
  expect(account.time).toBeTruthy();
  expect(account.items[0].unit).toBe(30);
  expect(JSON.parse(storage.getItem('karma-pos-v1')).sales.some(sale => sale.folio === account.folio)).toBe(false);

  view.unmount();
  view = mountStation();
  await navigate(user, 'Órdenes abiertas');
  expect(screen.getByText(/Domicilio · Lucía Reyes · .* · Sofía Delgado/)).toBeTruthy();
  await user.click(screen.getAllByRole('button', { name: 'Abrir' })[0]);
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).order).toMatchObject({
    user: 'Sofía Delgado', responsible: 'Sofía Delgado', time: account.time,
  }));

  expect(screen.getByRole('textbox', { name: 'Nombre de quien recibe · obligatorio' }).value).toBe('Lucía Reyes');
  expect(screen.getByRole('textbox', { name: 'Teléfono · obligatorio' }).value).toBe('555 123 4567');
  const address = screen.getByRole('textbox', { name: 'Dirección · obligatoria' });
  expect(address.value).toBe('Av. Siempre Viva 123, Centro');
  expect(screen.getByRole('button', { name: 'Cobrar $30.00' })).toBeTruthy();

  await user.clear(address);
  await user.click(screen.getByRole('button', { name: 'Cobrar $30.00' }));
  expect(await screen.findByText('Para domicilio captura nombre, teléfono y dirección.')).toBeTruthy();
  await user.type(screen.getByRole('textbox', { name: 'Dirección · obligatoria' }), 'Av. Siempre Viva 123, Centro');
  await user.click(screen.getByRole('button', { name: 'Recoger' }));
  expect(screen.getByRole('textbox', { name: 'Nombre para recoger · obligatorio' }).value).toBe('Lucía Reyes');
  expect(screen.getByRole('textbox', { name: 'Teléfono · obligatorio' }).value).toBe('555 123 4567');
  expect(screen.getByRole('button', { name: 'Cobrar $30.00' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Domicilio' }));
  expect(screen.getByRole('textbox', { name: 'Dirección · obligatoria' }).value).toBe('Av. Siempre Viva 123, Centro');

  await user.click(screen.getByRole('button', { name: 'En local' }));
  await user.click(screen.getByRole('button', { name: 'Cobrar $30.00' }));
  expect(await screen.findByText('Cobro · A-1051')).toBeTruthy();
  expect(JSON.parse(storage.getItem('karma-pos-v1')).order.items[0].unit).toBe(30);
  view.unmount();
});

it('saves decimal legacy line prices as the exact integer-cent total', async () => {
  const storage = storageWith({
    session: 'u3', online: false,
    order: { type: 'local', items: [
      { prodId: 'legacy-ten-cent', name: 'Diez centavos', qty: 1, unit: 0.1, mods: {} },
      { prodId: 'legacy-twenty-cent', name: 'Veinte centavos', qty: 1, unit: 0.2, mods: {} },
    ] },
  });
  const user = userEvent.setup();
  mountStation();
  await user.click(await screen.findByRole('button', { name: 'Guardar cuenta' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).open[0].totalCents).toBe(30));
});

it('rejects an invalid explicit captured price even when a legacy unit field exists', async () => {
  const storage = storageWith({
    session: 'u3', online: false,
    order: { type: 'local', items: [{
      prodId: 'bad-capture', name: 'Precio inválido', qty: 1, unit: 0.1, mods: {},
      capturedSnapshot: { unitPriceCents: -1 },
    }] },
  });
  const user = userEvent.setup();
  mountStation();
  await user.click(await screen.findByRole('button', { name: 'Guardar cuenta' }));
  expect(await screen.findByText(/precio capturado/)).toBeTruthy();
  expect(JSON.parse(storage.getItem('karma-pos-v1')).open || []).toEqual([]);
});

it.each(['Llevar', 'Recoger'])('requires pickup name and phone before saving an unpaid %s account', async type => {
  const storage = storageWith({ session: 'u3', online: false });
  const user = userEvent.setup();
  mountStation();
  await addEspresso(user);
  await user.click(screen.getByRole('button', { name: type }));
  await user.type(screen.getByRole('textbox', { name: 'Nombre para recoger · obligatorio' }), 'Ana Solís');
  await user.click(screen.getByRole('button', { name: 'Enviar comanda' }));
  expect(await screen.findByText('Para recoger captura nombre y teléfono.')).toBeTruthy();
  expect(screen.queryByText(/Comanda undefined enviada/)).toBeNull();
  expect(JSON.parse(storage.getItem('karma-pos-v1')).kitchenTickets).toHaveLength(3);
  await user.click(screen.getByRole('button', { name: 'Guardar cuenta' }));
  expect(screen.getAllByText('Para recoger captura nombre y teléfono.').length).toBeGreaterThan(0);
  expect(JSON.parse(storage.getItem('karma-pos-v1')).open).toHaveLength(3);

  await user.type(screen.getByRole('textbox', { name: 'Teléfono · obligatorio' }), '555 321 7654');
  await user.click(screen.getByRole('button', { name: 'Guardar cuenta' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).open[0]).toMatchObject({
    type: type === 'Llevar' ? 'llevar' : 'recoger', name: 'Ana Solís', phone: '555 321 7654', totalCents: 3000,
  }));
});

it('lets Dueña or Encargado set optional tables and preserves a historical table above the new limit', async () => {
  const storage = storageWith({ session: 'u2', online: false, orderSettings: { tableCount: 8 } });
  const user = userEvent.setup();
  mountStation();
  await navigate(user, 'Usuarios y configuración');
  await user.click(screen.getByRole('button', { name: 'Configuración', exact: true }));
  const count = screen.getByRole('spinbutton', { name: 'Mesas disponibles' });
  await user.clear(count);
  await user.type(count, '2');
  await user.click(screen.getByRole('button', { name: 'Guardar mesas' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).orderSettings.tableCount).toBe(2));

  await navigate(user, 'Punto de venta');
  await user.click(screen.getByRole('button', { name: 'Mesa' }));
  const optionalTable = screen.getByRole('combobox', { name: 'Número de mesa' });
  expect(optionalTable.textContent).toBe('Sin mesa');
  await user.click(optionalTable);
  expect(screen.getByRole('option', { name: 'Sin mesa' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Mesa 1' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Mesa 2' })).toBeTruthy();
  await user.keyboard('{Escape}');

  await navigate(user, 'Órdenes abiertas');
  await user.click(screen.getAllByRole('button', { name: 'Abrir' })[0]);
  const historicalTable = screen.getByRole('combobox', { name: 'Número de mesa' });
  expect(historicalTable.textContent).toBe('Mesa 4 · histórica');
  await user.click(historicalTable);
  expect(screen.getByRole('option', { name: 'Mesa 4 · histórica' })).toBeTruthy();
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Guardar cuenta' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).open.find(entry => entry.folio === 'A-1048').mesa).toBe('4'));
  expect(JSON.parse(storage.getItem('karma-pos-v1')).orderSettings.tableCount).toBe(2);
});

it('checks the current table-configuration authority at save time', async () => {
  const storage = storageWith({ session: 'u2', online: false, orderSettings: { tableCount: 8 } });
  const deniedActions = [];
  class DenyingPosApp extends PosApp {
    requireAction(action) {
      deniedActions.push(action);
      return false;
    }
  }
  const user = userEvent.setup();
  mountStation(DenyingPosApp);
  await navigate(user, 'Usuarios y configuración');
  await user.click(screen.getByRole('button', { name: 'Configuración', exact: true }));
  const count = screen.getByRole('spinbutton', { name: 'Mesas disponibles' });
  await user.clear(count);
  await user.type(count, '2');
  await user.click(screen.getByRole('button', { name: 'Guardar mesas' }));
  expect(deniedActions).toEqual(['configureTables']);
  expect(JSON.parse(storage.getItem('karma-pos-v1')).orderSettings.tableCount).toBe(8);
});

it('keeps conflicting accounts pending and blocks local pseudo-resolution and charging', async () => {
  const conflict = window.KARMA.seedOrders.find(order => order.sync === 'conflicto');
  storageWith({ session: 'u1', open: [conflict], kitchenTickets: [conflict] });
  const user = userEvent.setup();
  mountStation();
  await navigate(user, 'Órdenes abiertas');
  expect(screen.getByText(/Conflicto pendiente: las versiones requieren revisión de sincronización/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Resolver' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Abrir' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Cobrar' }).disabled).toBe(true);
});

it('does not charge through a stale open-order callback after local source removal', async () => {
  const original = { ...window.KARMA.seedOrders.find(order => order.folio === 'A-1048') };
  const storage = storageWith({ session: 'u1', open: [original], kitchenTickets: [original] });
  const view = mountStation();
  const staleCharge = view.appRef.current.renderVals().orders.find(order => order.folio === original.folio).charge;
  storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1', open: [], kitchenTickets: [] }));
  await act(async () => staleCharge());
  expect(view.appRef.current.state.module).toBe('pos');
  expect(view.appRef.current.state.ck).toBeNull();
});

it('rechecks live sources inside previously captured resume, charge, and split confirmations', async () => {
  const original = { ...window.KARMA.seedOrders.find(order => order.folio === 'A-1048') };
  const storage = storageWith({ session: 'u1', open: [original], kitchenTickets: [original] });
  const view = mountStation();
  const oldActions = view.appRef.current.renderVals().orders.find(order => order.folio === original.folio);

  await act(async () => oldActions.split());
  expect(view.appRef.current.state.dlg.title).toBe('Dividir A-1048');

  const conflicted = { ...original, sync: 'conflicto' };
  const next = { session: 'u1', open: [conflicted], kitchenTickets: [conflicted] };
  storage.setItem('karma-pos-v1', JSON.stringify(next));
  await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'karma-pos-v1', newValue: JSON.stringify(next) })));
  await waitFor(() => expect(view.appRef.current.state.open[0].sync).toBe('conflicto'));

  await act(async () => oldActions.resume());
  await act(async () => oldActions.charge());
  await act(async () => view.appRef.current.state.dlg.onConfirm());
  expect(view.appRef.current.state.order.folio).toBeNull();
  expect(view.appRef.current.state.module).toBe('pos');
  expect(view.appRef.current.state.open).toEqual([conflicted]);
  expect(view.appRef.current.state.dlg).not.toBeNull();

  const removed = { session: 'u1', open: [], kitchenTickets: [] };
  storage.setItem('karma-pos-v1', JSON.stringify(removed));
  await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'karma-pos-v1', newValue: JSON.stringify(removed) })));
  await waitFor(() => expect(view.appRef.current.state.open).toEqual([]));
  await act(async () => view.appRef.current.setState({ dlg: null }));
  await act(async () => oldActions.resume());
  await act(async () => oldActions.charge());
  await act(async () => oldActions.split());
  expect(view.appRef.current.state.order.folio).toBeNull();
  expect(view.appRef.current.state.module).toBe('pos');
  expect(view.appRef.current.state.dlg).toBeNull();
});
