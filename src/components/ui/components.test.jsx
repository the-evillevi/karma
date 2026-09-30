// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import React from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button.jsx';
import { Input } from './input.jsx';
import { Label } from './label.jsx';
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

    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
    await screen.findByRole('button', { name: 'Menú' });
    await user.click(screen.getByRole('button', { name: 'Menú' }));
    await user.click(screen.getByRole('button', { name: /^Americano Con café \$50\.00 Activo$/ }));

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
  });

  it('completes a seeded open-order checkout through labeled shared payment controls', async () => {
    const storage = installMemoryStorage();
    storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1' }));
    const user = userEvent.setup();

    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
    await user.click(await screen.findByRole('button', { name: /Órdenes abiertas/ }));
    const chargeButtons = await screen.findAllByRole('button', { name: 'Cobrar' });
    await user.click(chargeButtons[0]);

    expect(await screen.findByText('Revisa la orden')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continuar al pago' }));
    const amount = await screen.findByRole('textbox', { name: 'Monto con Efectivo' });
    expect(amount).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: /Registrar pago/ }));

    expect(await screen.findByText('Pago registrado', {}, { timeout: 4000 })).toBeTruthy();
  });

  it('keeps captured legacy prices and labels after catalog edits, resume, reload, and checkout', async () => {
    const storage = installMemoryStorage();
    const originalGroups = JSON.stringify(window.KARMA.modGroups);
    const products = window.KARMA.products.map(product => product.id === 'concafe-americano'
      ? { ...product, name: 'Americano renovado', price: 80, available: false }
      : { ...product });
    const account = {
      folio: 'A-188-PRICE', type: 'local', ref: 'En local', time: '12:00', user: 'Marcela',
      prep: 'en-cola', sync: 'sincronizada', discount: 10,
      items: [
        { prodId: 'concafe-americano', name: 'Americano', qty: 1, mods: {}, modsText: '', notes: '', unit: 50 },
        { prodId: 'concafe-americano', name: 'Americano', qty: 1, mods: { leche: ['avena'] }, modsText: 'Avena +$10', notes: '', unit: 60 },
      ],
    };
    storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1', prods: products, open: [account], kitchenTickets: [account] }));
    window.KARMA.modGroups.leche.options.find(option => option.id === 'avena').label = 'Bebida vegetal nueva';
    window.KARMA.modGroups.leche.options.find(option => option.id === 'avena').price = 25;
    const user = userEvent.setup();

    const pos = render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
    await user.click(await screen.findByRole('button', { name: /Órdenes abiertas/ }));
    expect(await screen.findByText('1× Americano · 1× Americano')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    expect(await screen.findByText('Avena +$10')).toBeTruthy();
    expect(screen.getByText('$50.00')).toBeTruthy();
    expect(screen.getAllByText('$60.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole('button', { name: 'Aumentar Americano' })[0]);
    expect(screen.getAllByText('$150.00').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Guardar cuenta' }));
    const saved = JSON.parse(storage.getItem('karma-pos-v1'));
    expect(saved.open[0].items.map(item => item.unit)).toEqual([50, 60]);
    expect(saved.open[0].items[1].modsText).toBe('Avena +$10');

    pos.unmount();
    cleanup();
    const reloaded = render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
    await user.click(await screen.findByRole('button', { name: /Órdenes abiertas/ }));
    await user.click((await screen.findAllByRole('button', { name: 'Cobrar' }))[0]);
    expect(await screen.findByText('Revisa la orden')).toBeTruthy();
    expect(screen.getAllByText('$150.00').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Continuar al pago' }));
    await screen.findByRole('textbox', { name: 'Monto con Efectivo' });
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: /Registrar pago/ }));
    await screen.findByText('Pago registrado', {}, { timeout: 4000 });
    const paid = JSON.parse(storage.getItem('karma-pos-v1')).sales.find(sale => sale.folio === account.folio);
    expect(paid).toMatchObject({ total: 150, status: 'completada' });
    expect(paid.items).toEqual([
      { name: 'Americano', qty: 2, mods: '', total: 100 },
      { name: 'Americano', qty: 1, mods: 'Avena +$10', total: 60 },
    ]);
    reloaded.unmount();
    window.KARMA.modGroups = JSON.parse(originalGroups);
  });

  it('stores fresh product and modifier capture facts on a new open account', async () => {
    const storage = installMemoryStorage();
    storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1', open: [] }));
    const user = userEvent.setup();

    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
    await user.click(await screen.findByRole('button', { name: 'Americano, $50.00' }));
    await user.click(await screen.findByRole('button', { name: /Avena \+\$10/ }));
    await user.click(screen.getByRole('button', { name: 'Agregar · $60.00' }));
    await user.click(screen.getByRole('button', { name: 'Aumentar Americano' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cuenta' }));

    const saved = JSON.parse(storage.getItem('karma-pos-v1'));
    expect(saved.open[0].items[0]).toMatchObject({
      name: 'Americano',
      productNameSnapshot: 'Americano',
      qty: 2,
      unit: 60,
      modsText: 'Avena +$10',
      capturedSnapshot: {
        baseUnitPriceCents: 5000,
        modifiersTotalCents: 1000,
        unitPriceCents: 6000,
        quantity: 2,
        lineTotalCents: 12000,
        modifiers: [{ optionId: 'avena', optionName: 'Avena', priceEffectCents: 1000 }],
      },
    });
  });

  it('refuses to price an uncaptured historical line from the current catalog', async () => {
    const storage = installMemoryStorage();
    const products = window.KARMA.products.map(product => product.id === 'concafe-americano'
      ? { ...product, name: 'Americano actual', price: 80 }
      : { ...product });
    const account = {
      folio: 'A-188-MISSING-PRICE', type: 'local', ref: 'En local', time: '12:00', user: 'Marcela',
      prep: 'en-cola', sync: 'sincronizada', discount: 0,
      items: [{ prodId: 'concafe-americano', name: 'Americano', qty: 1, mods: {}, modsText: '', notes: '' }],
    };
    storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1', prods: products, open: [account], kitchenTickets: [account] }));
    const user = userEvent.setup();

    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
    await user.click(await screen.findByRole('button', { name: /Órdenes abiertas/ }));
    expect(await screen.findByText('Precio por verificar')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cobrar' }));
    expect(await screen.findByText(/Hay productos sin precio capturado/)).toBeTruthy();
    expect(screen.queryByText('Revisa la orden')).toBeNull();
  });

  it('requires an explicit remove-and-readd before changing a captured modifier', async () => {
    const storage = installMemoryStorage();
    const account = {
      folio: 'A-188-MODIFIER-GUARD', type: 'local', ref: 'En local', time: '12:00', user: 'Marcela',
      prep: 'en-cola', sync: 'sincronizada', discount: 0,
      items: [{ prodId: 'concafe-americano', name: 'Americano', qty: 1, mods: { leche: ['entera'] }, modsText: 'Entera', notes: '', unit: 50 }],
    };
    storage.setItem('karma-pos-v1', JSON.stringify({ session: 'u1', open: [account], kitchenTickets: [account] }));
    const user = userEvent.setup();

    render(<PosApp vistaCatalogo="cuadricula" mostrarAgotados propinaInicial="0" />);
    await user.click(await screen.findByRole('button', { name: /Órdenes abiertas/ }));
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.click(await screen.findByRole('button', { name: 'Editar partida' }));
    await user.click(screen.getByRole('button', { name: /Avena \+\$10/ }));
    await user.click(screen.getByRole('button', { name: 'Guardar · $50.00' }));
    expect(await screen.findByText(/Para cambiar modificadores, elimina el producto y agrégalo de nuevo/)).toBeTruthy();
    expect(JSON.parse(storage.getItem('karma-pos-v1')).order.items[0]).toMatchObject({ unit: 50, mods: { leche: ['entera'] } });
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

      let kitchen = render(<ComandaApp />);
      const terminal = prep === 'entregado';
      if (terminal) {
        expect(screen.queryByText(ticket.folio)).toBeNull();
        return;
      }

      await screen.findByText(ticket.folio);
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
        kitchen = render(<ComandaApp />);
        if (currentPrep !== 'entregado') await screen.findByText(ticket.folio);
      }
      expect(screen.queryByText(ticket.folio)).toBeNull();
      expect(JSON.parse(storage.getItem('karma-pos-v1')).kitchenTickets[0].prep).toBe('entregado');
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
