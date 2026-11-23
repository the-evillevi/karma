import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { renderApp } from "../testing.tsx";
import { Station } from "./Station.tsx";

beforeEach(() => window.localStorage.clear());

function menu() {
  return within(screen.getByRole("region", { name: "Menú" }));
}

function order() {
  return within(screen.getByRole("region", { name: "Orden actual" }));
}

function productNames(): string[] {
  return menu()
    .getAllByRole("listitem")
    .map((item) => item.querySelector("span")?.textContent ?? "");
}

function total(): string {
  return screen.getAllByTestId("order-total")[0].textContent ?? "";
}

async function addProduct(name: RegExp) {
  await userEvent.click(menu().getByRole("button", { name }));
}

describe("EVL-121 [B] Estación de venta", () => {
  it("[B] El menú muestra categorías y búsqueda", async () => {
    await renderApp(<Station />, { as: "barra" });
    expect(productNames()).toHaveLength(112);

    await userEvent.click(menu().getByRole("button", { name: "Postres" }));
    expect(productNames()).toHaveLength(20);
    expect(productNames()).toContain("Brownie");
    expect(productNames()).not.toContain("Americano");
    expect(
      menu().getByRole("button", { name: /^Brownie/ }).textContent,
    ).toContain("$38.00");

    await userEvent.type(menu().getByLabelText("Buscar producto"), "crepa");
    const found = productNames();
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((name) => name.toLowerCase().includes("crepa"))).toBe(
      true,
    );
    expect(found).toContain("Crepa de Pollo");
    expect(found).toContain("Crepa de Nutella");
    await userEvent.clear(menu().getByLabelText("Buscar producto"));
    await userEvent.type(menu().getByLabelText("Buscar producto"), "cafe");
    expect(productNames()).toContain("Frappe de Café");
  });

  it("[B] Tocar un producto sin modificadores lo agrega de inmediato", async () => {
    await renderApp(<Station />, { as: "barra" });
    expect(order().getByText("Sin productos")).toBeDefined();
    await addProduct(/^Coca Cola/);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(order().getByText("Coca Cola")).toBeDefined();
    expect(order().getByLabelText("Cantidad de Coca Cola").textContent).toBe(
      "1",
    );
    expect(total()).toBe("$25.00");
  });

  it("[B] La orden actual permite cambiar cantidades y eliminar", async () => {
    await renderApp(<Station />, { as: "barra" });
    await addProduct(/^Coca Cola/);
    await userEvent.click(
      order().getByRole("button", { name: "Agregar uno de Coca Cola" }),
    );
    expect(order().getByLabelText("Cantidad de Coca Cola").textContent).toBe(
      "2",
    );
    expect(total()).toBe("$50.00");
    await userEvent.click(
      order().getByRole("button", { name: "Quitar uno de Coca Cola" }),
    );
    expect(total()).toBe("$25.00");
    await userEvent.click(
      order().getByRole("button", { name: "Eliminar Coca Cola" }),
    );
    expect(order().getByText("Sin productos")).toBeDefined();
    expect(total()).toBe("$0.00");
  });

  it("[B] El borrador sobrevive a recargar", async () => {
    const first = await renderApp(<Station />, { as: "barra" });
    await addProduct(/^Coca Cola/);
    await addProduct(/^Coca Cola/);
    expect(total()).toBe("$50.00");
    first.unmount();

    await renderApp(<Station />, { as: "barra" });
    expect(order().getByLabelText("Cantidad de Coca Cola").textContent).toBe(
      "2",
    );
    expect(total()).toBe("$50.00");
  });

  it("[B] La orden es accesible en tablet y teléfono", async () => {
    await renderApp(<Station />, { as: "barra" });
    await addProduct(/^Coca Cola/);
    await addProduct(/^Brownie/);
    const access = screen.getByRole("button", { name: /^Ver orden/ });
    expect(access.textContent).toContain("2 productos");
    expect(access.textContent).toContain("$63.00");
    await userEvent.click(access);
    const sheet = within(screen.getByRole("dialog"));
    expect(sheet.getByText("Brownie")).toBeDefined();
    expect(sheet.getByTestId("order-total").textContent).toBe("$63.00");
  });

  it("shows the IVA contained in the total", async () => {
    await renderApp(<Station />, { as: "barra" });
    await addProduct(/^Coca Cola/);
    await addProduct(/^Brownie/);
    expect(order().getByText("Base $54.31")).toBeDefined();
    expect(order().getByText("IVA 16 % $8.69")).toBeDefined();
  });
});

