// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PosApp from '../PosApp.jsx';
import '../karma-data.js';
import { posAccessStorageKey } from '../access/pos-storage-key.ts';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeAll(() => { HTMLElement.prototype.scrollIntoView ??= () => {}; });
const sale = () => ({
  folio: 'A-CSV', audit: [], status: 'completada', occurredAt: '2026-09-30T02:00:00.000Z',
  day: 0, fecha: 'Hora capturada', tipo: 'local', creo: 'Dueña', cobro: 'Dueña',
  total: 50, tip: 0, currency: 'MXN', items: [{ name: 'Café', qty: 1, total: 50 }],
  payments: [{ paymentId: 'cash-csv', method: 'cash', methodLabel: 'Efectivo', netAmountCents: 5000, cashReceivedCents: 10000, changeCents: 5000, tipCents: 0 }], sync: 'pendiente',
});
function memory(value, key = 'karma-pos-v1') {
  const values = new Map([[key, JSON.stringify(value)]]);
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
  } });
}
function downloads() {
  let generated;
  const create = vi.fn(blob => { generated = blob; return 'blob:csv-test'; });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {});
  return { create, click, blob: () => generated };
}
function readBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(blob);
  });
}
function context(role = 'duena') {
  const at = Date.now(); return {
    userId: `user-${role}`, displayName: role, role, branchId: 'csv-branch', deviceId: 'csv-register',
    sessionId: 'csv-session', capability: 'cash_register', leaseId: 'csv-lease',
    expiresAt: new Date(at + 3600000).toISOString(), verifiedAt: new Date(at).toISOString(),
  };
}
const key = posAccessStorageKey('secure', 'csv-branch', 'csv-register');
const props = role => ({ accessMode: 'secure', accessContext: context(role), accessStorageKey: key,
  accessBranchId: 'csv-branch', accessDeviceId: 'csv-register', accessScreen: <main>Acceso seguro</main> });
it('generates a real CSV Blob and download link with captured net cash and separate change', async () => {
  memory({ session: 'u1', sales: [sale()] }); const dl = downloads(); const user = userEvent.setup();
  render(<PosApp />);
  await user.click(await screen.findByRole('button', { name: 'Reportes' }));
  await user.click(screen.getByRole('button', { name: 'Exportar CSV para Excel' }));
  expect(dl.create).toHaveBeenCalledOnce(); expect(dl.click).toHaveBeenCalledOnce();
  const link = dl.click.mock.instances[0]; expect(link.download).toMatch(/^karma-ventas-.*\.csv$/);
  expect(link.href).toBe('blob:csv-test'); expect(link.isConnected).toBe(false);
  const csv = await readBlob(dl.blob());
  expect(csv).toContain('"cash",50,100,50'); expect(csv).toContain('29/09/2026, 20:00:00');
  expect(csv).toContain('acuse servidor no comprobado');
});
it('denies a captured export callback after role loss and creates no download from corrupt money', async () => {
  memory({ sales: [sale()] }, key); const dl = downloads(); const ref = React.createRef(); const user = userEvent.setup();
  const view = render(<PosApp ref={ref} {...props('duena')} />);
  await user.click(await screen.findByRole('button', { name: 'Reportes' }));
  act(() => ref.current.setState({ repSel: 'A-CSV' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  view.rerender(<PosApp ref={ref} {...props('barra')} />);
  expect(screen.queryByRole('heading', { name: 'Reportes' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => ref.current.exportSales()); expect(dl.create).not.toHaveBeenCalled();
  view.rerender(<PosApp ref={ref} {...props('duena')} />);
  act(() => ref.current.setState({ sales: [{ ...sale(), payments: [{ ...sale().payments[0], netAmountCents: 5100 }] }] }));
  act(() => ref.current.exportSales()); expect(dl.create).not.toHaveBeenCalled();
  expect(ref.current.state.toasts.at(-1).msg).toMatch(/^No se pudo generar el archivo/);
});
