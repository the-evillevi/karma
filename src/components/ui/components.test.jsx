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

  it('advances a seeded kitchen ticket and persists its preparation status', async () => {
    const storage = installMemoryStorage();
    storage.setItem('karma-pos-v1', JSON.stringify({ online: false, open: [window.KARMA.seedOrders[0]] }));
    const user = userEvent.setup();

    render(<ComandaApp />);
    await user.click(await screen.findByRole('button', { name: 'Marcar listo' }));

    expect(await screen.findByText('Listo')).toBeTruthy();
    expect(JSON.parse(storage.getItem('karma-pos-v1')).open[0].prep).toBe('listo');
  });

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
