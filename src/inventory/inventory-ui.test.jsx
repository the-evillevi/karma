// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import React from 'react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PosApp from '../PosApp.jsx';
import '../karma-data.js';
import { applyInventoryMovement, validateInventoryState } from './inventory-ledger.mjs';

afterEach(cleanup);

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView ??= () => {};
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
});

function memoryStorage(value = { session: 'u1' }) {
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

function mount() {
  const appRef = React.createRef();
  return { ...render(<PosApp ref={appRef} vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />), appRef };
}

async function openInventory(user) {
  await user.click(await screen.findByRole('button', { name: 'Inventario' }));
  await screen.findByRole('region', { name: 'Existencias y estado del inventario' });
  await waitFor(() => expect(JSON.parse(window.localStorage.getItem('karma-pos-v1')).inventoryState).toBeTruthy());
}

async function fillReason(user, reason = 'Registro de prueba') {
  await user.type(screen.getByRole('textbox', { name: 'Motivo (obligatorio)' }), reason);
}

it('initializes opening balances once, derives low-stock status, and preserves the ledger on reload', async () => {
  const storage = memoryStorage();
  const user = userEvent.setup();
  const first = mount();
  await openInventory(user);

  let persisted = JSON.parse(storage.getItem('karma-pos-v1'));
  expect(persisted.inventoryState.entries).toHaveLength(12);
  expect(persisted.inventoryState.entries.every(event => event.kind === 'opening' && event.syncStatus === 'unverified')).toBe(true);
  expect(screen.getByText('6.5 kg')).toBeTruthy();
  expect(screen.getByText('320 pz')).toBeTruthy();

  const oatRow = screen.getByRole('row', { name: /Leche de avena/ });
  await user.click(within(oatRow).getByRole('button', { name: 'Cambiar mínimo' }));
  await screen.findByRole('dialog', { name: 'Cambiar mínimo de stock' });
  const minimum = screen.getByRole('textbox', { name: 'Nuevo mínimo' });
  await user.clear(minimum);
  await user.type(minimum, '3');
  await fillReason(user, 'Ajuste de umbral revisado');
  await user.click(screen.getByRole('button', { name: 'Registrar' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.entries).toHaveLength(13));
  expect(within(screen.getByRole('row', { name: /Leche de avena/ })).getByText('OK')).toBeTruthy();
  persisted = JSON.parse(storage.getItem('karma-pos-v1'));
  expect(persisted.inventoryState.entries.at(-1)).toMatchObject({ kind: 'threshold', actorId: 'u1', reason: 'Ajuste de umbral revisado', thresholdBaseUnits: 3000 });
  first.unmount();

  const second = mount();
  await openInventory(user);
  persisted = JSON.parse(storage.getItem('karma-pos-v1'));
  expect(persisted.inventoryState.entries).toHaveLength(13);
  expect(persisted.inventoryState.entries.filter(event => event.kind === 'opening')).toHaveLength(12);
  await user.click(screen.getByRole('button', { name: 'Solo stock bajo' }));
  expect(screen.queryByText('Leche de avena')).toBeNull();
  expect(screen.queryByText('Café en grano')).toBeNull();
  second.unmount();
});

it('saves a typed entry with actor, timestamp and reason before reporting success', async () => {
  const storage = memoryStorage();
  const user = userEvent.setup();
  mount();
  await openInventory(user);
  await user.click(screen.getByRole('button', { name: '+ Entrada' }));
  const dialog = await screen.findByRole('dialog', { name: 'Registrar entrada' });
  const quantity = within(dialog).getByRole('textbox', { name: 'Cantidad' });
  await user.type(quantity, '0.5');
  await fillReason(user, 'Compra de prueba');
  await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));

  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.entries).toHaveLength(13));
  const event = JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.entries.at(-1);
  expect(event).toMatchObject({ kind: 'entry', quantityBaseUnits: 500, deltaBaseUnits: 500, unitSnapshot: 'kg', actorId: 'u1', actorName: 'Marcela Ortiz', reason: 'Compra de prueba', syncStatus: 'pending' });
  expect(Date.parse(event.occurredAt)).not.toBeNaN();
  expect(await screen.findByText('7 kg')).toBeTruthy();
});

