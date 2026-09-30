// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import React from 'react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PosApp from '../PosApp.jsx';
import '../karma-data.js';
import { posAccessStorageKey } from '../access/pos-storage-key.ts';
import { applyInventoryMovement, validateInventoryState } from './inventory-ledger.mjs';
import { validateRecipeCatalog } from './recipe-ledger.mjs';

afterEach(cleanup);

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView ??= () => {};
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
});

function context(role = 'duena', userId = `auth-${role}`) {
  const now = Date.now();
  return {
    userId,
    displayName: role === 'encargado' ? 'Encargado verificado' : 'Dueña verificada',
    role,
    branchId: 'branch-a',
    deviceId: 'register-a',
    sessionId: `session-${role}`,
    capability: 'cash_register',
    leaseId: `lease-${role}`,
    expiresAt: new Date(now + 60 * 60_000).toISOString(),
    verifiedAt: new Date(now).toISOString(),
  };
}

function installMemoryStorage() {
  const values = new Map();
  let failedWrites = 0;
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => {
      if (failedWrites > 0) { failedWrites -= 1; throw new Error('local storage unavailable'); }
      values.set(String(key), String(value));
    },
    removeItem: key => values.delete(key),
    clear: () => values.clear(),
    failNextWrites: count => { failedWrites = count; },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  return storage;
}

const storageKey = posAccessStorageKey('secure', 'branch-a', 'register-a');
function mount(ref = React.createRef(), access = context()) {
  return {
    ref,
    ...render(<PosApp ref={ref}
      vistaCatalogo="cuadricula"
      mostrarAgotados
      propinaInicial="0"
      accessMode="secure"
      accessStorageKey={storageKey}
      accessBranchId="branch-a"
      accessDeviceId="register-a"
      accessScreen={<main>Inicio seguro</main>}
      accessContext={access}
    />),
  };
}

async function openRecipeEditor(user) {
  await user.click(await screen.findByRole('button', { name: 'Inventario' }));
  await user.click(await screen.findByRole('button', { name: 'Recetas' }));
  await screen.findByText(/Catálogo de productos sin validar/);
  const search = screen.getByRole('textbox', { name: 'Buscar producto' });
  await user.type(search, 'concafe-americano');
  const productCard = screen.getByText('concafe-americano').closest('.rounded-md');
  await user.click(within(productCard).getByRole('button', { name: 'Configurar' }));
  await screen.findByRole('heading', { name: 'Configurar Americano' });
}

async function prepareDraft(user) {
  await user.selectOptions(screen.getByRole('combobox', { name: 'Control de inventario' }), 'recipe');
  await user.type(screen.getByRole('textbox', { name: 'Referencia de configuración' }), 'Receta verificada para prueba de pantalla');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Ingrediente 1' }), 'i1');
  const quantity = screen.getByRole('textbox', { name: 'Ingrediente 1 cantidad' });
  await user.type(quantity, '0.018');
  await user.type(screen.getByRole('textbox', { name: 'Motivo del cambio' }), 'Captura manual de receta para prueba');
  await screen.findByText(/Receta base · una unidad/);
}

it('publishes an explicit recipe by product and item IDs after preview review, preserving an immutable version without consuming stock', async () => {
  const storage = installMemoryStorage();
  const user = userEvent.setup();
  const first = mount();
  await openRecipeEditor(user);
  await prepareDraft(user);
  expect(screen.getByText(/no se usan para asignar ingredientes/)).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('validado');
  const publish = screen.getByRole('button', { name: 'Publicar revisión' });
  expect(publish.disabled).toBe(true);
  await user.click(screen.getByRole('checkbox', { name: 'Revisé las cantidades y advertencias de esta vista previa.' }));
  expect(publish.disabled).toBe(false);

  const inventoryBefore = validateInventoryState(JSON.parse(storage.getItem(storageKey)).inventoryState);
  await user.click(publish);
  await waitFor(() => expect(JSON.parse(storage.getItem(storageKey)).recipeCatalog?.revision).toBe(1));
  const persisted = JSON.parse(storage.getItem(storageKey));
  const recipes = validateRecipeCatalog(persisted.recipeCatalog);
  expect(recipes.events[0].command).toMatchObject({
    productId: 'concafe-americano',
    actorId: 'auth-duena',
    actorName: 'Dueña verificada',
    roleSnapshot: 'duena',
    reason: 'Captura manual de receta para prueba',
  });
  expect(recipes.events[0].after.items[0]).toMatchObject({ itemId: 'i1', itemNameSnapshot: 'Café en grano', quantityBaseUnits: 18, unitSnapshot: 'kg' });
  expect(recipes.events[0].command.preview.automaticConsumptionEligible).toBe(false);
  expect(validateInventoryState(persisted.inventoryState).revision).toBe(inventoryBefore.revision);
  expect(persisted.preparationPlans).toBeUndefined();
  expect(screen.getByText('Versión de receta 1')).toBeTruthy();

  first.unmount();
  const second = mount();
  await user.click(await screen.findByRole('button', { name: 'Inventario' }));
  await user.click(await screen.findByRole('button', { name: 'Recetas' }));
  await user.type(screen.getByRole('textbox', { name: 'Buscar producto' }), 'concafe-americano');
  expect(await screen.findByText('Versión de receta 1')).toBeTruthy();
  expect(second.ref.current.state.recipeCatalog.revision).toBe(1);
});

