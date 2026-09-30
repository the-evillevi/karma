// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button.jsx';
import { Input } from './input.jsx';
import { Label } from './label.jsx';
import PosApp from '../../PosApp.jsx';
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
});