it('keeps failed writes retryable with the same command id and stores no duplicate movement', async () => {
  const storage = memoryStorage();
  const user = userEvent.setup();
  const view = mount();
  await openInventory(user);
  await user.click(screen.getByRole('button', { name: '+ Entrada' }));
  const dialog = await screen.findByRole('dialog', { name: 'Registrar entrada' });
  await user.type(within(dialog).getByRole('textbox', { name: 'Cantidad' }), '0.25');
  await fillReason(user, 'Reintento local');
  const commandId = view.appRef.current.state.dlg.commandId;
  const retryDialog = view.appRef.current.state.dlg;
  const callback = retryDialog.onConfirm;
  storage.failNextWrites(1);

  await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
  expect(await screen.findByText('No se pudo guardar el movimiento. El formulario sigue abierto; intenta de nuevo.')).toBeTruthy();
  expect(screen.getByRole('dialog', { name: 'Registrar entrada' })).toBeTruthy();
  expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.entries).toHaveLength(12);
  expect(view.appRef.current.state.dlg.commandId).toBe(commandId);

  await user.click(within(screen.getByRole('dialog', { name: 'Registrar entrada' })).getByRole('button', { name: 'Registrar' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.entries).toHaveLength(13));
  await act(async () => callback(retryDialog));
  const saved = JSON.parse(storage.getItem('karma-pos-v1')).inventoryState;
  expect(saved.entries.filter(event => event.commandId === commandId)).toHaveLength(1);
});

it('rejects fractional pieces and oversized or missing reasons in the actual form', async () => {
  const storage = memoryStorage();
  const user = userEvent.setup();
  mount();
  await openInventory(user);
  await user.click(screen.getByRole('button', { name: '+ Entrada' }));
  const dialog = await screen.findByRole('dialog', { name: 'Registrar entrada' });
  await user.click(within(dialog).getByRole('combobox', { name: 'Artículo' }));
  await user.click(await screen.findByRole('option', { name: 'Croissant · Producto terminado' }));
  await user.type(within(dialog).getByRole('textbox', { name: 'Cantidad' }), '1.5');
  await fillReason(user, 'Pieza fraccionaria');
  await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
  expect(await screen.findByText('La cantidad debe respetar la unidad mínima de inventario; las piezas no admiten fracciones.')).toBeTruthy();
  expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.entries).toHaveLength(12);

  await user.clear(within(dialog).getByRole('textbox', { name: 'Cantidad' }));
  await user.type(within(dialog).getByRole('textbox', { name: 'Cantidad' }), '1');
  await user.clear(screen.getByRole('textbox', { name: 'Motivo (obligatorio)' }));
  await user.type(screen.getByRole('textbox', { name: 'Motivo (obligatorio)' }), 'x'.repeat(251));
  await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
  expect(await screen.findByText('Captura un motivo de entre 1 y 250 caracteres.')).toBeTruthy();
  expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.entries).toHaveLength(12);
});

it('rechecks current role and the latest item revision before the write', async () => {
  const storage = memoryStorage();
  const user = userEvent.setup();
  const view = mount();
  await openInventory(user);
  await user.click(screen.getByRole('button', { name: '+ Entrada' }));
  const dialog = await screen.findByRole('dialog', { name: 'Registrar entrada' });
  await user.type(within(dialog).getByRole('textbox', { name: 'Cantidad' }), '0.5');
  await fillReason(user, 'Debe autorizar encargada');
  const before = JSON.parse(storage.getItem('karma-pos-v1'));

  await act(async () => view.appRef.current.setState({ session: 'u3' }));
  await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
  expect(await screen.findByRole('dialog', { name: 'Acción no permitida' })).toBeTruthy();
  expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState).toEqual(before.inventoryState);

  await act(async () => view.appRef.current.setState({ session: 'u1', dlg: null }));
  await act(async () => view.appRef.current.openInventoryDialog('entry', 'i1'));
  const staleDialog = view.appRef.current.state.dlg;
  staleDialog.fields.find(field => field.key === 'quantityText').value = '0.5';
  staleDialog.reason = 'Detectar revisión obsoleta';
  const latest = JSON.parse(storage.getItem('karma-pos-v1'));
  const currentLedger = validateInventoryState(latest.inventoryState);
  const external = applyInventoryMovement(currentLedger, {
    commandId: 'other-tab:entry', itemId: 'i1', kind: 'entry', quantityText: '0.25', unit: 'kg',
    actorId: 'u2', actorName: 'Iván Cabrera', occurredAt: '2026-09-30T12:00:00.000Z', reason: 'Guardado desde otra pestaña', expectedRevision: 0,
  });
  storage.setItem('karma-pos-v1', JSON.stringify({ ...latest, inventoryState: external.state }));
  await act(async () => expect(view.appRef.current.confirmInventoryCommand(staleDialog)).toBe('keep'));
  expect(await screen.findByText('El artículo cambió desde que abriste el formulario. Revisa el saldo y vuelve a intentarlo.')).toBeTruthy();
  expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.entries).toHaveLength(13);
  expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.entries.at(-1).commandId).toBe('other-tab:entry');
});