it('keeps the same recipe command on a failed local write and succeeds on explicit retry without duplicating history', async () => {
  const storage = installMemoryStorage();
  const user = userEvent.setup();
  const app = mount();
  await openRecipeEditor(user);
  await prepareDraft(user);
  await user.click(screen.getByRole('checkbox', { name: 'Revisé las cantidades y advertencias de esta vista previa.' }));
  const commandIds = [];
  const publishRecipe = app.ref.current.confirmRecipePublication;
  app.ref.current.confirmRecipePublication = async function(command) {
    commandIds.push(command.commandId);
    return publishRecipe.call(this, command);
  };
  storage.failNextWrites(1);
  await user.click(screen.getByRole('button', { name: 'Publicar revisión' }));
  expect((await screen.findByRole('alert')).textContent).toContain('No se pudo guardar la receta');
  expect(JSON.parse(storage.getItem(storageKey)).recipeCatalog.revision).toBe(0);
  expect(app.ref.current.state.recipeCatalog.revision).toBe(0);

  await user.click(screen.getByRole('button', { name: 'Publicar revisión' }));
  await waitFor(() => expect(JSON.parse(storage.getItem(storageKey)).recipeCatalog?.events).toHaveLength(1));
  expect(app.ref.current.state.recipeCatalog.revision).toBe(1);
  expect(commandIds).toHaveLength(2);
  expect(commandIds[0]).toBe(commandIds[1]);
  expect(JSON.parse(storage.getItem(storageKey)).recipeCatalog.events[0].command.commandId).toBe(commandIds[0]);
});

it('publishes modifier additions under the exact group and option IDs without applying inventory movements', async () => {
  const storage = installMemoryStorage();
  const user = userEvent.setup();
  mount();
  await openRecipeEditor(user);
  await prepareDraft(user);
  const inventoryBefore = validateInventoryState(JSON.parse(storage.getItem(storageKey)).inventoryState);
  await user.selectOptions(screen.getByRole('combobox', { name: 'Efecto Tipo de leche: Coco' }), 'add');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Artículo que agrega Coco 1' }), 'i2');
  await user.type(screen.getByRole('textbox', { name: 'Artículo que agrega Coco 1 cantidad' }), '0.15');
  await user.click(screen.getByRole('button', { name: 'Agregar otro artículo' }));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Artículo que agrega Coco 2' }), 'i3');
  await user.type(screen.getByRole('textbox', { name: 'Artículo que agrega Coco 2 cantidad' }), '0.025');
  await user.type(screen.getByRole('textbox', { name: 'Motivo del cambio' }), 'Configuración de modificador revisada');
  expect(await screen.findAllByText(/saldo proyectado/)).toHaveLength(4);
  await user.click(screen.getByRole('checkbox', { name: 'Revisé las cantidades y advertencias de esta vista previa.' }));
  await user.click(screen.getByRole('button', { name: 'Publicar revisión' }));

  await waitFor(() => expect(JSON.parse(storage.getItem(storageKey)).recipeCatalog?.events).toHaveLength(1));
  const persisted = JSON.parse(storage.getItem(storageKey));
  const recipe = validateRecipeCatalog(persisted.recipeCatalog).events[0].after;
  const coconut = recipe.modifierEffects.find(effect => effect.groupId === 'leche' && effect.optionId === 'coco');
  expect(coconut.effect).toBe('add');
  expect(coconut.add.map(line => [line.itemId, line.quantityBaseUnits, line.baseUnitSnapshot])).toEqual([
    ['i2', 150, 'ml'],
    ['i3', 25, 'ml'],
  ]);
  expect(persisted.inventoryState.items.find(item => item.itemId === 'i2').revision).toBe(inventoryBefore.items.find(item => item.itemId === 'i2').revision);
  expect(persisted.inventoryState.items.find(item => item.itemId === 'i3').revision).toBe(inventoryBefore.items.find(item => item.itemId === 'i3').revision);
  expect(persisted.preparationPlans).toBeUndefined();
});

