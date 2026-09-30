// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PosApp from '../PosApp.jsx';
import '../karma-data.js';
import { posAccessStorageKey } from '../access/pos-storage-key.ts';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
beforeAll(() => { HTMLElement.prototype.scrollIntoView ??= () => {}; });

function memory(value, key = 'karma-pos-v1') {
  const values = new Map([[key, JSON.stringify(value)]]);
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  } });
}
function context(role = 'duena') {
  const at = Date.now(); return {
    userId: `user-${role}`, displayName: role, role, branchId: 'recovery-branch', deviceId: 'recovery-register',
    sessionId: 'recovery-session', capability: 'cash_register', leaseId: 'recovery-lease',
    expiresAt: new Date(at + 3600000).toISOString(), verifiedAt: new Date(at).toISOString(),
  };
}
const key = posAccessStorageKey('secure', 'recovery-branch', 'recovery-register');
const props = role => ({ accessMode: 'secure', accessContext: context(role), accessStorageKey: key,
  accessBranchId: 'recovery-branch', accessDeviceId: 'recovery-register', accessScreen: <main>Acceso seguro</main> });

it('shows honest secure recovery limits and opens the protected real sales export', async () => {
  const at = new Date().toISOString();
  memory({ pending: ['Venta A-1700'], sales: [{
    folio: 'A-1700', occurredAt: at, day: 0, fecha: 'Hora capturada', tipo: 'local', creo: 'Dueña', cobro: 'Dueña',
    total: 10, tip: 0, currency: 'MXN', status: 'completada', sync: 'pendiente', audit: [],
    items: [{ name: 'Café', qty: 1, total: 10 }], payments: [{ paymentId: 'pay-A-1700', method: 'cash', netAmountCents: 1000, tipCents: 0 }],
  }] }, key);
  const create = vi.fn(() => 'blob:recovery');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {});
  const user = userEvent.setup(); render(<PosApp {...props('duena')} />);

  await user.click(await screen.findByRole('button', { name: 'Usuarios y configuración' }));
  await user.click(await screen.findByRole('button', { name: 'Configuración' }));
  expect(await screen.findByRole('region', { name: 'Estado local y recuperación' })).toBeTruthy();
  expect(screen.getByText(/recepción del servidor POS es desconocida/)).toBeTruthy();
  expect(screen.getByText(/1 etiqueta heredada local sin acuse verificable/)).toBeTruthy();
  expect(screen.queryByText(/03:00|7 días retenidos|Último contacto|Todo sincronizado/)).toBeNull();
  expect(screen.queryByRole('button', { name: /Sincronizar ahora|Respaldar ahora|Forzar sincronización/ })).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Abrir Reportes y exportar CSV' }));
  await user.click(await screen.findByRole('button', { name: 'Exportar CSV para Excel' }));
  expect(create).toHaveBeenCalledOnce();
});

it('shows conflicts and does not clear legacy labels when synchronization is unavailable', async () => {
  const conflict = { folio: 'A-CONFLICT', type: 'local', ref: 'Mesa histórica', time: '12:00', user: 'Sofía',
    totalCents: 0, items: [], prep: 'en-cola', sync: 'conflicto', name: 'Mesa histórica', discount: 0 };
  memory({ pending: ['Venta antigua'], open: [conflict], kitchenTickets: [conflict], sales: [] }, key);
  const ref = React.createRef(); const user = userEvent.setup();
  render(<PosApp ref={ref} {...props('duena')} />);
  act(() => ref.current.setState({ module: 'ordenes', loading: false }));
  expect(screen.getByText('Conflicto')).toBeTruthy();
  const before = JSON.parse(localStorage.getItem(key));
  act(() => ref.current.doSync());
  const after = JSON.parse(localStorage.getItem(key));
  expect(after.pending).toEqual(before.pending);
  expect(after.open).toEqual(before.open);
  expect(screen.queryByText('Sincronización completa')).toBeNull();
});

it('labels Demo network and legacy labels as simulated with no remote server', async () => {
  memory({ session: 'u1', online: false, pending: ['Venta A-1047'], sales: [] });
  const ref = React.createRef(); const user = userEvent.setup();
  render(<PosApp ref={ref} />);
  await user.click(await screen.findByRole('button', { name: 'Usuarios y configuración' }));
  await user.click(await screen.findByRole('button', { name: 'Configuración' }));
  expect(await screen.findByRole('region', { name: 'Estado local y recuperación' })).toBeTruthy();
  expect(screen.getByText(/Modo Demo: los datos y la conectividad son de prueba/)).toBeTruthy();
  expect(screen.getByText(/1 etiqueta de demostración; no representan comandos enviados a un servidor/)).toBeTruthy();
  expect(screen.getByText(/Demo: red simulada sin conexión/)).toBeTruthy();
  const before = JSON.parse(localStorage.getItem('karma-pos-v1'));
  act(() => ref.current.doSync());
  expect(JSON.parse(localStorage.getItem('karma-pos-v1')).pending).toEqual(before.pending);
});

