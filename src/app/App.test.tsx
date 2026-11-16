// Spec: Linear EVL-116 slice [A] and EVL-118 slice [B].
// Test names are the scenario titles.
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pinDigest } from "../data/pin.ts";
import { App } from "./App.tsx";
import { currentRoute } from "./router.ts";
import { renderApp } from "./testing.tsx";
import { PILOT_USERS } from "./users.ts";

function goTo(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

async function typePin(pin: string) {
  for (const digit of pin) {
    await userEvent.click(screen.getByRole("button", { name: digit }));
  }
}

beforeEach(() => window.localStorage.clear());
afterEach(() => goTo(""));

describe("EVL-116 [A] Base de la app", () => {
  it("[A] La app abre en la estación de venta", async () => {
    await renderApp(<App />, { as: "barra" });
    expect(screen.getByRole("heading", { name: "Venta" })).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Venta" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("[A] La navegación lleva a cuentas, cocina y ventas de hoy", async () => {
    await renderApp(<App />, { as: "barra" });
    const nav = screen.getByRole("navigation", { name: "Secciones" });
    expect(
      Array.from(nav.querySelectorAll("a")).map((link) => link.textContent),
    ).toEqual(["Venta", "Cuentas abiertas", "Cocina", "Ventas de hoy"]);

    goTo("#/cocina");
    expect(screen.getByRole("heading", { name: "Cocina" })).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Cocina" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "Venta" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("[A] Una dirección desconocida vuelve a la estación de venta", () => {
    expect(currentRoute("#/no-existe")).toBe("/");
    expect(currentRoute("")).toBe("/");
    expect(currentRoute("#/ventas")).toBe("/ventas");
  });
});

describe("EVL-118 [B] Entrar con PIN", () => {
  it("[B] El PIN correcto abre la sesión de esa persona", async () => {
    // Dado los usuarios iniciales, cuando capturo 2222, entonces entro como
    // Barra y veo la estación de venta
    await renderApp(<App />);
    expect(screen.queryByRole("navigation")).toBeNull();
    await typePin("2222");
    expect(await screen.findByRole("heading", { name: "Venta" })).toBeDefined();
    const header = within(screen.getByRole("banner"));
    expect(header.getAllByText("Barra").length).toBeGreaterThan(0);
  });

  it("[B] Un PIN incorrecto no abre sesión", async () => {
    // Cuando capturo 9999, entonces veo "PIN incorrecto" y sigo en el acceso
    await renderApp(<App />);
    await typePin("9999");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "PIN incorrecto",
    );
    expect(screen.queryByRole("heading", { name: "Venta" })).toBeNull();
    // The pad is ready for another try.
    await typePin("1111");
    expect(await screen.findByRole("heading", { name: "Venta" })).toBeDefined();
  });

  it("[B] Un usuario desactivado no entra", async () => {
    // Dado el usuario Mesero desactivado, cuando capturo 3333, entonces veo
    // "PIN incorrecto" y no se abre sesión
    const users = PILOT_USERS.map((user) =>
      user.role === "mesero" ? { ...user, active: false } : user,
    );
    await renderApp(<App />, { users });
    await typePin("3333");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "PIN incorrecto",
    );
  });

  it("[B] Se puede entrar sin conexión", async () => {
    // Dado el dispositivo sin internet, cuando capturo 1111, entonces entro
    // como Admin sin esperar la red
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("offline: signing in must not use the network");
    };
    try {
      await renderApp(<App />);
      await typePin("1111");
      expect(
        await screen.findByRole("heading", { name: "Venta" }),
      ).toBeDefined();
      expect(
        within(screen.getByRole("banner")).getAllByText("Admin"),
      ).toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("[B] Cambiar de usuario conserva la orden en captura", async () => {
    // Dado Mesero con una orden sin guardar de 2 Coca Colas, cuando cierra
    // sesión y Barra entra con 2222, entonces Barra ve la misma orden
    await renderApp(<App />, { as: "mesero" });
    const coke = screen.getByRole("button", { name: /^Coca Cola/ });
    await userEvent.click(coke);
    await userEvent.click(coke);
    await userEvent.click(screen.getByRole("button", { name: "Salir" }));
    await typePin("2222");
    await screen.findByRole("heading", { name: "Venta" });
    expect(screen.getByLabelText("Cantidad de Coca Cola").textContent).toBe(
      "2",
    );
  });

  it("[B] Los PIN no se guardan legibles", async () => {
    // Dado los usuarios iniciales, cuando reviso lo almacenado, entonces no
    // aparece ningún PIN en texto claro, sólo su huella
    const serialized = JSON.stringify(PILOT_USERS);
    for (const pin of ["1111", "2222", "3333"]) {
      expect(serialized).not.toContain(pin);
    }
    expect(PILOT_USERS.map((user) => user.pinDigest)).toEqual(
      await Promise.all(["1111", "2222", "3333"].map(pinDigest)),
    );
    expect(await pinDigest("2222")).toMatch(/^[0-9a-f]{64}$/);
  });
});