it('rejects a stale persisted inventory revision and rechecks current authorization at confirmation', async () => {
  const storage = installMemoryStorage();
  const user = userEvent.setup();
  const app = mount();
  await openRecipeEditor(user);
  await prepareDraft(user);
  await user.click(screen.getByRole('checkbox', { name: 'Revisé las cantidades y advertencias de esta vista previa.' }));
  const persisted = JSON.parse(storage.getItem(storageKey));
  const inventory = validateInventoryState(persisted.inventoryState);
  const current = inventory.items.find(item => item.itemId === 'i1');
  const changed = applyInventoryMovement(inventory, {
    commandId: 'parallel-entry', itemId: 'i1', kind: 'entry', quantityText: '0.001', unit: 'kg',
    actorId: 'auth-manager', actorName: 'Encargado verificado', occurredAt: new Date().toISOString(), reason: 'Cambio en otra pestaña', expectedRevision: current.revision,
  }).state;
  storage.setItem(storageKey, JSON.stringify({ ...persisted, inventoryState: changed }));
  await user.click(screen.getByRole('button', { name: 'Publicar revisión' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Cambió el catálogo o el inventario');
  expect(JSON.parse(storage.getItem(storageKey)).recipeCatalog.revision).toBe(0);

  await act(async () => {
    const fresh = JSON.parse(storage.getItem(storageKey));
    const result = await app.ref.current.confirmRecipePublication({ commandId: 'stale-authority', reason: 'prueba' });
    expect(result.ok).toBe(false);
    expect(fresh.recipeCatalog.revision).toBe(0);
  });
  app.rerender(<PosApp ref={app.ref}
    vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0"
    accessMode="secure" accessStorageKey={storageKey} accessBranchId="branch-a" accessDeviceId="register-a"
    accessScreen={<main>Inicio seguro</main>} accessContext={context('barra', 'auth-barra')}
  />);
  await act(async () => {
    const result = await app.ref.current.confirmRecipePublication({ commandId: 'barista-authority', reason: 'prueba' });
    expect(result.ok).toBe(false);
  });
  expect(JSON.parse(storage.getItem(storageKey)).recipeCatalog.revision).toBe(0);
});

it('fails closed on corrupt saved recipe history and leaves recipe controls read-only for Barra', async () => {
  const storage = installMemoryStorage();
  storage.setItem(storageKey, JSON.stringify({ recipeCatalog: { schemaVersion: 9, recipes: 'bad' } }));
  const user = userEvent.setup();
  const app = mount(React.createRef(), context('barra', 'auth-barra'));
  await user.click(await screen.findByRole('button', { name: 'Inventario' }));
  await user.click(await screen.findByRole('button', { name: 'Recetas' }));
  expect((await screen.findByRole('alert')).textContent).toContain('El historial guardado de recetas no es válido');
  await user.type(screen.getByRole('textbox', { name: 'Buscar producto' }), 'concafe-americano');
  const card = screen.getByText('concafe-americano').closest('.rounded-md');
  expect(within(card).getByRole('button', { name: 'Configurar' }).disabled).toBe(true);
  expect(app.ref.current.state.recipeCatalog).toBeNull();
});

it('allows Encargado to review a recipe but disables the open form and rejects its stale confirmation after access changes to Barra', async () => {
  installMemoryStorage();
  const user = userEvent.setup();
  const app = mount(React.createRef(), context('encargado', 'auth-manager'));
  await openRecipeEditor(user);
  await prepareDraft(user);
  await user.click(screen.getByRole('checkbox', { name: 'Revisé las cantidades y advertencias de esta vista previa.' }));
  expect(app.ref.current.can('adjustInventory')).toBe(true);
  expect(screen.getByRole('button', { name: 'Publicar revisión' }).disabled).toBe(false);

  app.rerender(<PosApp ref={app.ref}
    vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0"
    accessMode="secure" accessStorageKey={storageKey} accessBranchId="branch-a" accessDeviceId="register-a"
    accessScreen={<main>Inicio seguro</main>} accessContext={context('barra', 'auth-barra')}
  />);
  expect((await screen.findByRole('alert')).textContent).toContain('Cambió la identidad');
  expect(screen.getByRole('button', { name: 'Publicar revisión' }).disabled).toBe(true);
  await act(async () => {
    const result = await app.ref.current.confirmRecipePublication({ commandId: 'reassigned', reason: 'prueba' });
    expect(result.ok).toBe(false);
  });
  expect(JSON.parse(window.localStorage.getItem(storageKey)).recipeCatalog.revision).toBe(0);
});
