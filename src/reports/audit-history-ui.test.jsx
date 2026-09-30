// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import React from "react";
import { afterEach, beforeAll, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PosApp from "../PosApp.jsx";
import "../karma-data.js";
import { applyInventoryMovement, createInitialInventoryState } from "../inventory/inventory-ledger.mjs";
import { posAccessStorageKey } from "../access/pos-storage-key.ts";

afterEach(cleanup);
beforeAll(() => { HTMLElement.prototype.scrollIntoView ??= () => {}; });

const storageKey = posAccessStorageKey("secure", "audit-branch", "audit-register");
const context = (role = "duena") => {
  const now = Date.now();
  return {
    userId: `audit-${role}`,
    displayName: role === "barra" ? "Barra" : "Marcela Ortiz",
    role,
    branchId: "audit-branch",
    deviceId: "audit-register",
    sessionId: "audit-session",
    capability: "cash_register",
    leaseId: "audit-lease",
    expiresAt: new Date(now + 3_600_000).toISOString(),
    verifiedAt: new Date(now).toISOString(),
  };
};
const props = (role = "duena") => ({
  accessMode: "secure",
  accessContext: context(role),
  accessStorageKey: storageKey,
  accessBranchId: "audit-branch",
  accessDeviceId: "audit-register",
  branchTimeZone: "America/Mexico_City",
  accessScreen: <main>Acceso seguro</main>,
});

function memory(value) {
  const values = new Map([[storageKey, JSON.stringify(value)]]);
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, nextValue) => values.set(key, String(nextValue)),
    removeItem: (key) => values.delete(key),
  } });
}

function inventoryHistory() {
  const seed = createInitialInventoryState([
    { id: "beans", name: "Café en grano", kind: "Ingrediente", qty: 6.5, unit: "kg", min: 3 },
  ], "2026-09-30T05:00:00.000Z");
  return applyInventoryMovement(seed, {
    commandId: "audit-entry-1",
    itemId: "beans",
    kind: "entry",
    quantityText: "0.5",
    unit: "kg",
    expectedRevision: 0,
    actorId: "owner-audit",
    actorName: "Marcela Ortiz",
    occurredAt: "2026-09-30T07:00:00.000Z",
    reason: "Compra verificada con nota local.",
    itemNameSnapshot: "Café en grano",
    itemKindSnapshot: "Ingrediente",
  }).state;
}

async function openHistory(user) {
  await user.click(await screen.findByRole("button", { name: "Reportes" }));
  await user.click(screen.getByRole("button", { name: "Historial de cambios" }));
  await screen.findByRole("region", { name: "Historial de cambios" });
}

it("filters actual local events by date, entity, action, and actor, then shows field-level before and after", async () => {
  const inventoryState = inventoryHistory();
  const savedRecord = { inventoryState, sales: [] };
  memory(savedRecord);
  const user = userEvent.setup();
  render(<PosApp {...props()} />);
  await user.click(await screen.findByRole("button", { name: "Reportes" }));
  const storageBeforeHistory = window.localStorage.getItem(storageKey);
  await user.click(screen.getByRole("button", { name: "Historial de cambios" }));
  await screen.findByRole("region", { name: "Historial de cambios" });
  expect(window.localStorage.getItem(storageKey)).toBe(storageBeforeHistory);

  expect(screen.getByText(/no contienen versiones remotas/i)).toBeTruthy();
  const table = screen.getByRole("region", { name: "Cambios locales de inventario y recetas" });
  expect(within(table).getByText("Café en grano")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Desde (incluida)"), { target: { value: "2026-09-30" } });
  fireEvent.change(screen.getByLabelText("Hasta (incluida)"), { target: { value: "2026-09-30" } });
  await user.selectOptions(screen.getByRole("combobox", { name: "Entidad" }), "inventory");
  await user.selectOptions(screen.getByRole("combobox", { name: "Acción" }), "entry");
  await user.selectOptions(screen.getByRole("combobox", { name: "Persona" }), "owner-audit");
  expect(screen.getByText("1 cambio")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Ver cambio Entrada de existencias · Café en grano" }));
  const detail = screen.getByRole("region", { name: "Detalle del cambio Entrada de existencias · Café en grano" });
  expect(within(detail).getByText("Compra verificada con nota local.")).toBeTruthy();
  expect(within(detail).getByText("6.5 kg")).toBeTruthy();
  expect(within(detail).getByText("7 kg")).toBeTruthy();
  expect(within(detail).getByText("Marcela Ortiz · owner-audit")).toBeTruthy();
  expect(within(detail).getByText(/America\/Mexico_City/)).toBeTruthy();

  await user.selectOptions(screen.getByRole("combobox", { name: "Entidad" }), "conflict");
  expect(screen.getByText(/No hay eventos locales verificables de resolución/)).toBeTruthy();
  expect(screen.getByText("0 cambios")).toBeTruthy();
});

it("hides the history after secure viewReports access is lost", async () => {
  memory({ inventoryState: inventoryHistory() });
  const user = userEvent.setup();
  const view = render(<PosApp {...props("duena")} />);
  await openHistory(user);
  expect(screen.getByRole("region", { name: "Historial de cambios" })).toBeTruthy();

  view.rerender(<PosApp {...props("barra")} />);
  await waitFor(() => expect(screen.queryByRole("region", { name: "Historial de cambios" })).toBeNull());
  expect(screen.queryByRole("heading", { name: "Reportes" })).toBeNull();
});

it("fails closed and keeps the operator-facing error when local inventory history is corrupt", async () => {
  const good = inventoryHistory();
  memory({ inventoryState: { ...good, entries: good.entries.slice(1) } });
  const user = userEvent.setup();
  render(<PosApp {...props()} />);
  await openHistory(user);
  expect((await screen.findByRole("alert")).textContent).toContain("El historial local requiere revisión. No se muestran cambios.");
  expect(screen.queryByRole("table", { name: "Cambios locales de inventario y recetas" })).toBeNull();
});
