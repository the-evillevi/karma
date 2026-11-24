import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PosStore, createMemoryStorage } from "../../data/pos-store.ts";
import { advancePreparation, sendComanda } from "../../domain/comanda.ts";
import { saveOrder } from "../../domain/commands.ts";
import type { PreparationStatus } from "../../domain/journal.ts";
import {
  latte,
  linesOf,
  luis,
  mostrador,
  meta,
  sofi,
} from "../../domain/testing.ts";
import { App } from "../App.tsx";
import { renderApp } from "../testing.tsx";

function goTo(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

afterEach(() => {
  vi.useRealTimers();
  goTo("");
});

async function comandaReadyAt1015() {
  const storage = createMemoryStorage();
  const store = await PosStore.open(storage);
  await store.commit(
    saveOrder(store.getState(), meta("save", sofi, "10:00"), {
      orderId: "o-1",
      header: mostrador,
      lines: linesOf([latte]),
    }),
  );
  await store.commit(
    sendComanda(store.getState(), meta("send", sofi, "10:05"), {
      orderId: "o-1",
      comandaId: "c-1",
    }),
  );
  const steps: [PreparationStatus, string][] = [
    ["preparing", "10:09"],
    ["ready", "10:15"],
  ];
  for (const [to, time] of steps) {
    await store.commit(
      advancePreparation(store.getState(), meta(`adv-${to}`, luis, time), {
        comandaId: "c-1",
        to,
      }),
    );
  }
  store.close();
  return storage;
}

function card() {
  return within(screen.getByRole("listitem", { name: "Comanda A-0001" }));
}

function expectTimes(text: string) {
  expect(text).toContain("Tiempo en cada estado");
  expect(text).toMatch(/En cola\s*4 min/);
  expect(text).toMatch(/Preparando\s*6 min/);
  expect(text).toMatch(/Lista\s*2 min/);
  expect(text).toMatch(/Total\s*12 min/);
  expect(text).not.toContain("Entregada");
}

describe("EVL-124 [F] Cronómetro en Cocina", () => {
  it("[F] La pastilla de estado muestra cuánto lleva en ese estado", async () => {
    const storage = await comandaReadyAt1015();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T10:17:30.000-06:00"));
    goTo("#/cocina");
    const app = await renderApp(<App />, { as: "barra", storage });

    expect(
      card().getByRole("button", { name: /^Lista\s*·\s*2 min$/ }),
    ).toBeDefined();
    expect(card().getByText("Lista")).toBeDefined();
    app.store.close();
  });

  it("[F] La pastilla muestra el tiempo en cada estado", async () => {
    const storage = await comandaReadyAt1015();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T10:17:30.000-06:00"));
    goTo("#/cocina");
    const app = await renderApp(<App />, { as: "barra", storage });
    const pill = card().getByRole("button", { name: /^Lista\s*·\s*2 min$/ });

    await userEvent.hover(pill);
    expectTimes((await screen.findByRole("tooltip")).textContent ?? "");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

    fireEvent.pointerDown(pill);
    fireEvent.click(pill, { detail: 1 });
    expectTimes((await screen.findByRole("tooltip")).textContent ?? "");
    fireEvent.pointerDown(pill);
    fireEvent.click(pill, { detail: 1 });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    app.store.close();
  });

  it("[F] El cronómetro avanza sin recargar", async () => {
    const storage = await comandaReadyAt1015();
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-15T10:17:30.000-06:00"));
    goTo("#/cocina");
    const app = await renderApp(<App />, { as: "barra", storage });
    expect(
      card().getByRole("button", { name: /^Lista\s*·\s*2 min$/ }),
    ).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(
      card().getByRole("button", { name: /^Lista\s*·\s*3 min$/ }),
    ).toBeDefined();
    app.store.close();
  });
});
