import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStorage } from "../../data/pos-store.ts";
import type { JournalStorage } from "../../data/pos-store.ts";
import { emptyState } from "../../domain/journal.ts";
import { setProductAvailability, setProductPrice } from "../../domain/menu.ts";
import { admin, catalog, latte, luis, meta } from "../../domain/testing.ts";
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

describe("EVL-119 [A] Review regressions", () => {
  it("an open modifier dialog does not add a product that became Agotado", async () => {
    const app = await renderApp(<App />, { as: "barra" });
    await click(saleButton("Latte"));
    const dialog = within(screen.getByRole("dialog"));
    await act(async () => {
      await app.store.run((state) =>
        setProductAvailability(
          state,
          meta("sold-out", luis),
          { productId: latte.id, available: false },
          catalog,
        ),
      );
    });
    await click(dialog.getByRole("button", { name: /^Agregar/ }));
    expect(
      within(
        screen.getAllByRole("region", { name: "Orden actual" })[0],
      ).getAllByText("Sin productos").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Este producto está agotado.").length,
    ).toBeGreaterThan(0);
    app.store.close();
  });

  it("a second tap on a pending switch is ignored", async () => {
    const backing = createMemoryStorage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    const storage: JournalStorage = {
      ...backing,
      append: async (batch) => {
        writes++;
        await gate;
        await backing.append(batch);
      },
    };
    const app = await renderApp(<App />, { as: "barra", storage });
    goTo("#/menu");
    const toggle = () =>
      row("Croissant Dulce").getByRole("switch", { name: "Disponible" });
    await click(toggle());
    await waitFor(() => expect(writes).toBe(1));
    await click(toggle());
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(toggle().getAttribute("aria-checked")).toBe("false"),
    );
    expect(writes).toBe(1);
    app.store.close();
  });

  it("Mesero sent to #/menu sees Venta marked as the current section", async () => {
    const app = await renderApp(<App />, { as: "mesero" });
    goTo("#/menu");
    expect(
      screen.getByRole("link", { name: "Venta" }).getAttribute("aria-current"),
    ).toBe("page");
    app.store.close();
  });

  it("closing the price dialog returns focus to its button", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    await openPriceEditor("Latte");
    await click(screen.getByRole("button", { name: "Cancelar" }));
    expect(document.activeElement).toBe(
      row("Latte").getByRole("button", { name: "Cambiar precio de Latte" }),
    );
    app.store.close();
  });
});

function dialog() {
  return within(screen.getByRole("dialog"));
}

async function fillNewProduct(fields: {
  name?: string;
  category?: string;
  price?: string;
  sku?: string;
}) {
  const form = dialog();
  if (fields.name !== undefined) {
    await userEvent.clear(form.getByLabelText("Nombre"));
    if (fields.name !== "")
      await userEvent.type(form.getByLabelText("Nombre"), fields.name);
  }
  if (fields.category !== undefined) {
    await userEvent.selectOptions(
      form.getByLabelText("Categoría"),
      fields.category,
    );
  }
  if (fields.price !== undefined) {
    await userEvent.clear(form.getByLabelText("Precio"));
    await userEvent.type(form.getByLabelText("Precio"), fields.price);
  }
  if (fields.sku !== undefined) {
    await userEvent.clear(form.getByLabelText("SKU"));
    await userEvent.type(form.getByLabelText("SKU"), fields.sku);
  }
}

