// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PosApp from '../PosApp.jsx';
import '../karma-data.js';
import { posAccessStorageKey } from './pos-storage-key.ts';

let storage;
function installMemoryStorage() {
  const values = new Map();
  storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(key),
    clear: () => values.clear(),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
}

beforeEach(installMemoryStorage);
afterEach(() => {
  cleanup();
  storage.clear();
});

function context(overrides = {}) {
  const now = Date.now();
  return {
    userId: 'auth-owner-1',
    displayName: 'Dueña verificada',
    role: 'duena',
    branchId: 'branch-a',
    deviceId: 'register-a',
    sessionId: 'session-1',
    capability: 'cash_register',
    leaseId: 'lease-1',
    expiresAt: new Date(now + 60 * 60_000).toISOString(),
    verifiedAt: new Date(now).toISOString(),
    ...overrides,
  };
}

function props(overrides = {}) {
  return {
    vistaCatalogo: 'cuadricula',
    mostrarAgotados: true,
    propinaInicial: '0',
    accessMode: 'secure',
    accessStorageKey: posAccessStorageKey('secure', 'branch-a', 'register-a'),
    accessBranchId: 'branch-a',
    accessDeviceId: 'register-a',
    accessScreen: <main>Inicio de sesión seguro</main>,
    accessContext: context(),
    ...overrides,
  };
}

