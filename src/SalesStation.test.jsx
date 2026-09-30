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

it('exposes and updates selected category and order type through pressed button states', async () => {
  storageWith({ session: 'u1', online: false });
  const user = userEvent.setup();
  mountStation();

  const coffeeCategory = await screen.findByRole('button', { name: 'Con café' });
  const latteCategory = screen.getByRole('button', { name: 'Lattes' });
  expect(coffeeCategory.getAttribute('aria-pressed')).toBe('true');
  expect(latteCategory.getAttribute('aria-pressed')).toBe('false');
  await user.click(latteCategory);
  expect(coffeeCategory.getAttribute('aria-pressed')).toBe('false');
  expect(latteCategory.getAttribute('aria-pressed')).toBe('true');

  const localType = screen.getByRole('button', { name: 'En local' });
  const tableType = screen.getByRole('button', { name: 'Mesa' });
  expect(localType.getAttribute('aria-pressed')).toBe('true');
  expect(tableType.getAttribute('aria-pressed')).toBe('false');
  await user.click(tableType);
  expect(localType.getAttribute('aria-pressed')).toBe('false');
  expect(tableType.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('textbox', { name: 'Número de mesa' })).toBeTruthy();
});

it('restores stable identities for legacy order lines before quantity updates', async () => {
  const seed = window.KARMA.seedOrders[0];
  const originalLines = seed.items.map(item => ({ ...item }));
  const storage = storageWith({ session: 'u1', order: { ...seed, items: originalLines } });
  const user = userEvent.setup();
  mountStation();

  await user.click(await screen.findByRole('button', { name: `Aumentar ${originalLines[0].name}` }));
  const persisted = JSON.parse(storage.getItem('karma-pos-v1')).order.items;
  expect(persisted.map(item => item.lineId)).toHaveLength(originalLines.length);
  expect(new Set(persisted.map(item => item.lineId)).size).toBe(originalLines.length);
  expect(persisted[0].qty).toBe(originalLines[0].qty + 1);
  expect(persisted.slice(1).map(item => item.qty)).toEqual(originalLines.slice(1).map(item => item.qty));
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
