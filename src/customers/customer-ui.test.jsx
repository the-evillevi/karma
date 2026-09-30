// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PosApp from '../PosApp.jsx';
import '../karma-data.js';
import { posAccessStorageKey } from '../access/pos-storage-key.ts';
import { createCustomerLedger, planCustomerCommand } from './customer-ledger.mjs';

afterEach(cleanup);

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView ??= () => {};
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
});

function memoryStorage(value = { session: 'u1' }) {
  const values = new Map();
  if (value !== null) values.set('karma-pos-v1', JSON.stringify(value));
  let failingWrites = 0;
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, nextValue) => {
      if (failingWrites > 0) {
        failingWrites -= 1;
        throw new Error('local storage unavailable');
      }
      values.set(String(key), String(nextValue));
    },
    removeItem: key => values.delete(key),
    clear: () => values.clear(),
    failNextWrites: count => { failingWrites = count; },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  return storage;
}

function mountDemo() {
  const appRef = React.createRef();
  return {
    ...render(<PosApp ref={appRef} vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />),
    appRef,
  };
}

function verifiedContext(role = 'duena', overrides = {}) {
  const now = Date.now();
  return {
    userId: `auth-${role}`,
    displayName: role === 'duena' ? 'Dueña verificada' : role === 'encargado' ? 'Encargado verificado' : 'Barra verificada',
    role,
    branchId: 'branch-customers',
    deviceId: 'register-customers',
    sessionId: 'session-customers',
    capability: 'cash_register',
    leaseId: 'lease-customers',
    expiresAt: new Date(now + 60 * 60_000).toISOString(),
    verifiedAt: new Date(now).toISOString(),
    ...overrides,
  };
}

function secureProps(role = 'duena', overrides = {}) {
  return {
    vistaCatalogo: 'cuadricula',
    mostrarAgotados: true,
    propinaInicial: '0',
    accessMode: 'secure',
    accessStorageKey: posAccessStorageKey('secure', 'branch-customers', 'register-customers'),
    accessBranchId: 'branch-customers',
    accessDeviceId: 'register-customers',
    accessScreen: <main>Acceso seguro</main>,
    accessContext: verifiedContext(role),
    ...overrides,
  };
}

function mountSecure(role = 'duena', overrides = {}) {
  const appRef = React.createRef();
  const view = render(<PosApp ref={appRef} {...secureProps(role, overrides)} />);
  return { ...view, appRef, storageKey: secureProps(role).accessStorageKey };
}

async function openCustomers(user) {
  await user.click(await screen.findByRole('button', { name: 'Clientes y cuentas' }));
  await screen.findByRole('heading', { name: 'Clientes y cuentas' });
  await waitFor(() => expect(JSON.parse(localStorage.getItem('karma-pos-v1') || '{}').customerLedger).toBeTruthy());
}

async function confirmDialog(user, label) {
  const dialog = screen.getByRole('dialog');
  const reason = within(dialog).getByRole('textbox', { name: 'Motivo (obligatorio)' });
  if (!reason.value) await user.type(reason, 'Registro operativo revisado');
  await user.click(within(dialog).getByRole('button', { name: label }));
}

function accountLedgerWithDebt() {
  const owner = { actorId: 'owner-source', actorName: 'Dueña anterior', role: 'duena' };
  const run = (ledger, command) => planCustomerCommand(ledger, {
    actorName: owner.actorName,
    occurredAt: '2026-09-29T10:00:00.000Z',
    reason: 'Saldo de cuenta previamente registrado',
    ...command,
  }, owner).ledger;
  let ledger = run(createCustomerLedger(), {
    commandId: 'customer-fixture:create', customerId: 'customer-fixture', kind: 'profile.create',
    expectedRevision: 0, actorId: owner.actorId, roleSnapshot: owner.role,
    payload: { name: 'Ana García', phone: '555-0100' },
  });
  ledger = run(ledger, {
    commandId: 'customer-fixture:limit', customerId: 'customer-fixture', kind: 'credit.limit',
    expectedRevision: 1, actorId: owner.actorId, roleSnapshot: owner.role,
    payload: { limitCents: 10000 },
  });
  ledger = run(ledger, {
    commandId: 'customer-fixture:charge', customerId: 'customer-fixture', kind: 'debt.charge',
    expectedRevision: 2, actorId: owner.actorId, roleSnapshot: owner.role,
    payload: { amountCents: 5000, saleId: 'sale-fixture-1', paymentId: null },
  });
  return ledger;
}