describe("EVL-120 [B] Hoja de modificadores", () => {
  it("[B] La hoja muestra cada cargo antes de agregar", async () => {
    await renderApp(<Station />, { as: "barra" });
    await addProduct(/^Latte(?! Honey)/);
    const dialog = within(screen.getByRole("dialog", { name: "Latte" }));
    const milk = within(
      dialog.getByRole("radiogroup", { name: "Tipo de leche" }),
    );
    expect(milk.getByText(/Obligatorio/)).toBeDefined();
    expect(
      milk.getByRole("radio", { name: "Entera" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(milk.getByRole("radio", { name: /^Avena/ })).toBeDefined();
    const shots = within(dialog.getByRole("group", { name: "Shot de sabor" }));
    expect(shots.getByText(/Opcional/)).toBeDefined();
    expect(dialog.getByTestId("modifier-price").textContent).toBe("$65.00");

    await userEvent.click(
      shots.getByRole("checkbox", { name: "Amareto +$10.00" }),
    );
    await userEvent.click(
      shots.getByRole("checkbox", { name: "Vainilla +$10.00" }),
    );
    expect(dialog.getByTestId("modifier-price").textContent).toBe("$85.00");
    await userEvent.type(
      dialog.getByLabelText("Nota de preparación"),
      "extra caliente",
    );
    await userEvent.click(
      dialog.getByRole("button", { name: "Agregar · $85.00" }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(order().getByText("Entera · Amareto · Vainilla")).toBeDefined();
    expect(order().getByText("Nota: extra caliente")).toBeDefined();
    expect(total()).toBe("$85.00");
  });

  it("[B] El botón de agregar explica qué falta", async () => {
    await renderApp(<Station />, { as: "barra" });
    await addProduct(/^Crepa de Pollo/);
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.click(
      dialog.getByRole("button", { name: "Agregar · $60.00" }),
    );
    expect(dialog.getByRole("alert").textContent).toContain("Acompañamiento");
    expect(
      dialog
        .getByRole("radiogroup", { name: "Acompañamiento" })
        .getAttribute("aria-invalid"),
    ).toBe("true");
    expect(total()).toBe("$0.00");

    await userEvent.click(dialog.getByRole("radio", { name: "Papas" }));
    expect(dialog.queryByRole("alert")).toBeNull();
    await userEvent.click(
      dialog.getByRole("button", { name: "Agregar · $60.00" }),
    );
    expect(order().getByText("Papas")).toBeDefined();
    expect(total()).toBe("$60.00");
  });

  it("re-edits a captured line without changing its quantity", async () => {
    await renderApp(<Station />, { as: "barra" });
    await addProduct(/^Latte(?! Honey)/);
    await userEvent.click(
      screen.getByRole("button", { name: "Agregar · $65.00" }),
    );
    await userEvent.click(
      order().getByRole("button", { name: "Agregar uno de Latte" }),
    );
    expect(total()).toBe("$130.00");

    await userEvent.click(
      order().getByRole("button", { name: "Editar Latte" }),
    );
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.click(
      dialog.getByRole("checkbox", { name: "Amareto +$10.00" }),
    );
    await userEvent.click(
      dialog.getByRole("button", { name: "Guardar cambios · $75.00" }),
    );
    expect(order().getByLabelText("Cantidad de Latte").textContent).toBe("2");
    expect(order().getByText("Entera · Amareto")).toBeDefined();
    expect(total()).toBe("$150.00");
  });
});