describe("EVL-119 [B] Crear y editar productos", () => {
  it("[B] Admin crea un producto con el SKU sugerido", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    await click(screen.getByRole("button", { name: "Nuevo producto" }));
    expect(
      screen.getByRole("dialog", { name: "Nuevo producto" }),
    ).toBeDefined();
    expect((dialog().getByLabelText("SKU") as HTMLInputElement).value).toBe(
      "52000822227",
    );
    await fillNewProduct({
      name: "Chai Sucio",
      category: "Bebidas",
      price: "75",
    });
    await click(dialog().getByRole("button", { name: "Guardar producto" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    const bebidas = within(screen.getByRole("region", { name: "Bebidas" }));
    const chai = within(bebidas.getByRole("listitem", { name: "Chai Sucio" }));
    expect(chai.getByText("$75.00")).toBeDefined();
    expect(chai.getByText("SKU 52000822227")).toBeDefined();

    await click(screen.getByRole("button", { name: "Nuevo producto" }));
    expect((dialog().getByLabelText("SKU") as HTMLInputElement).value).toBe(
      "52000822228",
    );
    await click(dialog().getByRole("button", { name: "Cancelar" }));

    goTo("#/");
    expect(saleButton("Chai Sucio").textContent).toContain("$75.00");
    app.store.close();
  });

  it("[B] Admin cambia el SKU sugerido antes de guardar", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    await click(screen.getByRole("button", { name: "Nuevo producto" }));
    await fillNewProduct({
      name: "Agua Mineral 600 ml",
      category: "Bebidas",
      price: "30",
      sku: "7501055300075",
    });
    await click(dialog().getByRole("button", { name: "Guardar producto" }));
    expect(
      row("Agua Mineral 600 ml").getByText("SKU 7501055300075"),
    ).toBeDefined();
    app.store.close();
  });

  it("[B] No se guarda un producto incompleto o con SKU repetido", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    await click(screen.getByRole("button", { name: "Nuevo producto" }));
    const save = () =>
      click(dialog().getByRole("button", { name: "Guardar producto" }));
    const alertText = () => dialog().getByRole("alert").textContent;

    await fillNewProduct({ name: "   ", price: "75" });
    await save();
    expect(alertText()).toBe("Escribe el nombre del producto.");

    await fillNewProduct({ name: "Chai Sucio" });
    await save();
    expect(alertText()).toBe("Elige una categoría.");

    await fillNewProduct({ category: "Bebidas", price: "0" });
    await save();
    expect(alertText()).toBe("Escribe un precio mayor a $0.00.");

    await fillNewProduct({ price: "75", sku: "abc" });
    await save();
    expect(alertText()).toBe("El SKU solo lleva números.");

    await fillNewProduct({ sku: "52000822148" });
    await save();
    expect(alertText()).toBe("Ya existe un producto con ese SKU.");

    expect(app.store.getState().menu.created).toEqual([]);
    app.store.close();
  });

  it("[B] Admin renombra un producto y lo cambia de categoría", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    await click(
      row("Croissant Dulce").getByRole("button", {
        name: "Editar Croissant Dulce",
      }),
    );
    expect(
      screen.getByRole("dialog", { name: "Editar producto" }),
    ).toBeDefined();
    expect((dialog().getByLabelText("Nombre") as HTMLInputElement).value).toBe(
      "Croissant Dulce",
    );
    expect(dialog().getByText("SKU 52000822188")).toBeDefined();
    expect(dialog().queryByLabelText("SKU")).toBeNull();
    await userEvent.clear(dialog().getByLabelText("Nombre"));
    await userEvent.type(
      dialog().getByLabelText("Nombre"),
      "  Croissant de Mermelada ",
    );
    await userEvent.selectOptions(
      dialog().getByLabelText("Categoría"),
      "Salado",
    );
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    const salado = within(screen.getByRole("region", { name: "Salado" }));
    expect(
      within(
        salado.getByRole("listitem", { name: "Croissant de Mermelada" }),
      ).getByText("SKU 52000822188"),
    ).toBeDefined();
    expect(
      within(screen.getByRole("region", { name: "Postres" })).queryByRole(
        "listitem",
        { name: "Croissant Dulce" },
      ),
    ).toBeNull();
    goTo("#/");
    expect(saleButton("Croissant de Mermelada")).toBeDefined();
    app.store.close();
  });

  it("[B] Admin oculta un producto y lo vuelve a mostrar", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    const crepa = "Crepa de Champiñones c/Queso";
    goTo("#/menu");
    await click(row(crepa).getByRole("button", { name: `Ocultar ${crepa}` }));
    expect(row(crepa).getByText("Oculto")).toBeDefined();

    goTo("#/");
    const sale = within(screen.getByRole("region", { name: "Menú" }));
    expect(
      sale.queryByRole("button", { name: /^Crepa de Champiñones/ }),
    ).toBeNull();
    await userEvent.type(sale.getByLabelText("Buscar producto"), "champi");
    expect(
      sale.queryByRole("button", { name: /^Crepa de Champiñones/ }),
    ).toBeNull();

    goTo("#/menu");
    await click(row(crepa).getByRole("button", { name: `Mostrar ${crepa}` }));
    expect(row(crepa).queryByText("Oculto")).toBeNull();
    goTo("#/");
    expect(saleButton(crepa)).toBeDefined();
    app.store.close();
  });

  it("[B] Solo Admin crea, renombra, mueve u oculta productos", async () => {
    const app = await renderApp(<App />, { as: "barra" });
    goTo("#/menu");
    expect(screen.queryByRole("button", { name: "Nuevo producto" })).toBeNull();
    expect(
      row("Latte").queryByRole("button", { name: "Editar Latte" }),
    ).toBeNull();
    expect(
      row("Latte").queryByRole("button", { name: "Ocultar Latte" }),
    ).toBeNull();
    expect(
      row("Latte").getByRole("switch", { name: "Disponible" }),
    ).toBeDefined();
    app.store.close();
  });
});