it('creates and updates a customer profile, keeps its prior statement events, and reloads locally', async () => {
  const storage = memoryStorage();
  const user = userEvent.setup();
  const first = mountDemo();
  await openCustomers(user);

  await user.click(screen.getByRole('button', { name: '+ Nuevo perfil' }));
  const create = await screen.findByRole('dialog', { name: 'Nuevo perfil de cliente' });
  await user.type(within(create).getByRole('textbox', { name: 'Nombre para mostrar' }), 'Ana García');
  await user.type(within(create).getByRole('textbox', { name: 'Teléfono (opcional)' }), '555-0100');
  await confirmDialog(user, 'Crear perfil');
  await screen.findByRole('row', { name: /Ana García/ });

  const row = screen.getByRole('row', { name: /Ana García/ });
  await user.click(within(row).getByRole('button', { name: 'Editar perfil' }));
  const edit = await screen.findByRole('dialog', { name: 'Editar perfil de cliente' });
  const name = within(edit).getByRole('textbox', { name: 'Nombre para mostrar' });
  await user.clear(name);
  await user.type(name, 'Ana López');
  await confirmDialog(user, 'Guardar cambios');

  await screen.findByText('Estado de cuenta · Ana López');
  let ledger = JSON.parse(storage.getItem('karma-pos-v1')).customerLedger;
  expect(ledger.events.map(event => [event.kind, event.payload.name])).toEqual([
    ['profile.create', 'Ana García'],
    ['profile.update', 'Ana López'],
  ]);
  expect(ledger.events[0].actorId).toBe('u1');
  expect(ledger.events[1].reason).toBe('Registro operativo revisado');
  first.unmount();

  const second = mountDemo();
  await openCustomers(user);
  await screen.findByRole('row', { name: /Ana López/ });
  await user.click(within(screen.getByRole('row', { name: /Ana López/ })).getByRole('button', { name: 'Estado de cuenta' }));
  await screen.findByRole('region', { name: 'Movimientos de la cuenta de Ana López' });
  ledger = JSON.parse(storage.getItem('karma-pos-v1')).customerLedger;
  expect(ledger.events).toHaveLength(2);
  second.unmount();
});

it('lets a manager record manual debt payment and prepaid receipt with explicit unverified provenance', async () => {
  const key = posAccessStorageKey('secure', 'branch-customers', 'register-customers');
  const storage = memoryStorage(null);
  storage.setItem(key, JSON.stringify({ customerLedger: accountLedgerWithDebt() }));
  const user = userEvent.setup();
  const managerView = mountSecure('encargado');
  await user.click(await screen.findByRole('button', { name: 'Clientes y cuentas' }));
  await screen.findByRole('heading', { name: 'Clientes y cuentas' });

  const row = await screen.findByRole('row', { name: /Ana García/ });
  expect(within(row).queryByRole('button', { name: 'Límite de crédito' })).toBeNull();
  await user.click(within(row).getByRole('button', { name: 'Registrar pago de deuda' }));
  const repayment = await screen.findByRole('dialog', { name: 'Registrar pago de deuda' });
  await user.type(within(repayment).getByRole('textbox', { name: 'Importe recibido (MXN)' }), '12.50');
  await user.type(within(repayment).getByRole('textbox', { name: 'Referencia del pago' }), 'recibo-38');
  await user.click(within(repayment).getByRole('combobox', { name: 'Forma recibida' }));
  await user.click(await screen.findByRole('option', { name: 'Transferencia' }));
  await confirmDialog(user, 'Registrar pago');

  await screen.findByText(/Transferencia · recibo-38 · externo sin verificar/);
  let saved = JSON.parse(storage.getItem(key)).customerLedger;
  expect(saved.events.at(-1)).toMatchObject({
    kind: 'debt.repayment', actorId: 'auth-encargado', roleSnapshot: 'encargado',
    payload: { amountCents: 1250, saleId: null, paymentId: 'recibo-38', paymentMethod: 'transfer', receiptStatus: 'operator_reported_unverified' },
  });
  expect(screen.getAllByText('$37.50').length).toBeGreaterThan(0);

  await user.click(within(screen.getByRole('row', { name: /Ana García/ })).getByRole('button', { name: 'Registrar saldo prepago' }));
  const deposit = await screen.findByRole('dialog', { name: 'Registrar saldo prepago recibido' });
  await user.type(within(deposit).getByRole('textbox', { name: 'Importe recibido (MXN)' }), '20.00');
  await user.type(within(deposit).getByRole('textbox', { name: 'Referencia del pago' }), 'recibo-39');
  await confirmDialog(user, 'Registrar pago');

  saved = JSON.parse(storage.getItem(key)).customerLedger;
  expect(saved.events.at(-1).payload).toMatchObject({
    amountCents: 2000, paymentId: 'recibo-39', paymentMethod: 'cash', receiptStatus: 'operator_reported_unverified',
  });
  expect(screen.getAllByText('$20.00').length).toBeGreaterThan(0);

  await user.click(within(screen.getByRole('row', { name: /Ana García/ })).getByRole('button', { name: 'Archivar perfil' }));
  await confirmDialog(user, 'Archivar perfil');
  expect(managerView.appRef.current.state.toasts.at(-1).msg).toBe('No se puede archivar un perfil con deuda o prepago disponible.');
  expect(JSON.parse(storage.getItem(key)).customerLedger.events).toHaveLength(5);
  await user.click(within(screen.getByRole('dialog', { name: 'Archivar perfil de cliente' })).getByRole('button', { name: 'Volver' }));

  await user.click(screen.getByRole('button', { name: '+ Nuevo perfil' }));
  const newProfile = await screen.findByRole('dialog', { name: 'Nuevo perfil de cliente' });
  await user.type(within(newProfile).getByRole('textbox', { name: 'Nombre para mostrar' }), 'Luz');
  await confirmDialog(user, 'Crear perfil');
  await user.click(within(screen.getByRole('row', { name: /Luz/ })).getByRole('button', { name: 'Archivar perfil' }));
  await confirmDialog(user, 'Archivar perfil');
  const archivedLedger = JSON.parse(storage.getItem(key)).customerLedger;
  expect(archivedLedger.events.at(-1)).toMatchObject({ kind: 'profile.archive', actorId: 'auth-encargado', roleSnapshot: 'encargado' });
  expect(archivedLedger.events).toHaveLength(7);
  expect(within(screen.getByRole('row', { name: /Luz/ })).getByText('Archivado')).toBeTruthy();
});

