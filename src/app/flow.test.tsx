import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { renderApp } from "./testing.tsx";
import { PosStore, createMemoryStorage } from "../data/pos-store.ts";
import type { JournalStorage } from "../data/pos-store.ts";
import { saveOrder } from "../domain/commands.ts";
import { emptyState } from "../domain/journal.ts";
import type { CommandBatch } from "../domain/journal.ts";
import { americano, linesOf, luis, mesa, meta } from "../domain/testing.ts";
import { loadDraft } from "./draft.ts";

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

describe("Review regressions", () => {
  it("no se pierde un producto capturado mientras se guarda la cuenta", async () => {
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
    await addCokes(1);
    const menu = screen.getByRole("region", { name: "Menú" });
    const order = panel().getByRole("region", { name: "Orden actual" });
    const brownie = button(/^Brownie/);
    try {
      await click(button("Guardar cuenta"));
      await waitFor(() => expect(writes).toBe(1));
      expect(menu.getAttribute("aria-busy")).toBe("true");
      expect(menu.hasAttribute("inert")).toBe(true);
      expect(order.getAttribute("aria-busy")).toBe("true");
      expect(order.hasAttribute("inert")).toBe(true);
      await click(brownie);
      expect(total()).toBe("$25.00");
      expect(screen.queryByText("Cuenta A-0001 guardada")).toBeNull();
    } finally {
      await act(async () => {
        release();
      });
    }
    await screen.findByText("Cuenta A-0001 guardada");
    expect(
      Object.values(app.store.getState().orders)[0].lines.map(
        (line) => line.name,
      ),
    ).toEqual(["Coca Cola"]);
    expect(loadDraft().lines).toEqual([]);
    app.store.close();
  });

  it("un borrador viejo no sobrescribe una cuenta más nueva", async () => {
    const seed = saveOrder(emptyState(), meta("seed", luis), {
      orderId: "o",
      header: mesa(3),
      lines: linesOf([americano]),
    });
    const storage = createMemoryStorage([seed]);
    const app = await renderApp(<App />, { as: "barra", storage });
    const other = await PosStore.open(storage);
    try {
      goTo("#/cuentas");
      await click(button("Abrir"));
      await screen.findByRole("heading", { name: "Cuenta A-0001" });
      await act(async () => {
        await other.run((state) =>
          saveOrder(state, meta("other", luis), {
            orderId: "o",
            header: mesa(3),
            lines: linesOf([americano, 2]),
          }),
        );
      });
      await click(button("Guardar cuenta"));
      await waitFor(() =>
        expect(panel().getByRole("alert").textContent).toBe(
          "Esta cuenta cambió en otra pantalla. Ábrela de nuevo desde Cuentas abiertas para ver la versión actual.",
        ),
      );
      expect(app.store.getState().orders.o.lines[0].quantity).toBe(2);
      expect(app.store.getState().orders.o.version).toBe(2);
      expect(loadDraft().lines[0].quantity).toBe(1);
      expect(loadDraft().baseVersion).toBe(1);
    } finally {
      app.store.close();
      other.close();
    }
  });

  it("el cobro sigue la cuenta actual y pide revisar si cambió", async () => {
    const app = await renderApp(<App />, { as: "barra" });
    const other = await PosStore.open(app.storage);
    try {
      await addCokes(1);
      await click(button("Cobrar · $25.00"));
      const checkout = within(await screen.findByRole("dialog"));
      await userEvent.type(checkout.getByLabelText("Efectivo recibido"), "100");
      const opened = Object.values(other.getState().orders)[0];
      await act(async () => {
        await other.run((state) =>
          saveOrder(state, meta("other", luis), {
            orderId: opened.orderId,
            header: opened.header,
            lines: [{ ...opened.lines[0], quantity: 2 }],
          }),
        );
      });
      await waitFor(() =>
        expect(checkout.getByTestId("checkout-due").textContent).toBe("$50.00"),
      );
      expect(checkout.getByRole("alert").textContent).toBe(
        "La cuenta cambió mientras cobrabas. Revisa el total antes de registrar el pago.",
      );
      expect(checkout.getByLabelText("Efectivo recibido")).toHaveProperty(
        "value",
        "",
      );
      expect(
        checkout.getByRole("button", { name: "Registrar pago" }),
      ).toHaveProperty("disabled", true);
      await userEvent.type(checkout.getByLabelText("Efectivo recibido"), "100");
      await click(checkout.getByRole("radio", { name: "Tarjeta manual" }));
      await click(checkout.getByRole("radio", { name: "Efectivo" }));
      expect(checkout.getByLabelText("Efectivo recibido")).toHaveProperty(
        "value",
        "100",
      );
      expect(checkout.getByTestId("checkout-change").textContent).toBe(
        "$50.00",
      );
      await click(checkout.getByRole("button", { name: "Registrar pago" }));
      await screen.findByRole("article", { name: "Ticket A-0001" });
      expect(
        app.store.getState().orders[opened.orderId].sale?.settlement,
      ).toMatchObject({ amountDueCents: 5000, changeCents: 5000 });
    } finally {
      app.store.close();
      other.close();
    }
  });

  it("la app avisa cuando la pantalla quedó desactualizada", async () => {
    const backing = createMemoryStorage();
    let deliver!: (batch: CommandBatch) => void;
    const storage: JournalStorage = {
      ...backing,
      subscribe: (listener) => {
        deliver = listener;
        return () => {};
      },
    };
    const app = await renderApp(<App />, { as: "barra", storage });
    const invalid: CommandBatch = {
      ...meta("invalid", luis),
      events: [
        { type: "preparation-advanced", comandaId: "missing", status: "ready" },
      ],
    };
    await backing.append(invalid);
    await act(async () => {
      deliver(invalid);
    });
    expect(
      await screen.findByRole("heading", {
        name: "Esta pantalla quedó desactualizada",
      }),
    ).toBeDefined();
    expect(
      screen.getByText(
        "Recarga la página para continuar. No se perdió ninguna operación guardada.",
      ),
    ).toBeDefined();
    expect(button("Recargar")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Venta" })).toBeNull();
    expect(app.store.getProblem()).toBeInstanceOf(Error);
    app.store.close();
  });
});

describe("EVL-122 Cuentas abiertas en pantalla", () => {
  it("[C] Guardar sin cobrar y reabrir después de recargar", async () => {
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
    expect(screen.getByRole("main").textContent).not.toContain("$");

    await click(card.getByRole("button", { name: "Empezar" }));
    expect(card.getByText("Preparando")).toBeDefined();
    await click(card.getByRole("button", { name: "Marcar lista" }));
    expect(card.getByText("Lista")).toBeDefined();
    await click(card.getByRole("button", { name: "Entregar" }));
    expect(await screen.findByText("Sin comandas pendientes")).toBeDefined();
  });

  it("[B] Una comanda nueva aparece sin recargar", async () => {
    const caja = await renderApp(<App />, { as: "mesero" });
    await addCokes(1);
    caja.unmount();
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
    await click(button("Enviar comanda"));
    expect(panel().getByRole("alert").textContent).toBe(
      "No hay productos nuevos que enviar a cocina.",
    );
  });
});

describe("EVL-123 Cobro en pantalla", () => {
  it("[D] El cierre conserva pagos, propina y cambio", async () => {
    await renderApp(<App />, { as: "barra" });
    await addCokes(2);
    await click(button("Cobrar · $50.00"));
    const checkout = within(await screen.findByRole("dialog"));
    expect(checkout.getByTestId("checkout-due").textContent).toBe("$50.00");
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
    expect(checkout.getByTestId("checkout-subtotal").textContent).toBe(
      "$50.00",
    );
    expect(checkout.getByTestId("checkout-tip").textContent).toBe("$5.00");
    expect(checkout.getByTestId("checkout-due").textContent).toBe("$55.00");

    const confirm = checkout.getByRole("button", { name: "Registrar pago" });
    expect(confirm).toHaveProperty("disabled", true);
    await userEvent.type(checkout.getByLabelText("Efectivo recibido"), "50");
    expect(checkout.getByRole("alert").textContent).toBe(
      "Faltan $5.00 para cubrir el total.",
    );
    expect(confirm).toHaveProperty("disabled", true);

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