it('reports a browser storage failure and keeps the recovery guide available', async () => {
  memory({}, key); const user = userEvent.setup();
  render(<PosApp {...props('duena')} />);
  await user.click(await screen.findByRole('button', { name: 'Usuarios y configuración' }));
  await user.click(await screen.findByRole('button', { name: 'Configuración' }));
  const original = localStorage.setItem;
  localStorage.setItem = vi.fn(() => { throw new Error('quota full'); });
  await user.click(screen.getByRole('switch', { name: 'Permitir propina personalizada' }));
  expect(await screen.findByText('El último intento de guardado en este navegador falló. Revisa antes de repetir cualquier operación.')).toBeTruthy();
  expect(screen.getByText('No se pudo confirmar el guardado en este navegador. Revisa el estado antes de repetir cualquier operación.')).toBeTruthy();
  localStorage.setItem = original;
});

it('does not label malformed stored data as a failed browser write', async () => {
  memory({}, key); localStorage.setItem(key, '{malformed');
  const user = userEvent.setup(); render(<PosApp {...props('duena')} />);
  await user.click(await screen.findByRole('button', { name: 'Usuarios y configuración' }));
  await user.click(await screen.findByRole('button', { name: 'Configuración' }));
  expect(await screen.findByText('Aún no hay resultado de guardado observado en esta sesión.')).toBeTruthy();
  expect(screen.queryByText('El último intento de guardado en este navegador falló. Revisa antes de repetir cualquier operación.')).toBeNull();
});

it('hides recovery and rejects a captured report-navigation callback after role loss', async () => {
  memory({}, key); const ref = React.createRef(); const user = userEvent.setup();
  const view = render(<PosApp ref={ref} {...props('duena')} />);
  await user.click(await screen.findByRole('button', { name: 'Usuarios y configuración' }));
  await user.click(await screen.findByRole('button', { name: 'Configuración' }));
  expect(await screen.findByRole('region', { name: 'Estado local y recuperación' })).toBeTruthy();
  const capturedOpenReport = ref.current.renderVals().openSalesReport;
  view.rerender(<PosApp ref={ref} {...props('barra')} />);
  expect(screen.queryByRole('region', { name: 'Estado local y recuperación' })).toBeNull();
  act(() => capturedOpenReport());
  expect(screen.queryByRole('heading', { name: 'Reportes' })).toBeNull();
  expect(screen.getByRole('dialog').textContent).toContain('Acción no permitida');
});

