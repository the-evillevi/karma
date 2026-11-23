import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStorage } from "../../data/pos-store.ts";
import type { JournalStorage } from "../../data/pos-store.ts";
import { applyBatch, emptyState } from "../../domain/journal.ts";
import type { CommandBatch } from "../../domain/journal.ts";
import {
  createCategory,
  createModifierGroup,
  setProductAvailability,
  setProductGroups,
  setProductPrice,
  updateCategory,
  updateModifierOption,
  updateProduct,
} from "../../domain/menu.ts";
import { saveOrder } from "../../domain/commands.ts";
import { resolveModifiers } from "../../domain/modifiers.ts";
import { addLine } from "../../domain/order.ts";
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
      screen.getAllByText("Este producto ya no está a la venta.").length,
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

describe("EVL-119 [B] Review regressions", () => {
  it("an open edit dialog does not undo a change made elsewhere to a field it did not touch", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    await click(
      row("Croissant Dulce").getByRole("button", {
        name: "Editar Croissant Dulce",
      }),
    );
    await act(async () => {
      await app.store.run((state) =>
        updateProduct(
          state,
          meta("other-tab", admin),
          { productId: "52000822188", categoryId: "salado" },
          catalog,
        ),
      );
    });
    expect(
      (dialog().getByLabelText("Categoría") as HTMLSelectElement).value,
    ).toBe("salado");
    await userEvent.clear(dialog().getByLabelText("Nombre"));
    await userEvent.type(
      dialog().getByLabelText("Nombre"),
      "Croissant de Mermelada",
    );
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    expect(app.store.getState().menu.products["52000822188"].changes).toEqual({
      categoryId: "salado",
      name: "Croissant de Mermelada",
    });
    app.store.close();
  });

  it("focus returns to the Editar button after the product moves to another category", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    await click(
      row("Croissant Dulce").getByRole("button", {
        name: "Editar Croissant Dulce",
      }),
    );
    await userEvent.selectOptions(
      dialog().getByLabelText("Categoría"),
      "Salado",
    );
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(screen.getByRole("region", { name: "Salado" })).getByRole(
          "button",
          { name: "Editar Croissant Dulce" },
        ),
      ),
    );
    app.store.close();
  });
});

function categoryHeadings(): string[] {
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent ?? "");
}

function saleChips(): string[] {
  return within(screen.getByRole("group", { name: "Categorías" }))
    .getAllByRole("button")
    .map((chip) => chip.textContent ?? "")
    .filter((name) => name !== "Todos");
}

function section(name: string) {
  return within(screen.getByRole("region", { name }));
}