it('shows an owner-approved zero limit and hides customer balances after secure identity loses access', async () => {
  memoryStorage(null);
  const user = userEvent.setup();
  const owner = mountSecure('duena');
  await user.click(await screen.findByRole('button', { name: 'Clientes y cuentas' }));
  await screen.findByRole('heading', { name: 'Clientes y cuentas' });
  await user.click(screen.getByRole('button', { name: '+ Nuevo perfil' }));
  const create = await screen.findByRole('dialog', { name: 'Nuevo perfil de cliente' });
  await user.type(within(create).getByRole('textbox', { name: 'Nombre para mostrar' }), 'Beto');
  await confirmDialog(user, 'Crear perfil');

  const row = await screen.findByRole('row', { name: /Beto/ });
  await user.click(within(row).getByRole('button', { name: 'Límite de crédito' }));
  const limit = await screen.findByRole('dialog', { name: 'Aprobar límite de crédito' });
  expect(within(limit).getByRole('textbox', { name: 'Límite aprobado (MXN)' }).value).toBe('0.00');
  await confirmDialog(user, 'Guardar límite');
  expect(JSON.parse(localStorage.getItem(owner.storageKey)).customerLedger.events.at(-1).payload.limitCents).toBe(0);

  await user.click(within(screen.getByRole('row', { name: /Beto/ })).getByRole('button', { name: 'Estado de cuenta' }));
  const currentContext = verifiedContext('barra');
  owner.rerender(<PosApp ref={owner.appRef} {...secureProps('barra', { accessContext: currentContext })} />);
  expect(screen.queryByRole('heading', { name: 'Clientes y cuentas' })).toBeNull();
  expect(screen.queryByRole('table', { name: 'Perfiles y saldos de clientes' })).toBeNull();
  expect(screen.queryByText('Estado de cuenta · Beto')).toBeNull();
});