it('does not show a successful payment until the browser write succeeds', async () => {
  const line = { lineId: 'line-1', prodId: 'cafe', qty: 1, name: 'Café', unit: 10,
    capturedSnapshot: { name: 'Café', unitPriceCents: 1000, quantity: 1, lineTotalCents: 1000, modifiers: [], notes: '' } };
  const order = { folio: null, type: 'local', mesa: '', name: '', items: [line], discount: 0, actorId: 'user-duena', actorName: 'Dueña' };
  memory({ order, open: [], kitchenTickets: [], sales: [], pending: [] }, key);
  const ref = React.createRef(); const user = userEvent.setup(); render(<PosApp ref={ref} {...props('duena')} />);
  act(() => ref.current.startCheckout(null, [line], 0, 'local', true));
  act(() => ref.current.setState({ ck: { ...ref.current.state.ck, step: 'confirm' } }));
  const staleRetry = ref.current.renderVals().ckRetry;
  const staleChangeMethod = ref.current.renderVals().ckChangeMethod;
  const failedWrite = vi.fn(() => {
    expect(screen.queryByText('Pago registrado')).toBeNull();
    throw new Error('quota full');
  });
  localStorage.setItem = failedWrite;
  vi.useFakeTimers();
  act(() => ref.current.register());
  expect(screen.queryByText('Pago registrado')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
  expect(failedWrite).toHaveBeenCalledOnce();
  expect(screen.queryByText('Pago registrado')).toBeNull();
  expect(screen.getByText('Guardado local no confirmado')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
  expect(ref.current.state.sales).toEqual([]);
  const recoveredWrite = vi.fn(); localStorage.setItem = recoveredWrite;
  act(() => { staleRetry(); staleChangeMethod(); ref.current.register(); });
  expect(recoveredWrite).not.toHaveBeenCalled();
  expect(ref.current.state.ck).toMatchObject({ step: 'result', ok: false, saveFailed: true });
  expect(ref.current.state.sales).toEqual([]);
  vi.useRealTimers();

  await user.click(screen.getByRole('button', { name: 'Cerrar aviso sin repetir cobro' }));
  await user.click(screen.getByRole('button', { name: 'Reportes' }));
  expect(await screen.findByRole('heading', { name: 'Reportes' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Usuarios y configuración' }));
  await user.click(await screen.findByRole('button', { name: 'Configuración' }));
  expect(await screen.findByRole('region', { name: 'Estado local y recuperación' })).toBeTruthy();
  expect(screen.getByText('El último intento de guardado en este navegador falló. Revisa antes de repetir cualquier operación.')).toBeTruthy();
});

it('shows successful checkout only after the browser write returns', async () => {
  const line = { lineId: 'line-1', prodId: 'cafe', qty: 1, name: 'Café', unit: 10,
    capturedSnapshot: { name: 'Café', unitPriceCents: 1000, quantity: 1, lineTotalCents: 1000, modifiers: [], notes: '' } };
  const order = { folio: null, type: 'local', mesa: '', name: '', items: [line], discount: 0, actorId: 'user-duena', actorName: 'Dueña' };
  memory({ order, open: [], kitchenTickets: [], sales: [], pending: [] }, key);
  const ref = React.createRef(); render(<PosApp ref={ref} {...props('duena')} />);
  act(() => ref.current.startCheckout(null, [line], 0, 'local', true));
  act(() => ref.current.setState({ ck: { ...ref.current.state.ck, step: 'confirm' } }));
  const successfulWrite = vi.fn(() => { expect(screen.queryByText('Pago registrado')).toBeNull(); });
  localStorage.setItem = successfulWrite;
  vi.useFakeTimers();
  act(() => ref.current.register());

  await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
  expect(successfulWrite).toHaveBeenCalledOnce();
  expect(screen.getByText('Pago registrado')).toBeTruthy();
  expect(ref.current.state.sales).toHaveLength(1);
});

it('closes a Demo session on screen even when saving the logout fails', async () => {
  memory({ session: 'u1', pick: 'u1', sales: [], open: [], pending: [] });
  const user = userEvent.setup(); render(<PosApp />);
  const logout = await screen.findByRole('button', { name: /Salir de la estación de/ });
  localStorage.setItem = vi.fn(() => { throw new Error('quota full'); });

  await user.click(logout);
  expect(await screen.findByText(/PIN de/)).toBeTruthy();
});

it('closes the secure user editor after the server confirms even if unrelated local storage is full', async () => {
  memory({}, key); const onManageMember = vi.fn().mockResolvedValue(undefined);
  const ref = React.createRef(); render(<PosApp ref={ref} {...props('duena')} onManageMember={onManageMember} />);
  act(() => ref.current.setState({ selUser: 'member-1', suForm: { name: 'María', userId: 'member-1', role: 'barra', active: true } }));
  localStorage.setItem = vi.fn(() => { throw new Error('quota full'); });

  await act(async () => { ref.current.renderVals().suSave(); await Promise.resolve(); });
  expect(onManageMember).toHaveBeenCalledOnce();
  expect(ref.current.state.selUser).toBeNull();
  expect(ref.current.state.suForm).toBeNull();
});

it('keeps discount reason and amount open without a success claim when saving fails', async () => {
  const line = { lineId: 'line-1', prodId: 'cafe', qty: 1, name: 'Café', unit: 10,
    capturedSnapshot: { name: 'Café', unitPriceCents: 1000, quantity: 1, lineTotalCents: 1000, modifiers: [], notes: '' } };
  const order = { folio: null, type: 'local', mesa: '', name: '', items: [line], discount: 0, actorId: 'user-duena', actorName: 'Dueña' };
  memory({ order, open: [], kitchenTickets: [], sales: [], pending: [] }, key);
  const ref = React.createRef(); render(<PosApp ref={ref} {...props('duena')} />);
  act(() => { ref.current.setState({ module: 'pos', order }); ref.current.renderVals().addDiscount(); });
  act(() => ref.current.setState({ dlg: { ...ref.current.state.dlg, reason: 'Corrección autorizada', fields: [{ key: 'monto', label: 'Monto (MXN)', value: '5' }] } }));
  localStorage.setItem = vi.fn(() => { throw new Error('quota full'); });

  act(() => ref.current.renderVals().dlgConfirm());
  expect(ref.current.state.order.discount).toBe(0);
  expect(ref.current.state.dlg).toMatchObject({ reason: 'Corrección autorizada', fields: [{ value: '5' }] });
  expect(ref.current.state.toasts.some(toast => toast.msg.includes('aplicado'))).toBe(false);
});
