// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PosApp from '../PosApp.jsx';
import '../karma-data.js';
import { posAccessStorageKey } from '../access/pos-storage-key.ts';
import { presetReportPeriod } from './report-period.ts';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeAll(() => { HTMLElement.prototype.scrollIntoView ??= () => {}; });
const sale = (folio = 'A-CSV', occurredAt = '2026-09-30T02:00:00.000Z') => ({
  folio, audit: [], status: 'completada', occurredAt,
  day: 0, fecha: 'Hora capturada', tipo: 'local', creo: 'Dueña', cobro: 'Dueña',
  total: 50, tip: 0, currency: 'MXN', items: [{ name: 'Café', qty: 1, total: 50 }],
  payments: [{ paymentId: `cash-${folio}`, method: 'cash', methodLabel: 'Efectivo', netAmountCents: 5000, cashReceivedCents: 10000, changeCents: 5000, tipCents: 0 }], sync: 'pendiente',
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
  await user.click(screen.getByRole('button', { name: 'Personalizado' }));
  fireEvent.change(screen.getByLabelText('Desde (hora local)'), { target: { value: '2026-09-29T19:00' } });
  fireEvent.change(screen.getByLabelText('Hasta (exclusiva, hora local)'), { target: { value: '2026-09-29T21:00' } });
  expect(screen.getByRole('status').textContent).toContain('America/Mexico_City');
  await user.click(screen.getByRole('button', { name: 'Exportar CSV para Excel' }));
  expect(dl.create).toHaveBeenCalledOnce(); expect(dl.click).toHaveBeenCalledOnce();
  const link = dl.click.mock.instances[0]; expect(link.download).toMatch(/^karma-ventas-.*\.csv$/);
  expect(link.href).toBe('blob:csv-test'); expect(link.isConnected).toBe(false);
  const csv = await readBlob(dl.blob());
  expect(csv).toContain('"cash",50,100,50'); expect(csv).toContain('29/09/2026, 20:00:00');
  expect(csv).toContain('acuse servidor no comprobado');
});
it('uses local custom boundaries, keeps unknown dates separate, and exports only dated sales in the selected period', async () => {
  const source = [
    sale('A-BEFORE', '2026-09-30T17:59:59.999Z'),
    sale('A-START', '2026-09-30T18:00:00.000Z'),
    sale('A-END', '2026-09-30T19:00:00.000Z'),
    { ...sale('A-LEGACY'), occurredAt: undefined, fecha: 'Hoy · 08:00', day: 0 },
  ];
  memory({ session: 'u1', sales: source }); const dl = downloads(); const user = userEvent.setup();
  render(<PosApp branchTimeZone="America/Mexico_City" />);
  await user.click(await screen.findByRole('button', { name: 'Reportes' }));
  await user.click(screen.getByRole('button', { name: 'Personalizado' }));
  fireEvent.change(screen.getByLabelText('Desde (hora local)'), { target: { value: '2026-09-30T12:00' } });
  fireEvent.change(screen.getByLabelText('Hasta (exclusiva, hora local)'), { target: { value: '2026-09-30T13:00' } });

  expect(screen.getByRole('button', { name: 'Abrir detalle de venta A-START' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Abrir detalle de venta A-BEFORE' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Abrir detalle de venta A-END' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Abrir historial heredado A-LEGACY' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Abrir detalle de venta A-START' })).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Exportar CSV para Excel' }));
  const csv = await readBlob(dl.blob());
  expect(csv).toContain('"A-START"');
  expect(csv).not.toContain('"A-BEFORE"');
  expect(csv).not.toContain('"A-END"');
  expect(csv).toContain('"A-LEGACY"');
  expect(csv).toContain('Legado sin fecha real; separado del periodo');
});
it('shows and exports a refund by its event date without importing the older receipt into today', async () => {
  const now = new Date().toISOString();
  const zone = 'America/Mexico_City';
  const today = presetReportPeriod('hoy', now, zone);
  const old = {
    ...sale('A-OLD-REFUND', new Date(Date.parse(today.startUtc) - 1).toISOString()),
    compensations: [{
      commandId: 'refund-old-sale', kind: 'refund', amountCents: 1000,
      actorId: 'manager', actorName: 'Encargado', reason: 'Reembolso posterior',
      occurredAt: now, allocations: [{ paymentId: 'cash-A-OLD-REFUND', method: 'cash', amountCents: 1000 }],
    }],
  };
  memory({ session: 'u1', sales: [old] }); const dl = downloads(); const user = userEvent.setup();
  render(<PosApp branchTimeZone={zone} />);
  await user.click(await screen.findByRole('button', { name: 'Reportes' }));

  expect(screen.queryByRole('button', { name: 'Abrir detalle de venta A-OLD-REFUND' })).toBeNull();
  const returnsTable = screen.getByRole('region', { name: 'Devoluciones y anulaciones del periodo' });
  expect(returnsTable.textContent).toContain('A-OLD-REFUND');
  expect(returnsTable.textContent).toContain('Reembolso posterior');

  await user.click(screen.getByRole('button', { name: 'Exportar CSV para Excel' }));
  const csv = await readBlob(dl.blob());
  expect(csv).toContain('"refund","A-OLD-REFUND","refund-old-sale"');
  expect(csv).not.toContain('"venta","A-OLD-REFUND"');
  expect(csv).not.toContain('"pago","A-OLD-REFUND"');
});
it('requires an explicit occurrence for repeated local hours and rejects a missing daylight-saving hour', async () => {
  memory({ session: 'u1', sales: [] }); const user = userEvent.setup();
  render(<PosApp />);
  await user.click(await screen.findByRole('button', { name: 'Reportes' }));
  await user.click(screen.getByRole('button', { name: 'Personalizado' }));
  fireEvent.change(screen.getByLabelText('Zona horaria IANA del reporte'), { target: { value: 'America/New_York' } });
  fireEvent.change(screen.getByLabelText('Desde (hora local)'), { target: { value: '2026-11-01T01:30' } });
  fireEvent.change(screen.getByLabelText('Hasta (exclusiva, hora local)'), { target: { value: '2026-11-01T02:30' } });
  expect(screen.getByRole('alert').textContent).toContain('ocurrió dos veces');
  expect(screen.getByRole('button', { name: 'Exportar CSV para Excel' }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Si una hora se repitió'), { target: { value: 'earlier' } });
  expect(screen.getByRole('status').textContent).toContain('2026-11-01T05:30:00.000Z');
  fireEvent.change(screen.getByLabelText('Si una hora se repitió'), { target: { value: 'later' } });
  expect(screen.getByRole('status').textContent).toContain('2026-11-01T06:30:00.000Z');

  fireEvent.change(screen.getByLabelText('Desde (hora local)'), { target: { value: '2026-03-08T02:30' } });
  expect(screen.getByRole('alert').textContent).toContain('no existió');
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
  expect(ref.current.state.toasts.at(-1).msg).toMatch(/^No se pudo calcular el periodo/);
});