describe('secure POS UI boundary', () => {
  it('shows only the secure entry when there is no verified identity', () => {
    const ref = React.createRef();
    render(<PosApp ref={ref} {...props({ accessContext: null })} />);

    expect(screen.getByText('Inicio de sesión seguro')).toBeTruthy();
    expect(screen.queryByText(/Demo — Sofía/)).toBeNull();
    expect(ref.current.state.usersX).toEqual([]);
    expect(ref.current.state.open).toEqual([]);
    expect(ref.current.user()).toBeNull();
  });

  it.each([
    ['malformed expiry', context({ expiresAt: 'not-a-date' })],
    ['other branch', context({ branchId: 'branch-b' })],
    ['unknown role', context({ role: 'owner-admin' })],
    ['other device', context({ deviceId: 'register-b' })],
    ['expired lease', context({ expiresAt: new Date(Date.now() - 1_000).toISOString() })],
  ])('fails closed for %s', (_label, invalidContext) => {
    const ref = React.createRef();
    render(<PosApp ref={ref} {...props({ accessContext: invalidContext })} />);

    expect(screen.getByText('Inicio de sesión seguro')).toBeTruthy();
    expect(ref.current.accessContext()).toBeNull();
    expect(ref.current.user()).toBeNull();
  });

  it('uses only the current verified role and rejects unauthorized, expired, and malformed-reason actions', () => {
    const ref = React.createRef();
    const waiter = context({ userId: 'auth-waiter-2', displayName: 'Mesero', role: 'mesero' });
    const view = render(<PosApp ref={ref} {...props({ accessContext: waiter })} />);

    expect(ref.current.user()).toMatchObject({ id: 'auth-waiter-2', role: 'mesero' });
    expect(ref.current.can('ordenes')).toBe(true);
    expect(ref.current.can('cobrar')).toBe(false);
    act(() => expect(ref.current.requireAction('checkout')).toBe(false));
    expect(ref.current.state.dlg.title).toBe('Acción no permitida');

    const owner = context();
    const expired = context({ expiresAt: new Date(Date.now() - 1_000).toISOString() });
    view.rerender(<PosApp ref={ref} {...props({ accessContext: owner })} />);
    view.rerender(<PosApp ref={ref} {...props({ accessContext: expired })} />);
    act(() => expect(ref.current.requireAction('openOrder')).toBe(false));
    expect(ref.current.user()).toBeNull();

    view.rerender(<PosApp ref={ref} {...props({ accessContext: owner })} />);
    act(() => expect(ref.current.requireAction('discountWithReason', 'x'.repeat(251))).toBe(false));
    expect(ref.current.user().id).toBe('auth-owner-1');
  });

  it('keeps a mounted draft and its original actor when identity changes', async () => {
    const ref = React.createRef();
    const onSwitchIdentity = vi.fn();
    const accessStorageKey = posAccessStorageKey('secure', 'branch-a', 'register-a');
    const view = render(<PosApp ref={ref} {...props({ accessStorageKey, onSwitchIdentity })} />);

    act(() => ref.current.mutateOrder('order_updated', (order) => ({ ...order, name: 'Mesa 12' })));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(accessStorageKey)).order.name).toBe('Mesa 12'));
    act(() => ref.current.renderVals().switchUser());
    expect(onSwitchIdentity).toHaveBeenCalledOnce();

    view.rerender(<PosApp ref={ref} {...props({
      accessStorageKey,
      onSwitchIdentity,
      accessContext: context({ userId: 'auth-barista-3', displayName: 'Barra', role: 'barra' }),
    })} />);
    expect(ref.current.state.order.name).toBe('Mesa 12');
    expect(ref.current.state.order.actorId).toBe('auth-owner-1');
  });

  it('loads secure data only from the matching branch and device storage scope', () => {
    const sourceKey = posAccessStorageKey('secure', 'branch-a', 'register-a');
    const targetKey = posAccessStorageKey('secure', 'branch-b', 'register-b');
    localStorage.setItem(sourceKey, JSON.stringify({ order: { folio: 'A-SOURCE', name: 'Other branch', items: [] } }));
    localStorage.setItem(targetKey, JSON.stringify({ order: { folio: 'B-TARGET', name: 'Current branch', items: [] } }));
    const ref = React.createRef();

    render(<PosApp ref={ref} {...props({
      accessStorageKey: targetKey,
      accessBranchId: 'branch-b',
      accessDeviceId: 'register-b',
      accessContext: context({ branchId: 'branch-b', deviceId: 'register-b' }),
    })} />);

    expect(ref.current.state.order).toMatchObject({ folio: 'B-TARGET', name: 'Current branch' });
    expect(ref.current.state.order.name).not.toBe('Other branch');
    expect(ref.current.state.session).toBeNull();
  });

  it('lets an Encargado open table configuration without exposing user administration', () => {
    const ref = React.createRef();
    const manager = context({ userId: 'auth-manager-2', displayName: 'Encargado', role: 'encargado' });
    render(<PosApp ref={ref} {...props({ accessContext: manager })} />);

    expect(ref.current.can('configureTables')).toBe(true);
    expect(ref.current.can('manageUsers')).toBe(false);
    expect(ref.current.navAllowed('config')).toBe(true);
    act(() => ref.current.setState({ module: 'config', cfgTab: 'usuarios' }));
    expect(screen.getByRole('button', { name: 'Configuración' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Usuarios' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Crear cuenta Auth individual/ })).toBeNull();
  });

  it('blocks PWA activation while a one-time account password is visible, then releases the block when closed', async () => {
    const ref = React.createRef();
    let updateSafety;
    render(<PosApp ref={ref} {...props({ onUpdateSafetyChange: next => { updateSafety = next; } })} />);

    act(() => ref.current.setState({
      loading: false,
      module: 'config',
      createdCredential: {
        ownerUserId: 'auth-owner-1',
        email: 'barista@example.invalid',
        temporaryPassword: 'one-time-secret',
      },
    }));
    expect(updateSafety).toMatchObject({ status: 'blocked' });
    expect(updateSafety.reason).toContain('contraseña inicial visible');
    const close = await screen.findByRole('button', { name: 'Listo, cerrar credencial' });
    fireEvent.click(close);

    await waitFor(() => expect(updateSafety).toMatchObject({ status: 'safe' }));
    expect(screen.queryByText('one-time-secret')).toBeNull();
  });
});


it('rechecks a secure cancellation dialog after identity switching and persists the original and cancelling actors in the scoped store', () => {
  const ref = React.createRef();
  const key = posAccessStorageKey('secure', 'branch-a', 'register-a');
  const account = { ...structuredClone(window.KARMA.seedOrders[0]), folio: 'A-SECURE-CANCEL', user: 'Originadora', actorId: 'auth-origin', actorName: 'Originadora', time: '09:20' };
  localStorage.setItem(key, JSON.stringify({ open: [account], kitchenTickets: [account], sales: [] }));
  const view = render(<PosApp ref={ref} {...props()} />);
  act(() => ref.current.cancelOpen(account.folio));
  const confirm = ref.current.state.dlg.onConfirm;
  view.rerender(<PosApp ref={ref} {...props({ accessContext: context({ userId: 'auth-barra', role: 'barra', displayName: 'Barra' }) })} />);
  act(() => expect(confirm({ reason: 'Corrección del pedido' })).toBe('keep'));
  expect(JSON.parse(localStorage.getItem(key)).sales).toEqual([]);
  view.rerender(<PosApp ref={ref} {...props({ accessContext: context({ userId: 'auth-manager', role: 'encargado', displayName: 'Encargado' }) })} />);
  act(() => confirm({ reason: 'Corrección del pedido' }));
  expect(JSON.parse(localStorage.getItem(key)).sales[0]).toMatchObject({ creo: 'Originadora', actorId: 'auth-origin', cancelledByActorId: 'auth-manager', cancelledByActorName: 'Encargado', createdTime: '09:20' });
  expect(localStorage.getItem('karma-pos-v1')).toBeNull();
});

it('preserves the order creator when a different verified identity saves and starts checkout', () => {
  const ref = React.createRef();
  const view = render(<PosApp ref={ref} {...props()} />);
  act(() => ref.current.mutateOrder('line_added', order => ({ ...order, items: [{ lineId: 'origin-line', prodId: 'espresso', name: 'Espresso', unit: 30, qty: 1, mods: {}, notes: '' }] })));
  view.rerender(<PosApp ref={ref} {...props({ accessContext: context({ userId: 'auth-barra', role: 'barra', displayName: 'Barra' }) })} />);
  act(() => ref.current.saveOpen(false));
  const saved = ref.current.state.open[0];
  expect(saved).toMatchObject({ user: 'Dueña verificada', actorId: 'auth-owner-1', actorName: 'Dueña verificada' });
  act(() => ref.current.startCheckout(saved.folio));
  expect(ref.current.state.ck).toMatchObject({ originalActorId: 'auth-owner-1', originalActorName: 'Dueña verificada', actorId: 'auth-barra', actorName: 'Barra' });
});
