// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import React from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button.jsx';
import { Input } from './input.jsx';
import { Label } from './label.jsx';
import { Table } from './table.jsx';
import PosApp from '../../PosApp.jsx';
import ComandaApp from '../../ComandaApp.jsx';
import '../../karma-data.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog.jsx';

afterEach(cleanup);

beforeAll(() => {
  // JSDOM lacks the pointer-capture and scrolling APIs Radix Select uses in browsers.
  HTMLElement.prototype.scrollIntoView ??= () => {};
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
});

function installMemoryStorage() {
  const values = new Map();
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key)),
    clear: () => values.clear(),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  return storage;
}

describe('shared UI primitives', () => {
  it('opens the dialog by keyboard, dismisses on Escape, and restores focus', async () => {
    const user = userEvent.setup();

    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm action</DialogTitle>
            <DialogDescription>Check before continuing.</DialogDescription>
          </DialogHeader>
          <Button>Continue</Button>
        </DialogContent>
      </Dialog>
    );

    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    trigger.focus();
    await user.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'Confirm action' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('exposes disabled and busy button states without dropping the label', () => {
    render(<Button disabled aria-busy="true">Guardando…</Button>);
    const button = screen.getByRole('button', { name: 'Guardando…' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('associates a persistent form label and validation message with its input', () => {
    render(
      <div>
        <Label htmlFor="amount">Monto</Label>
        <Input id="amount" aria-invalid="true" aria-describedby="amount-error" />
        <p id="amount-error" role="alert">Captura un monto válido.</p>
      </div>
    );

    const amount = screen.getByRole('textbox', { name: 'Monto' });
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(amount.getAttribute('aria-describedby')).toBe('amount-error');
    expect(screen.getByRole('alert').textContent).toBe('Captura un monto válido.');
  });

  it('scrolls the focused table region with arrows without stealing keys from child inputs', () => {
    render(
      <Table containerProps={{ 'aria-label': 'Scrollable stock table' }}>
        <tbody><tr><td><input aria-label="Filter stock table" /></td></tr></tbody>
      </Table>
    );
    const region = screen.getByRole('region', { name: 'Scrollable stock table' });
    const input = screen.getByRole('textbox', { name: 'Filter stock table' });
    Object.defineProperty(region, 'scrollWidth', { configurable: true, value: 600 });
    Object.defineProperty(region, 'clientWidth', { configurable: true, value: 300 });

    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(region.scrollLeft).toBe(0);

    region.focus();
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(region.scrollLeft).toBeGreaterThan(0);
    const afterArrow = region.scrollLeft;
    fireEvent.keyDown(region, { key: 'ArrowRight', altKey: true });
    expect(region.scrollLeft).toBe(afterArrow);
  });

  it('mounts the POS without a dialog and restores focus after an app warning closes', async () => {
    installMemoryStorage().clear();
    const user = userEvent.setup();

    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
    expect(await screen.findByText('¿Quién abre la estación?', {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    const three = screen.getByRole('button', { name: '3' });
    await user.click(three);
    await user.click(three);
    await user.click(three);
    await user.click(three);

    const restrictedNavigation = await screen.findByRole('button', { name: 'Usuarios y configuración' });
    restrictedNavigation.focus();
    await user.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'Acción no permitida' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(restrictedNavigation);
  });

  it('edits a seeded menu item through labeled shared controls without changing the menu workflow', async () => {
    const storage = installMemoryStorage();
    storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1' }));
    const user = userEvent.setup();

    let updateSafety;
    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" onUpdateSafetyChange={next => { updateSafety = next; }} />);
    await screen.findByRole('button', { name: 'Menú' });
    await user.click(screen.getByRole('button', { name: 'Menú' }));
    await user.click(screen.getByRole('button', { name: /^Americano Con café \$50\.00 Activo$/ }));
    expect(updateSafety.status).toBe('blocked');

    const category = screen.getByRole('combobox', { name: 'Categoría' });
    await user.click(category);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(category.textContent).toBe('Lattes');

    const price = screen.getByRole('textbox', { name: 'Precio en MXN' });
    await user.clear(price);
    await user.type(price, '55');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByRole('button', { name: /^Americano Lattes \$55\.00 Activo$/ })).toBeTruthy();
    expect((await screen.findByRole('status')).textContent).toContain('guardado en el menú');
    expect(screen.getByRole('region', { name: 'Notificaciones' })).toBeTruthy();
    expect(updateSafety.status).toBe('safe');
  });

  it('completes a seeded open-order checkout through labeled shared payment controls', async () => {
    const storage = installMemoryStorage();
    storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1' }));
    const user = userEvent.setup();

    let updateSafety;
    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" onUpdateSafetyChange={next => { updateSafety = next; }} />);
    await user.click(await screen.findByRole('button', { name: /Órdenes abiertas/ }));
    const chargeButtons = await screen.findAllByRole('button', { name: 'Cobrar' });
    await user.click(chargeButtons[0]);

    expect(await screen.findByText('Revisa la orden')).toBeTruthy();
    expect(updateSafety.status).toBe('blocked');
    expect(updateSafety.reason).toContain('cobro abierto');
    await user.click(screen.getByRole('button', { name: 'Continuar al pago' }));
    const amount = await screen.findByRole('textbox', { name: 'Monto con Efectivo' });
    expect(amount).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: /Registrar pago/ }));

    expect(await screen.findByText('Pago registrado', {}, { timeout: 4000 })).toBeTruthy();
  });

  it('records net cash, returned change, and the net method total in reports', async () => {
    const storage = installMemoryStorage();
    const order = {
      folio: 'EVL-186-CASH', type: 'local', mesa: '', name: '', discount: 0,
      items: [{ lineId: 'line-cash', prodId: 'concafe-americano', name: 'Americano', qty: 1, mods: {}, modsText: '', notes: '', unit: 50 }],
    };
    storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1', order, open: [], sales: [] }));
    const user = userEvent.setup();

    const pos = render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
    await user.click(await screen.findByRole('button', { name: /^Cobrar / }));
    await user.click(await screen.findByRole('button', { name: 'Continuar al pago' }));
    const cashInput = await screen.findByRole('textbox', { name: 'Monto con Efectivo' });
    await user.clear(cashInput);
    await user.type(cashInput, '100');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText(/Cambio/)).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: /Registrar pago/ }));
    expect(await screen.findByText('Pago registrado', {}, { timeout: 4000 })).toBeTruthy();

    let saved = JSON.parse(storage.getItem('karma-pos-v1'));
    expect(saved.sales[0]).toMatchObject({ total: 50, totalCents: 5000, tip: 0, tipCents: 0 });
    expect(saved.sales[0].payments).toEqual([{ paymentId: 'EVL-186-CASH:payment:1', method: 'cash', methodLabel: 'Efectivo', netAmountCents: 5000, amountCents: 5000, amount: 50, tipCents: 0, recordMode: 'manual', verificationStatus: 'not_applicable', cashReceivedCents: 10000, changeCents: 5000 }]);
    expect(saved.sales[0].tenders).toEqual([{ tenderId: 'EVL-186-CASH:tender:1', method: 'cash', methodLabel: 'Efectivo', tenderedCents: 10000, netAmountCents: 5000, changeCents: 5000, tipCents: 0 }]);
    await user.click(screen.getByRole('button', { name: 'Reportes' }));
    const methodRow = await screen.findByText('Efectivo');
    expect(methodRow.parentElement.textContent).toContain('$50.00');
    saved = JSON.parse(storage.getItem('karma-pos-v1'));
    expect(saved.sales[0].payments[0].amountCents).toBe(5000);
    pos.unmount();
    cleanup();
    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
    await user.click(await screen.findByRole('button', { name: 'Reportes' }));
    const reloadedMethodRow = await screen.findByText('Efectivo');
    expect(reloadedMethodRow.parentElement.textContent).toContain('$50.00');
  });

  it('keeps a fully returned cash tender when its net contribution is zero', async () => {
    const storage = installMemoryStorage();
    const order = {
      folio: 'EVL-186-ZERO-CASH', type: 'local', mesa: '', name: '', discount: 0,
      items: [{ lineId: 'line-zero-cash', prodId: 'concafe-americano', name: 'Americano', qty: 1, mods: {}, modsText: '', notes: '', unit: 50 }],
    };
    storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1', order, open: [], sales: [] }));
    const user = userEvent.setup();

    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
    await user.click(await screen.findByRole('button', { name: /^Cobrar / }));
    await user.click(await screen.findByRole('button', { name: 'Continuar al pago' }));
    const cashInput = await screen.findByRole('textbox', { name: 'Monto con Efectivo' });
    await user.clear(cashInput);
    await user.click(screen.getByRole('button', { name: 'Restante' }));
    expect(cashInput.value).toBe('50.00');
    await user.clear(cashInput);
    await user.type(cashInput, '20');
    await user.click(screen.getByRole('button', { name: '+ Dividir en otro método' }));
    const cardInput = await screen.findByRole('textbox', { name: 'Monto con Tarjeta' });
    await user.clear(cardInput);
    await user.type(cardInput, '50');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText(/Efectivo · neto/)).toBeTruthy();
    expect(screen.getByText(/Recibido \$20\.00 · cambio \$20\.00/)).toBeTruthy();
    expect(screen.getByText(/Tarjeta · neto/)).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: /Registrar pago/ }));
    expect(await screen.findByText('Pago registrado', {}, { timeout: 4000 })).toBeTruthy();

    const saved = JSON.parse(storage.getItem('karma-pos-v1')).sales[0];
    expect(saved.payments).toHaveLength(1);
    expect(saved.payments[0]).toMatchObject({ method: 'card', methodLabel: 'Tarjeta', netAmountCents: 5000, amountCents: 5000, amount: 50, tipCents: 0 });
    expect(saved.tenders).toHaveLength(2);
    expect(saved.tenders[0]).toMatchObject({ method: 'cash', tenderedCents: 2000, netAmountCents: 0, changeCents: 2000 });
    expect(saved.tenders[1]).toMatchObject({ method: 'card', tenderedCents: 5000, netAmountCents: 5000, changeCents: 0 });
  });

  it('refuses to start checkout from malformed saved money without crashing the POS', async () => {
    const storage = installMemoryStorage();
    const invalidOrder = {
      folio: 'EVL-186-BAD', type: 'mesa', ref: 'Mesa 1', time: '12:00', user: 'Sofía',
      items: [{ prodId: 'concafe-americano', name: 'Americano', qty: 1, unit: -1, modsText: '', notes: '' }],
    };
    storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1', open: [invalidOrder], kitchenTickets: [invalidOrder], sales: [] }));
    const user = userEvent.setup();
    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);

    await user.click(await screen.findByRole('button', { name: /Órdenes abiertas/ }));
    await user.click(await screen.findByRole('button', { name: 'Cobrar' }));
    expect(await screen.findByText(/No se puede abrir el cobro: revisa productos, cantidades, precios y descuento/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reportes' })).toBeTruthy();
  });

  it('rejects checkout when the source account changes after checkout opens', async () => {
    const storage = installMemoryStorage();
    storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1' }));
    const user = userEvent.setup();

    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
    await user.click(await screen.findByRole('button', { name: /Órdenes abiertas/ }));
    await user.click((await screen.findAllByRole('button', { name: 'Cobrar' }))[0]);
    await screen.findByText('Revisa la orden');

    const changed = JSON.parse(storage.getItem('karma-pos-v1'));
    const originalFolios = changed.open.map(order => order.folio);
    changed.open.forEach(order => { order.ref = 'Mesa cambiada durante el cobro'; });
    storage.setItem('karma-pos-v1', JSON.stringify(changed));

    await user.click(screen.getByRole('button', { name: 'Continuar al pago' }));
    await screen.findByRole('textbox', { name: 'Monto con Efectivo' });
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: /Registrar pago/ }));

    expect(await screen.findByText(/La cuenta cambió mientras se confirmaba el cobro/, {}, { timeout: 4000 })).toBeTruthy();
    const afterAttempt = JSON.parse(storage.getItem('karma-pos-v1'));
    expect(afterAttempt.sales.some(sale => originalFolios.includes(sale.folio) && sale.status === 'completada')).toBe(false);
    expect(afterAttempt.open.every(order => order.ref === 'Mesa cambiada durante el cobro')).toBe(true);
  });

  it('rejects station checkout when its saved order changes after checkout opens', async () => {
    const storage = installMemoryStorage();
    const sourceOrder = { ...window.KARMA.seedOrders[0], items: window.KARMA.seedOrders[0].items.map(item => ({ ...item })) };
    storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1', order: sourceOrder }));
    const user = userEvent.setup();

    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
    await user.click(await screen.findByRole('button', { name: /^Cobrar / }));
    await screen.findByText('Revisa la orden');

    const changed = JSON.parse(storage.getItem('karma-pos-v1'));
    changed.order.items[0].qty += 1;
    storage.setItem('karma-pos-v1', JSON.stringify(changed));

    await user.click(screen.getByRole('button', { name: 'Continuar al pago' }));
    await screen.findByRole('textbox', { name: 'Monto con Efectivo' });
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: /Registrar pago/ }));

    expect(await screen.findByText(/La cuenta cambió mientras se confirmaba el cobro/, {}, { timeout: 4000 })).toBeTruthy();
    const afterAttempt = JSON.parse(storage.getItem('karma-pos-v1'));
    expect(afterAttempt.sales.some(sale => sale.folio === sourceOrder.folio && sale.status === 'completada')).toBe(false);
    expect(afterAttempt.order.items[0].qty).toBe(sourceOrder.items[0].qty + 1);
  });

  it('advances a seeded kitchen ticket and persists its preparation status', async () => {
    const storage = installMemoryStorage();
    storage.setItem('karma-pos-v1', JSON.stringify({ online: false, open: [window.KARMA.seedOrders[0]] }));
    const user = userEvent.setup();

    render(<ComandaApp />);
    await user.click(await screen.findByRole('button', { name: 'Marcar listo' }));

    expect(await screen.findByText('Listo')).toBeTruthy();
    expect(JSON.parse(storage.getItem('karma-pos-v1')).kitchenTickets[0].prep).toBe('listo');
    expect(JSON.parse(storage.getItem('karma-pos-v1')).open[0].prep).toBe('preparando');
  });

  it('resyncs a stale kitchen card without resurrecting cancellation or dropping a newer ticket', async () => {
    const storage = installMemoryStorage();
    const staleTicket = { ...window.KARMA.seedOrders[0], folio: 'A-STALE-185', prep: 'en-cola' };
    storage.setItem('karma-pos-v1', JSON.stringify({ kitchenTickets: [staleTicket] }));
    const user = userEvent.setup();
    render(<ComandaApp />);
    await screen.findByText('A-STALE-185');

    const persisted = JSON.parse(storage.getItem('karma-pos-v1'));
    const cancelled = { ...staleTicket, prep: 'cancelada', cancellationReason: 'Retiro', cancelledBy: 'Encargado' };
    const added = { ...staleTicket, folio: 'A-NEW-185', prep: 'en-cola', ref: 'Mesa nueva' };
    storage.setItem('karma-pos-v1', JSON.stringify({ ...persisted, kitchenTickets: [cancelled, added] }));
    await user.click(screen.getByRole('button', { name: 'Empezar preparación' }));

    const afterClick = JSON.parse(storage.getItem('karma-pos-v1')).kitchenTickets;
    expect(afterClick.find(ticket => ticket.folio === 'A-STALE-185').prep).toBe('cancelada');
    expect(afterClick.find(ticket => ticket.folio === 'A-NEW-185').prep).toBe('en-cola');
    expect(screen.queryByText('A-STALE-185')).toBeNull();
    expect(await screen.findByText('A-NEW-185')).toBeTruthy();
  });

  it.each(['en-cola', 'preparando', 'listo', 'entregado'])(
    'keeps a paid kitchen ticket at %s across POS and kitchen reloads', async prep => {
      const storage = installMemoryStorage();
      const ticket = {
        folio: 'A-185-TEST', type: 'mesa', ref: 'Mesa 7', time: '12:00', user: 'Sofía', prep, sync: 'sincronizada', name: 'Mesa 7', discount: 0,
        items: [{ prodId: 'concafe-americano', name: 'Americano', qty: 1, mods: { leche: ['avena'] }, modsText: 'Avena +$10', notes: 'Sin canela', unit: 60 }],
      };
      storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1', open: [ticket], kitchenTickets: [ticket] }));
      const user = userEvent.setup();

      const pos = render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
      await user.click(await screen.findByRole('button', { name: /Órdenes abiertas/ }));
      await user.click((await screen.findAllByRole('button', { name: 'Cobrar' }))[0]);
      await user.click(await screen.findByRole('button', { name: 'Continuar al pago' }));
      await screen.findByRole('textbox', { name: 'Monto con Efectivo' });
      await user.click(screen.getByRole('button', { name: 'Continuar' }));
      const registerPayment = await screen.findByRole('button', { name: /Registrar pago/ });
      await user.dblClick(registerPayment);
      expect(await screen.findByText('Pago registrado', {}, { timeout: 4000 })).toBeTruthy();

      const afterPayment = JSON.parse(storage.getItem('karma-pos-v1'));
      expect(afterPayment.sales.filter(sale => sale.folio === ticket.folio && sale.status === 'completada')).toHaveLength(1);
      expect(afterPayment.open).toEqual([]);
      expect(afterPayment.kitchenTickets).toHaveLength(1);
      expect(afterPayment.kitchenTickets[0]).toMatchObject({ folio: ticket.folio, ref: 'Mesa 7', prep, user: 'Sofía' });
      expect(afterPayment.kitchenTickets[0].items[0]).toMatchObject({ name: 'Americano', qty: 1, modsText: 'Avena +$10', notes: 'Sin canela' });

      pos.unmount();
      cleanup();
      const reloadedPos = render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
      await user.click(await screen.findByRole('button', { name: /Órdenes abiertas/ }));
      expect(screen.queryByText(ticket.folio)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Cobrar' })).toBeNull();
      reloadedPos.unmount();
      cleanup();

      let kitchenSafety;
      const reportKitchenSafety = next => { kitchenSafety = next; };
      let kitchen = render(<ComandaApp onUpdateSafetyChange={reportKitchenSafety} />);
      const terminal = prep === 'entregado';
      if (terminal) {
        expect(screen.queryByText(ticket.folio)).toBeNull();
        expect(kitchenSafety.status).toBe('safe');
        return;
      }

      await screen.findByText(ticket.folio);
      expect(kitchenSafety.status).toBe('blocked');
      expect(screen.getByText('Avena +$10')).toBeTruthy();
      expect(screen.getByText('“Sin canela”')).toBeTruthy();
      expect(screen.getByText(/Mesa 7/)).toBeTruthy();
      const nextAction = { 'en-cola': 'Empezar preparación', preparando: 'Marcar listo', listo: 'Marcar entregado' };
      let currentPrep = prep;
      while (currentPrep !== 'entregado') {
        await user.click(screen.getByRole('button', { name: nextAction[currentPrep] }));
        const expected = { 'en-cola': 'preparando', preparando: 'listo', listo: 'entregado' }[currentPrep];
        expect(JSON.parse(storage.getItem('karma-pos-v1')).kitchenTickets[0].prep).toBe(expected);
        currentPrep = expected;
        kitchen.unmount();
        cleanup();
        kitchen = render(<ComandaApp onUpdateSafetyChange={reportKitchenSafety} />);
        if (currentPrep !== 'entregado') await screen.findByText(ticket.folio);
      }
      expect(screen.queryByText(ticket.folio)).toBeNull();
      expect(JSON.parse(storage.getItem('karma-pos-v1')).kitchenTickets[0].prep).toBe('entregado');
      expect(kitchenSafety.status).toBe('safe');
    },
  );

  it('keeps inventory, report, user, and setting controls operable in the real POS', async () => {
    const storage = installMemoryStorage();
    storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1' }));
    const user = userEvent.setup();

    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
    await user.click(await screen.findByRole('button', { name: 'Inventario' }));
    await user.type(screen.getByRole('textbox', { name: 'Buscar insumo o ingrediente' }), 'Leche');
    expect(screen.getByText('Leche entera')).toBeTruthy();
    const lowOnly = screen.getByRole('button', { name: 'Solo stock bajo' });
    await user.click(lowOnly);
    expect(lowOnly.getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Recetas' }));
    expect(screen.getByText('Latte café')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Reportes' }));
    const range = screen.getByRole('button', { name: 'Últimos 7 días' });
    await user.click(range);
    expect(range.getAttribute('aria-pressed')).toBe('true');
    const saleRow = screen.getByRole('button', { name: /A-1047/ });
    await user.click(saleRow);
    expect(await screen.findByRole('dialog', { name: /A-1047/ })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(saleRow);

    await user.click(screen.getByRole('button', { name: 'Usuarios y configuración' }));
    await user.click(screen.getByRole('button', { name: 'Configuración' }));
    const print = screen.getByRole('switch', { name: 'Imprimir comanda automáticamente' });
    expect(print.getAttribute('aria-checked')).toBe('true');
    await user.click(print);
    expect(print.getAttribute('aria-checked')).toBe('false');
    expect(JSON.parse(storage.getItem('karma-pos-v1')).flags.autoprint).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Usuarios' }));
    await user.click(screen.getByRole('button', { name: 'Marcela Ortiz' }));
    const name = screen.getByRole('textbox', { name: 'Nombre completo' });
    await user.clear(name);
    await user.type(name, 'Marcela Demo');
    await user.click(screen.getByRole('button', { name: 'Guardar usuario' }));
    expect(await screen.findByRole('button', { name: 'Marcela Demo' })).toBeTruthy();
  });
});

describe('manual checkout tips and offline tender capture', () => {
  it('stores an arbitrary MXN tip exactly in centavos with its equivalent unusual percentage', async () => {
    const storage = installMemoryStorage();
    const ticket = {
      folio: 'A-123-CUSTOM', type: 'mesa', ref: 'Mesa 14', time: '12:00', user: 'Sofía', prep: 'en-cola', sync: 'sincronizada', name: 'Mesa 14', discount: 0,
      items: [{ prodId: 'concafe-americano', name: 'Americano', qty: 1, mods: {}, modsText: '', notes: '', unit: 60 }],
    };
    storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1', open: [ticket], kitchenTickets: [ticket] }));
    const user = userEvent.setup();
    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);

    await user.click(await screen.findByRole('button', { name: /Órdenes abiertas/ }));
    await user.click((await screen.findAllByRole('button', { name: 'Cobrar' }))[0]);
    await user.click(await screen.findByRole('button', { name: 'Continuar al pago' }));
    await user.click(screen.getByRole('button', { name: 'Otra' }));
    await user.type(screen.getByRole('textbox', { name: 'Monto de propina en pesos' }), '7.25');
    expect(screen.getByText(/Equivale a 12\.08%/)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Monto con Efectivo' }).value).toBe('67.25');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.dblClick(await screen.findByRole('button', { name: /Registrar pago/ }));
    await screen.findByText('Pago registrado', {}, { timeout: 4000 });

    const sale = JSON.parse(storage.getItem('karma-pos-v1')).sales.find(entry => entry.folio === ticket.folio);
    expect(sale).toMatchObject({ totalCents: 6725, tipCents: 725 });
    expect(sale.payments).toHaveLength(1);
    expect(sale.payments[0]).toMatchObject({ method: 'cash', netAmountCents: 6725, tipCents: 725, cashReceivedCents: 6725, changeCents: 0 });
  });

  it('allows 20% and an arbitrary MXN tip, captures mixed payments offline once, and preserves kitchen work', async () => {
    const storage = installMemoryStorage();
    const ticket = {
      folio: 'A-123-TEST', type: 'mesa', ref: 'Mesa 12', time: '12:00', user: 'Sofía', prep: 'en-cola', sync: 'sincronizada', name: 'Mesa 12', discount: 0,
      items: [{ prodId: 'concafe-americano', name: 'Americano', qty: 1, mods: {}, modsText: '', notes: 'Leche aparte', unit: 60 }],
    };
    storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1', open: [ticket], kitchenTickets: [ticket] }));
    const user = userEvent.setup();
    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);

    await screen.findByRole('button', { name: 'Punto de venta' });
    await user.click(screen.getByRole('button', { name: 'Simular pérdida de conexión' }));
    await user.click(await screen.findByRole('button', { name: /Órdenes abiertas/ }));
    await user.click((await screen.findAllByRole('button', { name: 'Cobrar' }))[0]);
    await user.click(await screen.findByRole('button', { name: 'Continuar al pago' }));

    await user.click(screen.getByRole('button', { name: 'Otra' }));
    await user.type(screen.getByRole('textbox', { name: 'Monto de propina en pesos' }), '7.25');
    expect(screen.getByText(/Equivale a 12\.08%/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '20%' }));
    expect(screen.getByText('$12.00')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Monto con Efectivo' }).value).toBe('72.00');

    const cash = screen.getByRole('textbox', { name: 'Monto con Efectivo' });
    await user.clear(cash);
    await user.type(cash, '20.00');
    await user.click(screen.getByRole('button', { name: '+ Dividir en otro método' }));
    const cardAmount = screen.getByRole('textbox', { name: 'Monto con Tarjeta' });
    await user.clear(cardAmount);
    await user.type(cardAmount, '30.00');
    await user.click(screen.getByRole('button', { name: '+ Dividir en otro método' }));
    const transferChoices = screen.getAllByRole('button', { name: 'Transferencia' });
    await user.click(transferChoices.at(-1));
    const transferAmount = screen.getByRole('textbox', { name: 'Monto con Transferencia' });
    await user.clear(transferAmount);
    await user.type(transferAmount, '22.00');
    expect(screen.getAllByText(/autorización externa no está verificada/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    const registerPayment = await screen.findByRole('button', { name: /Registrar pago/ });
    await user.dblClick(registerPayment);
    expect(await screen.findByText('Pago registrado', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText(/autorización externa no está verificada/)).toBeTruthy();

    const saved = JSON.parse(storage.getItem('karma-pos-v1'));
    const sale = saved.sales.find(entry => entry.folio === ticket.folio);
    expect(saved.sales.filter(entry => entry.folio === ticket.folio && entry.status === 'completada')).toHaveLength(1);
    expect(sale).toMatchObject({ totalCents: 7200, tipCents: 1200, externalPaymentVerification: 'manual_unverified', paymentRecordMode: 'manual' });
    expect(sale.payments.map(payment => [payment.method, payment.netAmountCents])).toEqual([['cash', 2000], ['card', 3000], ['transfer', 2200]]);
    expect(sale.payments.every(payment => payment.recordMode === 'manual')).toBe(true);
    expect(sale.payments.filter(payment => payment.method !== 'cash').every(payment => payment.verificationStatus === 'manual_unverified')).toBe(true);
    expect(sale.payments.reduce((sum, payment) => sum + payment.tipCents, 0)).toBe(1200);
    expect(saved.kitchenTickets).toMatchObject([{ folio: ticket.folio, prep: 'en-cola', ref: 'Mesa 12', items: [{ notes: 'Leche aparte' }] }]);
    expect(saved.open).toEqual([]);
  });
});