it('rechecks a captured profile command against the current secure role before writing', async () => {
  memoryStorage(null);
  const user = userEvent.setup();
  const owner = mountSecure('duena');
  await user.click(await screen.findByRole('button', { name: 'Clientes y cuentas' }));
  await screen.findByRole('heading', { name: 'Clientes y cuentas' });
  await user.click(screen.getByRole('button', { name: '+ Nuevo perfil' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nuevo perfil de cliente' });
  await user.type(within(dialog).getByRole('textbox', { name: 'Nombre para mostrar' }), 'No debe guardarse');
  const captured = owner.appRef.current.state.dlg;
  const commandId = captured.commandId;
  captured.reason = 'Revisión de permiso al confirmar';

  owner.rerender(<PosApp ref={owner.appRef} {...secureProps('barra')} />);
  expect(owner.appRef.current.user().role).toBe('barra');
  expect(screen.queryByRole('heading', { name: 'Clientes y cuentas' })).toBeNull();
  act(() => expect(captured.onConfirm(captured)).toBe('keep'));
  expect(owner.appRef.current.state.dlg.title).toBe('Acción no permitida');
  const saved = JSON.parse(localStorage.getItem(owner.storageKey));
  expect(saved.customerLedger.events).toEqual([]);
  expect(saved.customerLedger.events.some(event => event.commandId === commandId)).toBe(false);
});

it('keeps a failed create retryable with one command and preserves the latest unrelated POS state', async () => {
  const storage = memoryStorage();
  const user = userEvent.setup();
  const view = mountDemo();
  await openCustomers(user);
  await user.click(screen.getByRole('button', { name: '+ Nuevo perfil' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nuevo perfil de cliente' });
  await user.type(within(dialog).getByRole('textbox', { name: 'Nombre para mostrar' }), 'Carmen');
  await user.type(within(dialog).getByRole('textbox', { name: 'Motivo (obligatorio)' }), 'Reintento de captura');
  const commandId = view.appRef.current.state.dlg.commandId;

  const latest = JSON.parse(storage.getItem('karma-pos-v1'));
  latest.sales = [{ folio: 'A-9001', status: 'completada', items: [] }];
  latest.open = [{ folio: 'A-9002', items: [], name: 'Otra pestaña' }];
  latest.kitchenTickets = [];
  latest.pending = [];
  latest.order = { ...latest.order, name: 'Borrador externo' };
  latest.orderSettings = { tableCount: 4 };
  storage.setItem('karma-pos-v1', JSON.stringify(latest));
  storage.failNextWrites(1);

  await user.click(within(screen.getByRole('dialog', { name: 'Nuevo perfil de cliente' })).getByRole('button', { name: 'Crear perfil' }));
  expect(await screen.findByText('No se pudo guardar el cambio. El formulario sigue abierto; intenta de nuevo.')).toBeTruthy();
  expect(view.appRef.current.state.dlg.commandId).toBe(commandId);
  expect(JSON.parse(storage.getItem('karma-pos-v1')).customerLedger.events).toEqual([]);

  await user.click(within(screen.getByRole('dialog', { name: 'Nuevo perfil de cliente' })).getByRole('button', { name: 'Crear perfil' }));
  await waitFor(() => expect(JSON.parse(storage.getItem('karma-pos-v1')).customerLedger.events).toHaveLength(1));
  await act(async () => view.appRef.current.up({ customerSearch: 'Carmen' }));
  const saved = JSON.parse(storage.getItem('karma-pos-v1'));
  expect(saved.customerLedger.events.filter(event => event.commandId === commandId)).toHaveLength(1);
  expect(saved.sales).toEqual(latest.sales);
  expect(saved.open).toEqual(latest.open);
  expect(saved.kitchenTickets).toEqual([]);
  expect(saved.pending).toEqual([]);
  expect(saved.order.name).toBe('Borrador externo');
  expect(saved.orderSettings).toEqual({ tableCount: 4 });
});

it('rejects a stale profile edit and fails closed on a corrupt local customer ledger', async () => {
  const storage = memoryStorage();
  const user = userEvent.setup();
  const view = mountDemo();
  await openCustomers(user);
  await user.click(screen.getByRole('button', { name: '+ Nuevo perfil' }));
  const create = await screen.findByRole('dialog', { name: 'Nuevo perfil de cliente' });
  await user.type(within(create).getByRole('textbox', { name: 'Nombre para mostrar' }), 'Diana');
  await confirmDialog(user, 'Crear perfil');

  await user.click(within(screen.getByRole('row', { name: /Diana/ })).getByRole('button', { name: 'Editar perfil' }));
  const edit = await screen.findByRole('dialog', { name: 'Editar perfil de cliente' });
  const editName = within(edit).getByRole('textbox', { name: 'Nombre para mostrar' });
  await user.clear(editName);
  await user.type(editName, 'Diana en captura');
  const persisted = JSON.parse(storage.getItem('karma-pos-v1'));
  const owner = { actorId: 'other-tab-owner', role: 'duena' };
  const external = planCustomerCommand(persisted.customerLedger, {
    commandId: 'other-tab:profile-update', customerId: persisted.customerLedger.events[0].customerId,
    kind: 'profile.update', expectedRevision: 1, actorId: owner.actorId, actorName: 'Otra pestaña',
    roleSnapshot: owner.role, occurredAt: '2026-09-30T12:00:00.000Z', reason: 'Actualización concurrente',
    payload: { name: 'Diana actualizada', phone: null },
  }, owner).ledger;
  storage.setItem('karma-pos-v1', JSON.stringify({ ...persisted, customerLedger: external }));
  await confirmDialog(user, 'Guardar cambios');
  expect(await screen.findByText('La cuenta cambió desde que abriste el formulario. Revísala y vuelve a intentarlo.')).toBeTruthy();
  expect(JSON.parse(storage.getItem('karma-pos-v1')).customerLedger.events.at(-1).payload.name).toBe('Diana actualizada');
  expect(JSON.parse(storage.getItem('karma-pos-v1')).customerLedger.events).toHaveLength(2);
  view.unmount();

  const broken = { schemaVersion: 1, revision: 4, events: [], accounts: [{ id: 'unsafe' }] };
  const corruptStorage = memoryStorage({ session: 'u1', customerLedger: broken });
  mountDemo();
  await user.click(await screen.findByRole('button', { name: 'Clientes y cuentas' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: '+ Nuevo perfil' }).disabled).toBe(true);
  expect(JSON.parse(corruptStorage.getItem('karma-pos-v1')).customerLedger).toEqual(broken);
  expect(screen.queryByRole('table', { name: 'Perfiles y saldos de clientes' })).toBeNull();
});

it('does not render customer balances for a cashier even if local UI state names the module', async () => {
  memoryStorage({ session: 'u3' });
  const appRef = React.createRef();
  render(<PosApp ref={appRef} vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
  await screen.findByRole('button', { name: 'Inventario' });
  expect(screen.getByRole('button', { name: 'Clientes y cuentas' }).getAttribute('aria-disabled')).toBe('true');
  await act(async () => appRef.current.setState({ module: 'clientes' }));
  expect(screen.queryByRole('heading', { name: 'Clientes y cuentas' })).toBeNull();
  expect(screen.queryByRole('table', { name: 'Perfiles y saldos de clientes' })).toBeNull();
});

it('removes customer profile dialogs on identity changes and rejects their captured commands', async () => {
  const key = posAccessStorageKey('secure', 'branch-customers', 'register-customers');
  const storage = memoryStorage(null);
  storage.setItem(key, JSON.stringify({ customerLedger: accountLedgerWithDebt() }));
  const user = userEvent.setup();
  const owner = mountSecure('duena');
  await user.click(await screen.findByRole('button', { name: 'Clientes y cuentas' }));
  await user.click(within(await screen.findByRole('row', { name: /Ana García/ })).getByRole('button', { name: 'Editar perfil' }));
  const dialog = await screen.findByRole('dialog', { name: 'Editar perfil de cliente' });
  expect(within(dialog).getByRole('textbox', { name: 'Teléfono (opcional)' }).value).toBe('555-0100');
  const captured = { ...owner.appRef.current.state.dlg, reason: 'Intento bajo otra identidad' };
  const before = JSON.parse(storage.getItem(key)).customerLedger;
  owner.rerender(<PosApp ref={owner.appRef} {...secureProps('duena', { accessContext: verifiedContext('duena', { userId: 'other-owner' }) })} />);
  expect(screen.queryByRole('dialog', { name: 'Editar perfil de cliente' })).toBeNull();
  act(() => expect(captured.onConfirm(captured)).toBe('keep'));
  expect(JSON.parse(storage.getItem(key)).customerLedger).toEqual(before);
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Entendido' }));
  await user.click(within(screen.getByRole('row', { name: /Ana García/ })).getByRole('button', { name: 'Editar perfil' }));
  await screen.findByRole('dialog', { name: 'Editar perfil de cliente' });
  owner.rerender(<PosApp ref={owner.appRef} {...secureProps('barra')} />);
  expect(screen.queryByRole('dialog', { name: 'Editar perfil de cliente' })).toBeNull();
  expect(screen.queryByDisplayValue('555-0100')).toBeNull();
  expect(JSON.parse(storage.getItem(key)).customerLedger).toEqual(before);
});
