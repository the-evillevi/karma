// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PosApp from './PosApp.jsx';
import './karma-data.js';

afterEach(cleanup);

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

function mountStation() {
  return render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
}

it('captures a product by keyboard, updates quantities and restores the saved demo draft', async () => {
  const storage = storageWith({ session: 'u1', online: false });
  const user = userEvent.setup();
  let view = mountStation();
  const search = await screen.findByRole('searchbox', { name: 'Buscar producto' });
  await user.keyboard('/');
  expect(document.activeElement).toBe(search);
  await user.type(search, 'espresso');
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('button', { name: /^Agregar · \$30\.00$/ }));
  await user.click(screen.getByRole('button', { name: 'Aumentar Espresso' }));
  expect(screen.getByRole('button', { name: 'Cobrar $60.00' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Disminuir Espresso' }));
  expect(JSON.parse(storage.getItem('karma-pos-v1')).order.items[0].qty).toBe(1);
  view.unmount();
  view = mountStation();
  expect(await screen.findByRole('button', { name: 'Cobrar $30.00' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Eliminar Espresso' }));
  expect(screen.getByRole('button', { name: 'Cobrar $0.00' })).toBeTruthy();
});

it('keeps an invalid saved price repairable and rejects a new invalid menu save', async () => {
  const products = window.KARMA.products.map((p, i) => i === 0 ? { ...p, price: -1 } : { ...p });
  const storage = storageWith({ session: 'u1', prods: products });
  const user = userEvent.setup();
  mountStation();
  await user.click(await screen.findByRole('button', { name: 'Menú' }));
  await user.click(screen.getByRole('button', { name: /^Americano Con café \$-1\.00 Activo$/ }));
  const price = screen.getByRole('textbox', { name: 'Precio en MXN' });
  await user.clear(price);
  await user.type(price, '1.001');
  await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  expect(await screen.findByText(/El precio debe ser un monto no negativo/)).toBeTruthy();
  expect(JSON.parse(storage.getItem('karma-pos-v1')).prods[0].price).toBe(-1);
  await user.clear(price);
  await user.type(price, '0.29');
  await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).prods[0].price).toBe(0.29));
  expect(screen.getByRole('button', { name: /^Americano Con café \$0\.29 Activo$/ })).toBeTruthy();
});
