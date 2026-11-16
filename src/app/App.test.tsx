// Spec: Linear EVL-116, slice [A]. Test names are the scenario titles.
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { currentRoute } from "./router.ts";

function goTo(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

afterEach(() => goTo(""));

describe("EVL-116 [A] Base de la app", () => {
  it("[A] La app abre en la estación de venta", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Venta" })).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Venta" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("[A] La navegación lleva a cuentas, cocina y ventas de hoy", () => {
    render(<App />);
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