describe("EVL-119 [C] Categorías", () => {
  it("[C] Admin crea una categoría", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    await click(screen.getByRole("button", { name: "Nueva categoría" }));
    expect(
      screen.getByRole("dialog", { name: "Nueva categoría" }),
    ).toBeDefined();
    await click(dialog().getByRole("button", { name: "Guardar categoría" }));
    expect(dialog().getByRole("alert").textContent).toBe(
      "Escribe el nombre de la categoría.",
    );
    await userEvent.type(dialog().getByLabelText("Nombre"), "cafe");
    await click(dialog().getByRole("button", { name: "Guardar categoría" }));
    expect(dialog().getByRole("alert").textContent).toBe(
      "Ya existe una categoría con ese nombre.",
    );
    await userEvent.clear(dialog().getByLabelText("Nombre"));
    await userEvent.type(dialog().getByLabelText("Nombre"), "  Bebidas Frías ");
    await click(dialog().getByRole("button", { name: "Guardar categoría" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(categoryHeadings().at(-1)).toBe("Bebidas Frías");
    expect(section("Bebidas Frías").getByText("Sin productos")).toBeDefined();
    await click(screen.getByRole("button", { name: "Nuevo producto" }));
    expect(
      dialog().getByRole("option", { name: "Bebidas Frías" }),
    ).toBeDefined();
    await click(dialog().getByRole("button", { name: "Cancelar" }));

    goTo("#/");
    expect(saleChips().at(-1)).toBe("Bebidas Frías");
    app.store.close();
  });

  it("[C] Admin renombra una categoría", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    await click(
      screen.getByRole("button", { name: "Renombrar categoría Extras" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Renombrar categoría" }),
    ).toBeDefined();
    expect((dialog().getByLabelText("Nombre") as HTMLInputElement).value).toBe(
      "Extras",
    );
    await userEvent.clear(dialog().getByLabelText("Nombre"));
    await userEvent.type(
      dialog().getByLabelText("Nombre"),
      "Extras y Toppings",
    );
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    expect(categoryHeadings()).toEqual([
      "Bebidas",
      "Salado",
      "Postres",
      "Extras y Toppings",
      "Café",
    ]);
    expect(
      section("Extras y Toppings").getByRole("listitem", {
        name: "Fresas (Extra)",
      }),
    ).toBeDefined();
    goTo("#/");
    expect(saleChips()[3]).toBe("Extras y Toppings");
    app.store.close();
  });

  it("[C] Admin sube y baja una categoría", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    expect(
      screen
        .getByRole("button", { name: "Subir categoría Bebidas" })
        .hasAttribute("disabled"),
    ).toBe(true);
    await click(screen.getByRole("button", { name: "Subir categoría Café" }));
    expect(categoryHeadings()).toEqual([
      "Bebidas",
      "Salado",
      "Postres",
      "Café",
      "Extras",
    ]);
    expect(
      screen
        .getByRole("button", { name: "Bajar categoría Extras" })
        .hasAttribute("disabled"),
    ).toBe(true);
    goTo("#/");
    expect(saleChips()).toEqual([
      "Bebidas",
      "Salado",
      "Postres",
      "Café",
      "Extras",
    ]);
    app.store.close();
  });

  it("[C] Admin ordena los productos dentro de su categoría", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    const postres = () =>
      section("Postres")
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("aria-label"))
        .slice(0, 4);
    expect(
      section("Postres")
        .getByRole("button", { name: "Subir Affogato" })
        .hasAttribute("disabled"),
    ).toBe(true);
    await click(
      section("Postres").getByRole("button", { name: "Subir Brownie" }),
    );
    expect(postres()).toEqual([
      "Affogato",
      "Helado",
      "Brownie",
      "Croissant Dulce",
    ]);

    goTo("#/");
    const sale = within(screen.getByRole("region", { name: "Menú" }));
    await click(sale.getByRole("button", { name: "Postres" }));
    expect(
      sale
        .getAllByRole("listitem")
        .map((item) => item.querySelector("span")?.textContent)
        .slice(0, 4),
    ).toEqual(["Affogato", "Helado", "Brownie", "Croissant Dulce"]);
    app.store.close();
  });

  it("[C] Una categoría oculta oculta sus productos en Venta", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    await click(
      screen.getByRole("button", { name: "Ocultar categoría Extras" }),
    );
    expect(section("Extras").getByText("Oculta")).toBeDefined();
    expect(
      section("Extras").getByRole("listitem", { name: "Fresas (Extra)" }),
    ).toBeDefined();

    goTo("#/");
    expect(saleChips()).not.toContain("Extras");
    const sale = within(screen.getByRole("region", { name: "Menú" }));
    await userEvent.type(sale.getByLabelText("Buscar producto"), "fresas");
    expect(
      sale.queryByRole("button", { name: /^Fresas \(Extra\)/ }),
    ).toBeNull();

    goTo("#/menu");
    await click(
      screen.getByRole("button", { name: "Mostrar categoría Extras" }),
    );
    expect(section("Extras").queryByText("Oculta")).toBeNull();
    goTo("#/");
    expect(saleChips()).toContain("Extras");
    app.store.close();
  });

  it("[C] Solo Admin crea, renombra, ordena u oculta categorías", async () => {
    const app = await renderApp(<App />, { as: "barra" });
    goTo("#/menu");
    for (const name of [
      "Nueva categoría",
      "Renombrar categoría Extras",
      "Subir categoría Café",
      "Ocultar categoría Extras",
      "Subir Brownie",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    app.store.close();
  });
});

describe("EVL-119 [C] Review regressions", () => {
  it("an open modifier dialog does not add a product whose category was hidden", async () => {
    const app = await renderApp(<App />, { as: "barra" });
    await click(saleButton("Latte"));
    await act(async () => {
      await app.store.run((state) =>
        updateCategory(
          state,
          meta("hide-bebidas", admin),
          { categoryId: "bebidas", active: false },
          catalog,
        ),
      );
    });
    await click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^Agregar/,
      }),
    );
    expect(
      screen.getAllByText("Este producto ya no está a la venta.").length,
    ).toBeGreaterThan(0);
    expect(
      within(
        screen.getAllByRole("region", { name: "Orden actual" })[0],
      ).getAllByText("Sin productos").length,
    ).toBeGreaterThan(0);
    app.store.close();
  });

  it("Venta falls back to Todos when the selected category is hidden", async () => {
    const app = await renderApp(<App />, { as: "barra" });
    const sale = within(screen.getByRole("region", { name: "Menú" }));
    await click(sale.getByRole("button", { name: "Bebidas" }));
    await act(async () => {
      await app.store.run((state) =>
        updateCategory(
          state,
          meta("hide-bebidas", admin),
          { categoryId: "bebidas", active: false },
          catalog,
        ),
      );
    });
    expect(
      sale.getByRole("button", { name: "Todos" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(saleButton("Brownie")).toBeDefined();
    app.store.close();
  });

  it("an empty category in Venta says Sin productos", async () => {
    const storage = createMemoryStorage([
      createCategory(
        emptyState(),
        meta("panes", admin),
        { categoryId: "panes", name: "Panes" },
        catalog,
      ),
    ]);
    const app = await renderApp(<App />, { as: "barra", storage });
    const sale = within(screen.getByRole("region", { name: "Menú" }));
    await click(sale.getByRole("button", { name: "Panes" }));
    expect(sale.getByText("Sin productos")).toBeDefined();
    expect(sale.queryByText(/Ningún producto coincide/)).toBeNull();
    app.store.close();
  });

  it("keeps focus on the move button after a section or row moves", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    await click(screen.getByRole("button", { name: "Bajar categoría Salado" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Bajar categoría Salado" }),
      ),
    );
    await click(
      section("Postres").getByRole("button", { name: "Subir Helado" }),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        section("Postres").getByRole("button", { name: "Bajar Helado" }),
      ),
    );
    app.store.close();
  });

  it("marks hidden categories in the product dialog's category list", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    await click(
      screen.getByRole("button", { name: "Ocultar categoría Extras" }),
    );
    await click(screen.getByRole("button", { name: "Nuevo producto" }));
    expect(
      dialog().getByRole("option", { name: "Extras (oculta)" }),
    ).toBeDefined();
    app.store.close();
  });

  it("saving the rename dialog without changes records nothing", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    goTo("#/menu");
    const before = app.store.pendingBatches().length;
    await click(
      screen.getByRole("button", { name: "Renombrar categoría Extras" }),
    );
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(app.store.pendingBatches()).toHaveLength(before);
    app.store.close();
  });
});

