// The sale flow across screens. Spec: Linear EVL-122, EVL-123, EVL-124,
// EVL-130 and EVL-118 [B]. Test names are scenario titles where one exists.
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { renderApp } from "./testing.tsx";

function goTo(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

beforeEach(() => window.localStorage.clear());
afterEach(() => goTo(""));

const click = (element: HTMLElement) => userEvent.click(element);
const button = (name: string | RegExp) => screen.getByRole("button", { name });

function panel() {
  return within(screen.getByRole("complementary"));
}

function total(): string {
  return screen.getAllByTestId("order-total")[0].textContent ?? "";
}

async function addCokes(count: number) {
  for (let index = 0; index < count; index += 1) {
    await click(button(/^Coca Cola/));
  }
}

async function chooseTable(table: number) {
  await click(panel().getByRole("radio", { name: "Mesa" }));
  await click(panel().getByRole("radio", { name: `Mesa ${table}` }));
}

describe("EVL-122 Cuentas abiertas en pantalla", () => {
  it("[C] Guardar sin cobrar y reabrir después de recargar", async () => {
    // Dado una cuenta en la mesa 3 con una Coca Cola de $25, cuando la guardo
    // sin cobrar, recargo la app y la reabro, entonces tiene las mismas
    // partidas, la mesa 3 y el mismo total
    const first = await renderApp(<App />, { as: "mesero" });
    await addCokes(1);
    await chooseTable(3);
    await click(button("Guardar cuenta"));
    expect((await screen.findByRole("status")).textContent).toContain(
      "Cuenta A-0001 guardada",
    );
    expect(panel().getByText("Sin productos")).toBeDefined();
    first.unmount();

    await renderApp(<App />, { as: "barra", storage: first.storage });
    goTo("#/cuentas");
    const card = within(
      screen.getByRole("listitem", { name: "Cuenta A-0001" }),
    );
    expect(card.getByText("Mesa 3")).toBeDefined();
    expect(card.getByText("$25.00")).toBeDefined();
    expect(card.getByText(/1 producto · Mesero · \d\d:\d\d/)).toBeDefined();
    expect(card.getByText("Por enviar a cocina")).toBeDefined();

    await click(card.getByRole("button", { name: "Abrir" }));
    expect(
      await screen.findByRole("heading", { name: "Cuenta A-0001" }),
    ).toBeDefined();
    expect(panel().getByLabelText("Cantidad de Coca Cola").textContent).toBe(
      "1",
    );
    expect(
      panel()
        .getByRole("radio", { name: "Mesa 3" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(total()).toBe("$25.00");
  });

  it("[B] Recolección exige nombre y teléfono", async () => {
    // Dado una orden de tipo Recoger con nombre "Ana" y sin teléfono, cuando
    // intento guardarla, entonces no se guarda y se indica que falta el teléfono
    const { store } = await renderApp(<App />, { as: "mesero" });
    await addCokes(1);
    await click(panel().getByRole("radio", { name: "Recoger" }));
    await userEvent.type(panel().getByLabelText("Nombre del cliente"), "Ana");
    await click(button("Guardar cuenta"));
    expect(panel().getByRole("alert").textContent).toBe(
      "Falta teléfono del cliente.",
    );
    expect(Object.keys(store.getState().orders)).toEqual([]);

    await userEvent.type(panel().getByLabelText("Teléfono"), "4421234567");
    await click(button("Guardar cuenta"));
    await screen.findByText("Cuenta A-0001 guardada");
    expect(Object.values(store.getState().orders)[0].header.customer.name).toBe(
      "Ana",
    );
  });

  it("[A] Admin configura la cantidad de mesas", async () => {
    const { store } = await renderApp(<App />, { as: "admin" });
    goTo("#/cuentas");
    await click(button("Agregar una mesa"));
    await click(button("Agregar una mesa"));
    expect(store.getState().tableCount).toBe(10);
    goTo("#/");
    await click(panel().getByRole("radio", { name: "Mesa" }));
    expect(panel().getByRole("radio", { name: "Mesa 10" })).toBeDefined();
  });

  it("[A] Barra y Mesero no configuran mesas", async () => {
    await renderApp(<App />, { as: "barra" });
    goTo("#/cuentas");
    expect(
      screen.queryByRole("button", { name: "Agregar una mesa" }),
    ).toBeNull();
  });
});

describe("EVL-124 [B] Pantalla de cocina", () => {
  it("[B] Cada comanda tiene una sola acción siguiente", async () => {
    // Dado una comanda "En cola", cuando toco "Empezar", "Marcar lista" y
    // "Entregar", entonces cambia a "Preparando", "Lista" y sale de pendientes
    await renderApp(<App />, { as: "mesero" });
    await click(button(/^Latte\s*\$/));
    const dialog = within(screen.getByRole("dialog"));
    await click(dialog.getByRole("radio", { name: "Avena +$10.00" }));
    await userEvent.type(
      dialog.getByLabelText("Nota de preparación"),
      "extra caliente",
    );
    await click(dialog.getByRole("button", { name: /^Agregar/ }));
    await chooseTable(3);
    await click(button("Enviar comanda"));
    await screen.findByText("Comanda de A-0001 enviada a cocina");

    goTo("#/cocina");
    const card = within(
      screen.getByRole("listitem", { name: "Comanda A-0001" }),
    );
    expect(card.getByText("Mesa 3")).toBeDefined();
    expect(card.getByText("Latte")).toBeDefined();
    expect(card.getByText("Avena")).toBeDefined();
    expect(card.getByText("Nota: extra caliente")).toBeDefined();
    expect(card.getByText("En cola")).toBeDefined();
    // The kitchen never sees prices.
    expect(screen.getByRole("main").textContent).not.toContain("$");

    await click(card.getByRole("button", { name: "Empezar" }));
    expect(card.getByText("Preparando")).toBeDefined();
    await click(card.getByRole("button", { name: "Marcar lista" }));
    expect(card.getByText("Lista")).toBeDefined();
    await click(card.getByRole("button", { name: "Entregar" }));
    expect(await screen.findByText("Sin comandas pendientes")).toBeDefined();
  });

  it("[B] Una comanda nueva aparece sin recargar", async () => {
    // Dado la pantalla de cocina abierta en otra pestaña, cuando la caja
    // envía una comanda, entonces aparece en cocina sin recargar
    const caja = await renderApp(<App />, { as: "mesero" });
    await addCokes(1);
    caja.unmount();
    // Second tab on the same storage, opened before the comanda exists.
    goTo("#/cocina");
    const cocina = await renderApp(<App />, {
      as: "mesero",
      storage: caja.storage,
    });
    expect(screen.getByText("Sin comandas pendientes")).toBeDefined();

    const { saveOrder } = await import("../domain/commands.ts");
    const { sendComanda } = await import("../domain/comanda.ts");
    const { PosStore } = await import("../data/pos-store.ts");
    const { linesOf, brownie, meta, sofi, mostrador } =
      await import("../domain/testing.ts");
    const other = await PosStore.open(caja.storage);
    await act(async () => {
      await other.commit(
        saveOrder(other.getState(), meta("op-1", sofi), {
          orderId: "o-1",
          header: mostrador,
          lines: linesOf([brownie]),
        }),
      );
      await other.commit(
        sendComanda(other.getState(), meta("op-2", sofi), {
          orderId: "o-1",
          comandaId: "c-1",
        }),
      );
    });
    expect(
      await screen.findByRole("listitem", { name: "Comanda A-0001" }),
    ).toBeDefined();
    expect(cocina.store.getState().comandas["c-1"].status).toBe("queued");
  });

  it("[A] Lo enviado a cocina no se quita desde la estación", async () => {
    await renderApp(<App />, { as: "mesero" });
    await addCokes(2);
    await click(button("Enviar comanda"));
    await screen.findByText("Comanda de A-0001 enviada a cocina");
    goTo("#/cuentas");
    await click(button("Abrir"));
    await screen.findByRole("heading", { name: "Cuenta A-0001" });
    expect(panel().getByText("En cocina: 2")).toBeDefined();
    expect(
      panel().getByRole("button", { name: "Quitar uno de Coca Cola" }),
    ).toHaveProperty("disabled", true);
    expect(
      panel().getByRole("button", { name: "Eliminar Coca Cola" }),
    ).toHaveProperty("disabled", true);
    // Nothing new yet: sending again is refused with an explanation.
    await click(button("Enviar comanda"));
    expect(panel().getByRole("alert").textContent).toBe(
      "No hay productos nuevos que enviar a cocina.",
    );
  });
});

describe("EVL-123 Cobro en pantalla", () => {
  it("[D] El cierre conserva pagos, propina y cambio", async () => {
    // Dado una orden de $50.00 con propina del 10 % pagada con $100.00 en
    // efectivo, cuando confirmo el cobro, entonces el ticket y Ventas de hoy
    // conservan efectivo recibido $100.00, cambio $45.00 y propina $5.00
    await renderApp(<App />, { as: "barra" });
    await addCokes(2);
    await click(button("Cobrar · $50.00"));
    const checkout = within(await screen.findByRole("dialog"));
    expect(checkout.getByTestId("checkout-due").textContent).toBe("$50.00");
    // [A] Las sugerencias son 5, 10, 15 y 20 %
    for (const label of [
      "5 % $2.50",
      "10 % $5.00",
      "15 % $7.50",
      "20 % $10.00",
      "Otro",
    ]) {
      expect(checkout.getByRole("radio", { name: label })).toBeDefined();
    }
    await click(checkout.getByRole("radio", { name: "10 % $5.00" }));
    // [A] La propina no se suma dos veces
    expect(checkout.getByTestId("checkout-subtotal").textContent).toBe(
      "$50.00",
    );
    expect(checkout.getByTestId("checkout-tip").textContent).toBe("$5.00");
    expect(checkout.getByTestId("checkout-due").textContent).toBe("$55.00");

    // [B] No se cierra con saldo pendiente
    const confirm = checkout.getByRole("button", { name: "Registrar pago" });
    expect(confirm).toHaveProperty("disabled", true);
    await userEvent.type(checkout.getByLabelText("Efectivo recibido"), "50");
    expect(checkout.getByRole("alert").textContent).toBe(
      "Faltan $5.00 para cubrir el total.",
    );
    expect(confirm).toHaveProperty("disabled", true);

    // [B] El efectivo de más genera cambio
    await userEvent.clear(checkout.getByLabelText("Efectivo recibido"));
    await userEvent.type(checkout.getByLabelText("Efectivo recibido"), "100");
    expect(checkout.getByTestId("checkout-change").textContent).toBe("$45.00");
    await click(confirm);

    const ticket = within(
      await screen.findByRole("article", { name: "Ticket A-0001" }),
    );
    for (const text of [
      "Abboth",
      "Folio A-0001",
      "2 × Coca Cola",
      "$43.10",
      "$6.90",
      "$55.00",
      "$100.00",
      "$45.00",
    ]) {
      expect(ticket.getByText(text)).toBeDefined();
    }
    await click(button("Listo"));
    expect(panel().getByText("Sin productos")).toBeDefined();

    goTo("#/ventas");
    const sale = within(screen.getByRole("listitem", { name: "Venta A-0001" }));
    expect(sale.getByText(/Barra · Efectivo · propina \$5\.00/)).toBeDefined();
    expect(sale.getByText("$50.00")).toBeDefined();
    const tiles = screen.getByRole("heading", { name: "Ventas de hoy" })
      .nextElementSibling as HTMLElement;
    expect(tiles.textContent).toContain("Ventas1");
    expect(tiles.textContent).toContain("Vendido$50.00");
    expect(tiles.textContent).toContain("Propinas$5.00");
    expect(tiles.textContent).toContain("Efectivo$55.00");
    await click(sale.getByRole("button", { name: "Ver ticket de A-0001" }));
    expect(
      await screen.findByRole("article", { name: "Ticket A-0001" }),
    ).toBeDefined();
  });

  it("[A] Propina libre muestra su porcentaje sin rechazarla", async () => {
    // Dado una orden de $50.00, cuando capturo "Otro" con $10.30, entonces la
    // propina es $10.30, se muestra "20.6 %" y no se redondea
    await renderApp(<App />, { as: "barra" });
    await addCokes(2);
    await click(button("Cobrar · $50.00"));
    const checkout = within(await screen.findByRole("dialog"));
    await click(checkout.getByRole("radio", { name: "Otro" }));
    await userEvent.type(checkout.getByLabelText("Propina en pesos"), "10.30");
    expect(checkout.getByTestId("tip-percent").textContent).toBe("20.6 %");
    expect(checkout.getByTestId("checkout-tip").textContent).toBe("$10.30");
    expect(checkout.getByTestId("checkout-due").textContent).toBe("$60.30");
  });

  it("[C] Tarjeta manual sin conexión", async () => {
    // Dado una orden de $25.00, cuando registro un pago con tarjeta cobrado
    // en la terminal por separado, entonces se registra como "tarjeta manual"
    const { store } = await renderApp(<App />, { as: "barra" });
    await addCokes(1);
    await click(button("Cobrar · $25.00"));
    const checkout = within(await screen.findByRole("dialog"));
    await click(checkout.getByRole("radio", { name: "Tarjeta manual" }));
    expect(checkout.queryByLabelText("Efectivo recibido")).toBeNull();
    await click(checkout.getByRole("button", { name: "Registrar pago" }));
    const ticket = within(await screen.findByRole("article"));
    expect(ticket.getByText("Tarjeta manual")).toBeDefined();
    expect(ticket.queryByText("Cambio")).toBeNull();
    const [order] = Object.values(store.getState().orders);
    expect(order.sale?.settlement).toMatchObject({
      method: "card",
      netCents: 2500,
      changeCents: 0,
    });
  });

  it("[D] Mesero no cobra", async () => {
    // EVL-118 [B] La navegación sólo muestra lo permitido
    await renderApp(<App />, { as: "mesero" });
    await addCokes(1);
    expect(screen.queryByRole("button", { name: /^Cobrar/ })).toBeNull();
    expect(button("Guardar cuenta")).toBeDefined();
    expect(button("Enviar comanda")).toBeDefined();
  });

  it("keeps the account open when the checkout is cancelled", async () => {
    const { store } = await renderApp(<App />, { as: "barra" });
    await addCokes(1);
    await click(button("Cobrar · $25.00"));
    const checkout = within(await screen.findByRole("dialog"));
    await click(checkout.getByRole("button", { name: "Seguir capturando" }));
    expect(
      await screen.findByRole("heading", { name: "Cuenta A-0001" }),
    ).toBeDefined();
    expect(Object.values(store.getState().orders)[0].status).toBe("open");
  });
});

describe("EVL-130 [B] Ventas de hoy en pantalla", () => {
  it("[B] Sin ventas se explica el estado vacío", async () => {
    await renderApp(<App />, { as: "barra" });
    goTo("#/ventas");
    expect(screen.getByText("Aún no hay ventas cerradas hoy")).toBeDefined();
    expect(
      (
        screen.getByRole("heading", { name: "Ventas de hoy" })
          .nextElementSibling as HTMLElement
      ).textContent,
    ).toContain("Vendido$0.00");
  });
});