it('keeps stock queryable for a cashier while adjustment controls remain unavailable', async () => {
  memoryStorage({ session: 'u3' });
  const user = userEvent.setup();
  mount();
  await openInventory(user);
  expect(screen.getByText('6.5 kg')).toBeTruthy();
  expect(screen.getByRole('button', { name: '+ Entrada' }).disabled).toBe(true);
  expect(screen.getAllByRole('button', { name: 'Cambiar mínimo' }).every(button => button.disabled)).toBe(true);
});

it('allows an authorized manager and retries a failed one-time seed initialization safely', async () => {
  const storage = memoryStorage({ session: 'u2' });
  storage.failNextWrites(1);
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole('button', { name: 'Inventario' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState).toBeUndefined();
  await user.click(screen.getByRole('button', { name: 'Reintentar carga de inventario' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.entries).toHaveLength(12));
  expect(screen.getByRole('button', { name: '+ Entrada' }).disabled).toBe(false);
});

it('synchronizes newer saved POS records before a later ordinary save', async () => {
  const storage = memoryStorage();
  const user = userEvent.setup();
  const view = mount();
  await openInventory(user);
  await user.click(screen.getByRole('button', { name: '+ Entrada' }));
  const dialog = await screen.findByRole('dialog', { name: 'Registrar entrada' });
  await user.type(within(dialog).getByRole('textbox', { name: 'Cantidad' }), '0.5');
  await fillReason(user, 'Conservar datos externos');

  const latest = JSON.parse(storage.getItem('karma-pos-v1'));
  latest.sales = [{ folio: 'A-3300', status: 'completada', items: [] }];
  latest.open = [{ folio: 'A-3301', items: [], splitOperations: [] }];
  latest.kitchenTickets = [];
  latest.pending = [];
  latest.order = { folio: 'A-3302', type: 'local', mesa: '', name: 'Borrador de otra pestaña', items: [], discount: 0 };
  latest.orderSettings = { tableCount: 5 };
  latest.folioSeq = 4000;
  storage.setItem('karma-pos-v1', JSON.stringify(latest));

  await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.entries).toHaveLength(13));
  await act(async () => view.appRef.current.up({ invSearch: 'café' }));

  const saved = JSON.parse(storage.getItem('karma-pos-v1'));
  expect(saved.sales).toEqual(latest.sales);
  expect(saved.open).toEqual(latest.open);
  expect(saved.kitchenTickets).toEqual(latest.kitchenTickets);
  expect(saved.pending).toEqual(latest.pending);
  expect(saved.order.name).toBe('Borrador de otra pestaña');
  expect(saved.orderSettings).toEqual({ tableCount: 5 });
  expect(saved.folioSeq).toBe(4000);
});


it('keeps a corrupt saved ledger intact and disables writes instead of reseeding it', async () => {
  const broken = { schemaVersion: 1, revision: 99, items: [], entries: [] };
  const storage = memoryStorage({ session: 'u1', inventoryState: broken });
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole('button', { name: 'Inventario' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: '+ Entrada' }).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Reintentar carga de inventario' }));
  expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState).toEqual(broken);
  expect(screen.getByRole('button', { name: '+ Entrada' }).disabled).toBe(true);
});