function groupSection(name: string) {
  return within(screen.getByRole("region", { name }));
}

async function openModifiers() {
  goTo("#/menu");
  await click(screen.getByRole("tab", { name: "Modificadores" }));
}

async function latteDialog() {
  goTo("#/");
  await click(saleButton("Latte"));
  return within(screen.getByRole("dialog"));
}

describe("EVL-119 [D] Opciones de un grupo", () => {
  it("[D] Admin cambia el precio de una opción", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    await openModifiers();
    expect(
      groupSection("Tipo de leche").getByRole("listitem", { name: "Avena" })
        .textContent,
    ).toContain("$10.00");
    await click(
      groupSection("Tipo de leche").getByRole("button", {
        name: "Editar Avena",
      }),
    );
    expect(screen.getByRole("dialog", { name: "Editar opción" })).toBeDefined();
    expect((dialog().getByLabelText("Precio") as HTMLInputElement).value).toBe(
      "10.00",
    );
    await userEvent.clear(dialog().getByLabelText("Precio"));
    await userEvent.type(dialog().getByLabelText("Precio"), "-1");
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    expect(dialog().getByRole("alert").textContent).toBe(
      "Escribe un precio de $0.00 o más.",
    );
    await userEvent.clear(dialog().getByLabelText("Precio"));
    await userEvent.type(dialog().getByLabelText("Precio"), "0");
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    expect(
      groupSection("Tipo de leche").getByRole("listitem", { name: "Avena" })
        .textContent,
    ).toContain("$0.00");

    const sale = await latteDialog();
    await click(sale.getByRole("radio", { name: "Avena" }));
    expect(
      sale.getByRole("button", { name: "Agregar · $65.00" }),
    ).toBeDefined();
    app.store.close();
  });

  it("[D] El cambio de opciones no toca cuentas ya capturadas", async () => {
    const line = addLine([], latte, {
      lineId: "l1",
      modifiers: resolveModifiers(catalog, latte, { leche: ["avena"] }),
    });
    const saved = saveOrder(emptyState(), meta("save", luis), {
      orderId: "o-1",
      header: {
        type: "mostrador",
        table: null,
        customer: { name: "", phone: "", address: "" },
      },
      lines: line,
    });
    const priced = updateModifierOption(
      emptyState(),
      meta("avena-0", admin),
      { groupId: "leche", optionId: "avena", priceDeltaCents: 0 },
      catalog,
    );
    const app = await renderApp(<App />, {
      as: "barra",
      storage: createMemoryStorage([saved, priced]),
    });
    goTo("#/cuentas");
    await click(screen.getByRole("button", { name: "Abrir" }));
    await click(screen.getAllByRole("button", { name: "Editar Latte" })[0]);
    const edit = within(screen.getByRole("dialog"));
    expect(
      edit
        .getByRole("radio", { name: "Avena +$10.00" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await userEvent.type(
      edit.getByLabelText("Nota de preparación"),
      "sin espuma",
    );
    await click(edit.getByRole("button", { name: "Guardar cambios · $75.00" }));
    expect(screen.getAllByTestId("order-total")[0].textContent).toBe("$75.00");
    app.store.close();
  });

  it("[D] Admin renombra una opción", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    await openModifiers();
    await click(
      groupSection("Shot de sabor").getByRole("button", {
        name: "Editar Amareto",
      }),
    );
    await userEvent.clear(dialog().getByLabelText("Nombre"));
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    expect(dialog().getByRole("alert").textContent).toBe(
      "Escribe el nombre de la opción.",
    );
    await userEvent.type(dialog().getByLabelText("Nombre"), "AVELLANA");
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    expect(dialog().getByRole("alert").textContent).toBe(
      "Ya existe una opción con ese nombre en el grupo.",
    );
    await userEvent.clear(dialog().getByLabelText("Nombre"));
    await userEvent.type(dialog().getByLabelText("Nombre"), " Amaretto ");
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    expect(
      groupSection("Shot de sabor").getByRole("listitem", { name: "Amaretto" }),
    ).toBeDefined();

    const sale = await latteDialog();
    expect(
      sale.getByRole("checkbox", { name: "Amaretto +$10.00" }),
    ).toBeDefined();
    app.store.close();
  });

  it("[D] Admin agrega una opción", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    await openModifiers();
    await click(
      screen.getByRole("button", { name: "Agregar opción a Tipo de leche" }),
    );
    expect(screen.getByRole("dialog", { name: "Nueva opción" })).toBeDefined();
    await userEvent.type(dialog().getByLabelText("Nombre"), "Soya");
    await userEvent.type(dialog().getByLabelText("Precio"), "0");
    await click(dialog().getByRole("button", { name: "Guardar opción" }));
    expect(
      groupSection("Tipo de leche")
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual(["Entera", "Deslactosada", "Coco", "Almendras", "Avena", "Soya"]);

    const sale = await latteDialog();
    await click(sale.getByRole("radio", { name: "Soya" }));
    expect(
      sale.getByRole("button", { name: "Agregar · $65.00" }),
    ).toBeDefined();
    app.store.close();
  });

  it("[D] Admin oculta una opción", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    await openModifiers();
    await click(
      groupSection("Tipo de leche").getByRole("button", {
        name: "Ocultar Coco",
      }),
    );
    expect(
      within(
        groupSection("Tipo de leche").getByRole("listitem", { name: "Coco" }),
      ).getByText("Oculta"),
    ).toBeDefined();
    await click(
      groupSection("Tipo de leche").getByRole("button", {
        name: "Ocultar Entera",
      }),
    );
    await click(
      groupSection("Acompañamiento").getByRole("button", {
        name: "Ocultar Ensalada",
      }),
    );
    await click(
      groupSection("Acompañamiento").getByRole("button", {
        name: "Ocultar Papas",
      }),
    );
    expect(
      (
        await screen.findAllByText(
          "Un grupo obligatorio necesita al menos una opción visible.",
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      within(
        groupSection("Acompañamiento").getByRole("listitem", { name: "Papas" }),
      ).queryByText("Oculta"),
    ).toBeNull();

    const sale = await latteDialog();
    expect(sale.queryByRole("radio", { name: /^Coco/ })).toBeNull();
    expect(
      sale
        .getAllByRole("radio")
        .filter((radio) => radio.getAttribute("aria-checked") === "true"),
    ).toHaveLength(0);
    app.store.close();
  });

  it("[D] Solo Admin cambia las opciones", async () => {
    const app = await renderApp(<App />, { as: "barra" });
    goTo("#/menu");
    expect(screen.queryByRole("tab", { name: "Modificadores" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar Avena" })).toBeNull();
    app.store.close();
  });
});

describe("EVL-119 [D] Review regressions", () => {
  it("an option hidden while the dialog is open drops out of the selection and the price", async () => {
    const app = await renderApp(<App />, { as: "barra" });
    await click(saleButton("Latte"));
    const sale = within(screen.getByRole("dialog"));
    await click(sale.getByRole("checkbox", { name: "Amareto +$10.00" }));
    expect(
      sale.getByRole("button", { name: "Agregar · $75.00" }),
    ).toBeDefined();
    await act(async () => {
      await app.store.run((state) =>
        updateModifierOption(
          state,
          meta("hide-amareto", admin),
          { groupId: "shot", optionId: "amareto", active: false },
          catalog,
        ),
      );
    });
    await click(sale.getByRole("button", { name: "Agregar · $65.00" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByTestId("order-total")[0].textContent).toBe("$65.00");
    app.store.close();
  });

  it("a default hidden while the dialog is open is no longer selected", async () => {
    const app = await renderApp(<App />, { as: "barra" });
    await click(saleButton("Latte"));
    const sale = within(screen.getByRole("dialog"));
    await act(async () => {
      await app.store.run((state) =>
        updateModifierOption(
          state,
          meta("hide-entera", admin),
          { groupId: "leche", optionId: "entera", active: false },
          catalog,
        ),
      );
    });
    expect(
      sale
        .getAllByRole("radio")
        .filter((radio) => radio.getAttribute("aria-checked") === "true"),
    ).toHaveLength(0);
    app.store.close();
  });
});

const saborInput = {
  groupId: "sabor",
  name: "Sabor",
  min: 1,
  max: 1,
  options: [
    { optionId: "fresa", name: "Mermelada de fresa", priceDeltaCents: 0 },
    {
      optionId: "frutos-rojos",
      name: "Mermelada de frutos rojos",
      priceDeltaCents: 0,
    },
    {
      optionId: "zarzamora",
      name: "Mermelada de zarzamora c/ queso",
      priceDeltaCents: 0,
    },
  ],
};

const saborBatch = createModifierGroup(
  emptyState(),
  meta("crear-sabor", admin),
  saborInput,
  catalog,
);

const croissantWithSabor = setProductGroups(
  applyBatch(emptyState(), saborBatch),
  meta("asignar-sabor", admin, "10:01"),
  {
    productId: "52000822188",
    groupIds: ["sabor", "fruta-acompanamiento", "extras-dulces"],
  },
  catalog,
);

function groupHeadings(): string[] {
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent ?? "");
}

function assignedGroups(): string[] {
  return within(dialog().getByRole("group", { name: "Modificadores" }))
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("aria-label") ?? "");
}

function groupChoices(): string[] {
  const select = dialog().getByLabelText("Agregar grupo") as HTMLSelectElement;
  return Array.from(select.options)
    .filter((option) => option.value !== "")
    .map((option) => option.textContent ?? "");
}

async function addGroup(name: string) {
  await userEvent.selectOptions(dialog().getByLabelText("Agregar grupo"), name);
}

async function editProduct(name: string) {
  goTo("#/menu");
  await click(row(name).getByRole("button", { name: `Editar ${name}` }));
}

async function saleGroups(name: string): Promise<string[]> {
  goTo("#/");
  await click(saleButton(name));
  return Array.from(
    screen.getByRole("dialog").querySelectorAll("fieldset"),
  ).map((fieldset) => fieldset.getAttribute("aria-label") ?? "");
}

async function openNewGroup() {
  await openModifiers();
  await click(screen.getByRole("button", { name: "Nuevo grupo" }));
  expect(screen.getByRole("dialog", { name: "Nuevo grupo" })).toBeDefined();
}

async function typeOption(index: number, name: string) {
  const field = dialog().getByLabelText(`Nombre de la opción ${index}`);
  await userEvent.clear(field);
  await userEvent.type(field, name);
}

async function setLimits(min: string, max: string) {
  await userEvent.clear(dialog().getByLabelText("Mínimo"));
  await userEvent.type(dialog().getByLabelText("Mínimo"), min);
  await userEvent.clear(dialog().getByLabelText("Máximo"));
  await userEvent.type(dialog().getByLabelText("Máximo"), max);
}

const saveGroup = () =>
  click(dialog().getByRole("button", { name: "Guardar grupo" }));

const lastEvents = (app: { store: { pendingBatches(): CommandBatch[] } }) =>
  app.store
    .pendingBatches()
    .at(-1)
    ?.events.map((event) => event.type);

describe("EVL-119 [E] Grupos de modificadores", () => {
  it("[E] Admin crea un grupo de modificadores", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    await openNewGroup();
    expect(
      (dialog().getByLabelText("Precio de la opción 1") as HTMLInputElement)
        .value,
    ).toBe("0.00");

    await saveGroup();
    expect(dialog().getByRole("alert").textContent).toBe(
      "Escribe el nombre del grupo.",
    );
    await userEvent.type(dialog().getByLabelText("Nombre"), "tipo de leche");
    await saveGroup();
    expect(dialog().getByRole("alert").textContent).toBe(
      "Ya existe un grupo con ese nombre.",
    );
    await userEvent.clear(dialog().getByLabelText("Nombre"));
    await userEvent.type(dialog().getByLabelText("Nombre"), "Sabor");
    await typeOption(1, "Mermelada de fresa");
    await setLimits("2", "1");
    await saveGroup();
    expect(dialog().getByRole("alert").textContent).toBe(
      "Revisa el mínimo y el máximo del grupo.",
    );
    await click(dialog().getByRole("button", { name: "Quitar opción 1" }));
    await saveGroup();
    expect(dialog().getByRole("alert").textContent).toBe(
      "Un grupo obligatorio necesita al menos una opción visible.",
    );

    await setLimits("1", "1");
    for (const name of [
      "Mermelada de fresa",
      "Mermelada de frutos rojos",
      "Mermelada de zarzamora c/ queso",
    ]) {
      await click(dialog().getByRole("button", { name: "Agregar opción" }));
      const rows = dialog().getAllByLabelText(/^Nombre de la opción \d+$/);
      await userEvent.type(rows[rows.length - 1], name);
    }
    expect(
      (dialog().getByLabelText("Opción por defecto") as HTMLSelectElement)
        .value,
    ).toBe("");
    await saveGroup();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(groupHeadings().at(-1)).toBe("Sabor");
    expect(
      groupSection("Sabor")
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual([
      "Mermelada de fresa",
      "Mermelada de frutos rojos",
      "Mermelada de zarzamora c/ queso",
    ]);
    expect(
      groupSection("Sabor").getByText("Obligatorio · elige 1"),
    ).toBeDefined();
    expect(await screen.findByText("Grupo Sabor creado")).toBeDefined();
    const created = app.store.getState().menu.createdGroups;
    expect(created).toHaveLength(1);
    expect(created[0].defaultOptionId).toBeUndefined();
    app.store.close();
  });

  it("[E] Admin asigna grupos a un producto en orden", async () => {
    const app = await renderApp(<App />, {
      as: "admin",
      storage: createMemoryStorage([saborBatch]),
    });
    await editProduct("Croissant Dulce");
    expect(assignedGroups()).toEqual(["Fruta de acompañamiento", "Extras"]);
    await addGroup("Sabor");
    expect(assignedGroups()).toEqual([
      "Fruta de acompañamiento",
      "Extras",
      "Sabor",
    ]);
    await click(dialog().getByRole("button", { name: "Subir Sabor" }));
    await click(dialog().getByRole("button", { name: "Subir Sabor" }));
    expect(assignedGroups()).toEqual([
      "Sabor",
      "Fruta de acompañamiento",
      "Extras",
    ]);
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    expect(await saleGroups("Croissant Dulce")).toEqual([
      "Sabor",
      "Fruta de acompañamiento",
      "Extras",
    ]);
    const sale = within(screen.getByRole("dialog"));
    await click(sale.getByRole("button", { name: "Agregar · $60.00" }));
    expect(sale.getByRole("alert").textContent).toBe(
      "Falta «Sabor». Elige una opción para continuar.",
    );
    await click(
      within(sale.getByRole("radiogroup", { name: "Sabor" })).getByRole(
        "radio",
        { name: "Mermelada de fresa" },
      ),
    );
    await click(
      within(
        sale.getByRole("radiogroup", { name: "Fruta de acompañamiento" }),
      ).getByRole("radio", { name: "Durazno" }),
    );
    await click(sale.getByRole("button", { name: "Agregar · $60.00" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByTestId("order-total")[0].textContent).toBe("$60.00");

    await editProduct("Crepa de Pollo");
    expect(assignedGroups()).toEqual(["Acompañamiento", "Aderezo extra"]);
    await addGroup("Aderezo incluido");
    await click(
      dialog().getByRole("button", { name: "Subir Aderezo incluido" }),
    );
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    expect(await saleGroups("Crepa de Pollo")).toEqual([
      "Acompañamiento",
      "Aderezo incluido",
      "Aderezo extra",
    ]);
    app.store.close();
  });

  it("[E] Admin quita un grupo de un producto", async () => {
    const line = addLine([], latte, {
      lineId: "l1",
      modifiers: resolveModifiers(catalog, latte, {
        leche: ["entera"],
        shot: ["amareto"],
      }),
    });
    const saved = saveOrder(emptyState(), meta("save", luis), {
      orderId: "o-1",
      header: {
        type: "mostrador",
        table: null,
        customer: { name: "", phone: "", address: "" },
      },
      lines: line,
    });
    const app = await renderApp(<App />, {
      as: "admin",
      storage: createMemoryStorage([saved]),
    });
    await editProduct("Latte");
    expect(assignedGroups()).toEqual(["Tipo de leche", "Shot de sabor"]);
    expect(groupChoices()).not.toContain("Tipo de leche");
    await click(dialog().getByRole("button", { name: "Quitar Shot de sabor" }));
    expect(assignedGroups()).toEqual(["Tipo de leche"]);
    expect(groupChoices()).toContain("Shot de sabor");
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));

    expect(await saleGroups("Latte")).toEqual(["Tipo de leche"]);
    const sale = within(screen.getByRole("dialog"));
    expect(sale.queryByRole("checkbox", { name: /^Amareto/ })).toBeNull();
    await click(sale.getByRole("button", { name: "Cancelar" }));

    goTo("#/cuentas");
    await click(screen.getByRole("button", { name: "Abrir" }));
    await click(screen.getAllByRole("button", { name: "Editar Latte" })[0]);
    const edit = within(screen.getByRole("dialog"));
    await userEvent.type(
      edit.getByLabelText("Nota de preparación"),
      "sin espuma",
    );
    await click(edit.getByRole("button", { name: "Guardar cambios · $75.00" }));
    expect(screen.getAllByTestId("order-total")[0].textContent).toBe("$75.00");
    app.store.close();
  });

  it("[E] Las opciones de un grupo nuevo se editan como las demás", async () => {
    const app = await renderApp(<App />, {
      as: "admin",
      storage: createMemoryStorage([saborBatch, croissantWithSabor]),
    });
    await openModifiers();
    await click(screen.getByRole("button", { name: "Agregar opción a Sabor" }));
    await userEvent.type(dialog().getByLabelText("Nombre"), "Nutella");
    await userEvent.type(dialog().getByLabelText("Precio"), "10");
    await click(dialog().getByRole("button", { name: "Guardar opción" }));
    await click(
      groupSection("Sabor").getByRole("button", {
        name: "Editar Mermelada de fresa",
      }),
    );
    await userEvent.clear(dialog().getByLabelText("Nombre"));
    await userEvent.type(dialog().getByLabelText("Nombre"), "Fresa");
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    await click(
      groupSection("Sabor").getByRole("button", {
        name: "Ocultar Mermelada de frutos rojos",
      }),
    );

    goTo("#/");
    await click(saleButton("Croissant Dulce"));
    const flavours = within(
      within(screen.getByRole("dialog")).getByRole("radiogroup", {
        name: "Sabor",
      }),
    );
    expect(
      flavours
        .getAllByRole("radio")
        .map((radio) => radio.textContent?.replace("+", " +")),
    ).toEqual(["Fresa", "Mermelada de zarzamora c/ queso", "Nutella +$10.00"]);
    app.store.close();
  });

  it("[E] Solo Admin crea grupos y los asigna", async () => {
    const app = await renderApp(<App />, { as: "barra" });
    goTo("#/menu");
    expect(screen.queryByRole("tab", { name: "Modificadores" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nuevo grupo" })).toBeNull();
    expect(
      row("Latte").queryByRole("button", { name: "Editar Latte" }),
    ).toBeNull();
    app.store.close();
  });
});

describe("EVL-119 [E] Review regressions", () => {
  it("focus returns to Nuevo grupo after the group is saved", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    await openNewGroup();
    await userEvent.type(dialog().getByLabelText("Nombre"), "Tamaño");
    await typeOption(1, "Chico");
    await saveGroup();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Nuevo grupo" }),
      ),
    );
    app.store.close();
  });

  it("saves the chosen default option and clears it when its option is removed", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    await openNewGroup();
    await userEvent.type(dialog().getByLabelText("Nombre"), "Tamaño");
    await setLimits("1", "1");
    await typeOption(1, "Chico");
    await click(dialog().getByRole("button", { name: "Agregar opción" }));
    await typeOption(2, "Grande");
    const fallback = () =>
      dialog().getByLabelText("Opción por defecto") as HTMLSelectElement;
    await userEvent.selectOptions(fallback(), "Chico");
    await click(dialog().getByRole("button", { name: "Quitar opción 1" }));
    expect(fallback().value).toBe("");
    await userEvent.selectOptions(fallback(), "Grande");
    await saveGroup();
    const [group] = app.store.getState().menu.createdGroups;
    expect(
      group.options.find((option) => option.id === group.defaultOptionId)?.name,
    ).toBe("Grande");
    app.store.close();
  });

  it("the product dialog sends only what changed, in one batch", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    await editProduct("Latte");
    await userEvent.clear(dialog().getByLabelText("Nombre"));
    await userEvent.type(dialog().getByLabelText("Nombre"), "Latte Grande");
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    expect(lastEvents(app)).toEqual(["product-updated"]);

    await editProduct("Latte Grande");
    await click(dialog().getByRole("button", { name: "Quitar Shot de sabor" }));
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    expect(lastEvents(app)).toEqual(["product-groups-set"]);

    const before = app.store.pendingBatches().length;
    await editProduct("Latte Grande");
    await userEvent.clear(dialog().getByLabelText("Nombre"));
    await userEvent.type(dialog().getByLabelText("Nombre"), "Latte");
    await addGroup("Shot de sabor");
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    expect(app.store.pendingBatches()).toHaveLength(before + 1);
    expect(lastEvents(app)).toEqual(["product-updated", "product-groups-set"]);
    app.store.close();
  });

  it("moving a group and moving it back records nothing", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    const before = app.store.pendingBatches().length;
    await editProduct("Latte");
    await click(dialog().getByRole("button", { name: "Bajar Tipo de leche" }));
    await click(dialog().getByRole("button", { name: "Subir Tipo de leche" }));
    await click(dialog().getByRole("button", { name: "Guardar cambios" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(app.store.pendingBatches()).toHaveLength(before);
    app.store.close();
  });

  it("keeps focus on the group's move buttons after it moves", async () => {
    const app = await renderApp(<App />, {
      as: "admin",
      storage: createMemoryStorage([saborBatch]),
    });
    await editProduct("Croissant Dulce");
    await addGroup("Sabor");
    await click(dialog().getByRole("button", { name: "Subir Sabor" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        dialog().getByRole("button", { name: "Subir Sabor" }),
      ),
    );
    await click(dialog().getByRole("button", { name: "Subir Sabor" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        dialog().getByRole("button", { name: "Bajar Sabor" }),
      ),
    );
    app.store.close();
  });

  it("a group created while the product dialog is open can be added", async () => {
    const app = await renderApp(<App />, { as: "admin" });
    await editProduct("Croissant Dulce");
    expect(groupChoices()).not.toContain("Sabor");
    await act(async () => {
      await app.store.run((state) =>
        createModifierGroup(
          state,
          meta("otra-caja", admin),
          saborInput,
          catalog,
        ),
      );
    });
    expect(groupChoices()).toContain("Sabor");
    await addGroup("Sabor");
    expect(assignedGroups().at(-1)).toBe("Sabor");
    app.store.close();
  });
});
