import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStorage } from "../../data/pos-store.ts";
import { emptyState } from "../../domain/journal.ts";
import { setProductPrice } from "../../domain/menu.ts";
import { admin, catalog, latte } from "../../domain/testing.ts";
import { App } from "../App.tsx";
import { renderApp } from "../testing.tsx";

function goTo(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

beforeEach(() => window.localStorage.clear());
afterEach(() => goTo(""));

const click = (element: HTMLElement) => userEvent.click(element);

function row(name: string) {
  return within(screen.getByRole("listitem", { name }));
}

function saleButton(name: string) {
  return within(screen.getByRole("region", { name: "Menú" })).getByRole(
    "button",
    { name: new RegExp(`^${name}\\s*\\$`) },
  );
}

function navLinks(): string[] {
  const nav = screen.getByRole("navigation", { name: "Secciones" });
  return Array.from(nav.querySelectorAll("a")).map(
    (link) => link.textContent ?? "",
  );
}

async function openPriceEditor(name: string) {
  await click(
    row(name).getByRole("button", { name: `Cambiar precio de ${name}` }),
  );
  return screen.getByLabelText(`Precio de ${name}`);
}

describe("EVL-119 [A] Pantalla Menú", () => {
  it("[A] Admin cambia el precio de un producto", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    expect(navLinks()).toContain("Menú");
    goTo("#/menu");
    expect(screen.getByRole("heading", { name: "Menú" })).toBeDefined();
    expect(
      within(screen.getByRole("region", { name: "Bebidas" })).getByRole(
        "listitem",
        { name: "Latte" },
      ),
    ).toBeDefined();
    expect(row("Latte").getByText("$65.00")).toBeDefined();

    const price = await openPriceEditor("Latte");
    await userEvent.clear(price);
    await userEvent.type(price, "70");
    await click(screen.getByRole("button", { name: "Guardar precio" }));

    expect(row("Latte").getByText("$70.00")).toBeDefined();
    expect(screen.queryByLabelText("Precio de Latte")).toBeNull();
    expect(row("Latte").getByText(/^Editado por Admin · /)).toBeDefined();
    expect(app.store.getState().menu.products[latte.id].changes).toEqual({
      priceCents: 7000,
    });

    await userEvent.type(screen.getByLabelText("Buscar producto"), "honey");
    const names = screen
      .getAllByRole("listitem")
      .map((item) => item.getAttribute("aria-label"));
    expect(names).toEqual(["Americano Honey", "Latte Honey"]);

    goTo("#/");
    expect(saleButton("Latte").textContent).toContain("$70.00");
    app.store.close();
  });

  it("[A] Barra marca un producto como agotado y lo vuelve a habilitar", async () => {
    const app = await renderApp(<App />, { as: "barra" });
    expect(navLinks()).toContain("Menú");
    goTo("#/menu");
    const available = row("Croissant Dulce").getByRole("switch", {
      name: "Disponible",
    });
    expect(available.getAttribute("aria-checked")).toBe("true");
    await click(available);
    expect(
      row("Croissant Dulce")
        .getByRole("switch", { name: "Disponible" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(row("Croissant Dulce").getByText("Agotado")).toBeDefined();

    goTo("#/");
    expect(saleButton("Croissant Dulce").hasAttribute("disabled")).toBe(true);
    expect(saleButton("Croissant Dulce").textContent).toContain("Agotado");

    goTo("#/menu");
    await click(
      row("Croissant Dulce").getByRole("switch", { name: "Disponible" }),
    );
    goTo("#/");
    expect(saleButton("Croissant Dulce").hasAttribute("disabled")).toBe(false);
    app.store.close();
  });

  it("[A] Un precio inválido no se guarda", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    const price = await openPriceEditor("Latte");
    for (const text of ["0", "", "abc", "12.345"]) {
      await userEvent.clear(price);
      if (text !== "") await userEvent.type(price, text);
      await click(screen.getByRole("button", { name: "Guardar precio" }));
      expect(screen.getByRole("alert").textContent).toBe(
        "Escribe un precio mayor a $0.00.",
      );
    }
    await click(screen.getByRole("button", { name: "Cancelar" }));
    expect(row("Latte").getByText("$65.00")).toBeDefined();
    expect(app.store.getState().menu.products).toEqual({});
    app.store.close();
  });

  it("[A] Solo Admin cambia precios y Mesero no ve Menú", async () => {
    const barra = await renderApp(<App />, { as: "barra" });
    goTo("#/menu");
    expect(row("Latte").getByText("$65.00")).toBeDefined();
    expect(
      row("Latte").queryByRole("button", { name: "Cambiar precio de Latte" }),
    ).toBeNull();
    expect(
      row("Latte").getByRole("switch", { name: "Disponible" }),
    ).toBeDefined();
    barra.store.close();
    barra.unmount();
    goTo("");

    const mesero = await renderApp(<App />, { as: "mesero" });
    expect(navLinks()).toEqual([
      "Venta",
      "Cuentas abiertas",
      "Cocina",
      "Ventas de hoy",
    ]);
    goTo("#/menu");
    expect(screen.getByRole("heading", { name: "Venta" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Menú" })).toBeNull();
    mesero.store.close();
  });

  it("[A] El producto muestra quién lo editó y cuándo", async () => {
    const edit = setProductPrice(
      emptyState(),
      {
        commandId: "price-1",
        at: "2026-11-17T18:40:00.000-06:00",
        actor: admin,
        deviceId: "caja-1",
      },
      { productId: latte.id, priceCents: 7000 },
      catalog,
    );
    const app = await renderApp(<App />, {
      as: "barra",
      storage: createMemoryStorage([edit]),
    });
    goTo("#/menu");
    expect(
      row("Latte").getByText("Editado por Admin · 17 nov, 18:40"),
    ).toBeDefined();
    expect(row("Latte").getByText("$70.00")).toBeDefined();
    expect(row("Americano").queryByText(/^Editado por/)).toBeNull();
    app.store.close();
  });
});
