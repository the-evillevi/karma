// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import React from 'react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PosApp from '../PosApp.jsx';
import '../karma-data.js';
import { createInventoryItem, validateInventoryState } from './inventory-ledger.mjs';

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
      if (failingWrites > 0) { failingWrites -= 1; throw new Error('local storage unavailable'); }
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

async function selectOption(user, dialog, label, option) {
  await user.click(within(dialog).getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

async function createItem(user, { name = 'Jarabe base', unit = 'kg (kilogramos)', opening = '1.25', threshold = '0.5' } = {}) {
  await user.click(screen.getByRole('button', { name: '+ Artículo' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nuevo artículo' });
  await user.type(within(dialog).getByRole('textbox', { name: 'Nombre del artículo' }), name);
  await selectOption(user, dialog, 'Unidad base y de captura', unit);
  await user.type(within(dialog).getByRole('textbox', { name: 'Existencia contada' }), opening);
  await user.type(within(dialog).getByRole('textbox', { name: 'Mínimo de stock' }), threshold);
  await user.type(within(dialog).getByRole('textbox', { name: 'Motivo (obligatorio)' }), 'Conteo físico inicial');
  return dialog;
}

it('creates a real opening count, edits metadata without rewriting history, and reloads the catalog', async () => {
  const storage = memoryStorage();
  const user = userEvent.setup();
  const first = mount();
  await openInventory(user);
  const dialog = await createItem(user);
  const commandId = first.appRef.current.state.dlg.commandId;
  await user.click(within(dialog).getByRole('button', { name: 'Crear artículo' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.catalogEvents).toHaveLength(1));

  let ledger = validateInventoryState(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState);
  const created = ledger.items.find(item => item.name === 'Jarabe base');
  const opening = ledger.entries.find(entry => entry.commandId === `${commandId}:opening`);
  expect(created).toMatchObject({ baseUnit: 'g', displayUnit: 'kg', provenance: 'operator-count', archived: false });
  expect(opening).toMatchObject({ quantityText: '1.25', quantityBaseUnits: 1250, thresholdText: '0.5', thresholdBaseUnits: 500, actorId: 'u1', actorName: 'Marcela Ortiz', itemNameSnapshot: 'Jarabe base' });
  expect(await screen.findByText('1.25 kg')).toBeTruthy();

  const row = screen.getByRole('row', { name: /Jarabe base/ });
  await user.click(within(row).getByRole('button', { name: 'Editar' }));
  const edit = await screen.findByRole('dialog', { name: 'Editar artículo' });
  const name = within(edit).getByRole('textbox', { name: 'Nombre del artículo' });
  await user.clear(name);
  await user.type(name, 'Jarabe actualizado');
  await selectOption(user, edit, 'Unidad de captura', 'g (gramos)');
  await user.type(within(edit).getByRole('textbox', { name: 'Motivo (obligatorio)' }), 'Corrección de etiqueta');
  await user.click(within(edit).getByRole('button', { name: 'Guardar cambios' }));

  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.catalogEvents).toHaveLength(2));
  ledger = validateInventoryState(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState);
  expect(ledger.items.find(item => item.itemId === created.itemId)).toMatchObject({ name: 'Jarabe actualizado', displayUnit: 'g', baseUnit: 'g' });
  expect(ledger.entries.find(entry => entry.commandId === `${commandId}:opening`)).toMatchObject({ unitSnapshot: 'kg', itemNameSnapshot: 'Jarabe base' });
  expect(await screen.findByText('1250 g')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Movimientos' }));
  expect(await screen.findByText('Artículo creado')).toBeTruthy();
  expect(screen.getByText(/Jarabe base → Jarabe actualizado/)).toBeTruthy();
  first.unmount();

  mount();
  await openInventory(user);
  expect(screen.getByRole('row', { name: /Jarabe actualizado/ })).toBeTruthy();
  expect(screen.getByText('1250 g')).toBeTruthy();
});

it('accepts a zero opening, rejects archiving positive stock, and keeps archived item history visible', async () => {
  const storage = memoryStorage();
  const user = userEvent.setup();
  mount();
  await openInventory(user);

  const coffee = screen.getByRole('row', { name: /Café en grano/ });
  await user.click(within(coffee).getByRole('button', { name: 'Archivar' }));
  let archiveDialog = await screen.findByRole('dialog', { name: 'Archivar artículo' });
  await user.type(within(archiveDialog).getByRole('textbox', { name: 'Motivo (obligatorio)' }), 'Prueba de saldo no disponible');
  await user.click(within(archiveDialog).getByRole('button', { name: 'Archivar' }));
  expect(await screen.findByText('El artículo conserva existencias. Registra o verifica su destino antes de archivarlo.')).toBeTruthy();
  expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.items.find(item => item.itemId === 'i1').archived).toBeUndefined();

  await user.click(within(archiveDialog).getByRole('button', { name: 'Volver' }));
  const zeroItem = await createItem(user, { name: 'Servilletas extra', unit: 'pz (piezas)', opening: '0', threshold: '0' });
  await user.click(within(zeroItem).getByRole('button', { name: 'Crear artículo' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.catalogEvents).toHaveLength(1));
  expect(screen.getByRole('row', { name: /Servilletas extra/ })).toBeTruthy();
  expect(screen.getByRole('row', { name: /Servilletas extra/ }).textContent).toContain('0 pz');

  await user.click(within(screen.getByRole('row', { name: /Servilletas extra/ })).getByRole('button', { name: 'Archivar' }));
  archiveDialog = await screen.findByRole('dialog', { name: 'Archivar artículo' });
  await user.type(within(archiveDialog).getByRole('textbox', { name: 'Motivo (obligatorio)' }), 'Artículo sin existencias');
  await user.click(within(archiveDialog).getByRole('button', { name: 'Archivar' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.catalogEvents).toHaveLength(2));

  const saved = validateInventoryState(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState);
  expect(saved.items.find(item => item.name === 'Servilletas extra')).toMatchObject({ archived: true, provenance: 'operator-count' });
  expect(saved.entries.some(entry => entry.kind === 'opening' && entry.itemNameSnapshot === 'Servilletas extra' && entry.quantityBaseUnits === 0)).toBe(true);
  const archivedRow = screen.getByRole('row', { name: /Servilletas extra/ });
  expect(within(archivedRow).getByText('Archivado')).toBeTruthy();
  expect(within(archivedRow).getByText('Historial conservado')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Movimientos' }));
  expect(await screen.findByText('Artículo archivado')).toBeTruthy();
});

it('keeps create retries idempotent after a local write failure and rechecks role at confirmation', async () => {
  const storage = memoryStorage();
  const user = userEvent.setup();
  const view = mount();
  await openInventory(user);
  let dialog = await createItem(user, { name: 'Té en polvo' });
  const commandId = view.appRef.current.state.dlg.commandId;
  const retryDialog = view.appRef.current.state.dlg;
  storage.failNextWrites(1);
  await user.click(within(dialog).getByRole('button', { name: 'Crear artículo' }));
  expect(await screen.findByText('No se pudo guardar el artículo. El formulario sigue abierto; intenta de nuevo.')).toBeTruthy();
  expect(view.appRef.current.state.dlg.commandId).toBe(commandId);
  expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.catalogEvents).toBeUndefined();
  dialog = screen.getByRole('dialog', { name: 'Nuevo artículo' });
  await user.click(within(dialog).getByRole('button', { name: 'Crear artículo' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.catalogEvents).toHaveLength(1));

  const onConfirm = retryDialog.onConfirm;
  await act(async () => onConfirm(retryDialog));
  expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState.catalogEvents).toHaveLength(1);

  const unchanged = JSON.parse(storage.getItem('karma-pos-v1')).inventoryState;
  await user.click(screen.getByRole('button', { name: '+ Artículo' }));
  dialog = await screen.findByRole('dialog', { name: 'Nuevo artículo' });
  await user.type(within(dialog).getByRole('textbox', { name: 'Nombre del artículo' }), 'No autorizado');
  await user.type(within(dialog).getByRole('textbox', { name: 'Existencia contada' }), '0');
  await user.type(within(dialog).getByRole('textbox', { name: 'Mínimo de stock' }), '0');
  await user.type(within(dialog).getByRole('textbox', { name: 'Motivo (obligatorio)' }), 'Cambio de rol pendiente');
  await act(async () => view.appRef.current.setState({ session: 'u3' }));
  await user.click(within(dialog).getByRole('button', { name: 'Crear artículo' }));
  expect(await screen.findByRole('dialog', { name: 'Acción no permitida' })).toBeTruthy();
  expect(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState).toEqual(unchanged);
});

it('rejects a catalog form opened against a stale source and keeps the newer saved catalog', async () => {
  const storage = memoryStorage();
  const user = userEvent.setup();
  const view = mount();
  await openInventory(user);
  const dialog = await createItem(user, { name: 'Té de jazmín' });
  const stale = view.appRef.current.state.dlg;
  const latest = JSON.parse(storage.getItem('karma-pos-v1'));
  const changed = createInventoryItem(validateInventoryState(latest.inventoryState), {
    commandId: 'external-catalog:1', itemId: 'external:1', kind: 'create', name: 'Artículo externo',
    itemKind: 'Insumo', displayUnit: 'pz', openingQuantityText: '0', thresholdText: '0',
    actorId: 'u2', actorName: 'Iván Cabrera', occurredAt: '2026-09-30T12:00:00.000Z', reason: 'Cambio desde otra estación', expectedCatalogRevision: 0,
  });
  storage.setItem('karma-pos-v1', JSON.stringify({ ...latest, inventoryState: changed.state }));
  stale.reason = 'Formulario obsoleto';
  await act(async () => expect(view.appRef.current.confirmInventoryCatalog(stale)).toBe('keep'));
  expect(await screen.findByText('El catálogo cambió desde que abriste el formulario. Revisa los datos y vuelve a intentarlo.')).toBeTruthy();
  const saved = validateInventoryState(JSON.parse(storage.getItem('karma-pos-v1')).inventoryState);
  expect(saved.items.some(item => item.name === 'Artículo externo')).toBe(true);
  expect(saved.items.some(item => item.name === 'Té de jazmín')).toBe(false);
  expect(saved.catalogEvents).toHaveLength(1);
  expect(screen.getByRole('dialog', { name: 'Nuevo artículo' })).toBeTruthy();
  expect(dialog).toBeTruthy();
});
