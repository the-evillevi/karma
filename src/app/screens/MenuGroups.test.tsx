import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../../data/pos-store.ts";
import { applyBatch, emptyState } from "../../domain/journal.ts";
import type { CommandBatch } from "../../domain/journal.ts";
import { createModifierGroup, setProductGroups } from "../../domain/menu.ts";
import { saveOrder } from "../../domain/commands.ts";
import { resolveModifiers } from "../../domain/modifiers.ts";
import { addLine } from "../../domain/order.ts";
import {
  admin,
  catalog,
  latte,
  luis,
  meta,
  withoutGroup,
} from "../../domain/testing.ts";
import { App } from "../App.tsx";
import { renderApp } from "../testing.tsx";

vi.mock("../catalog.ts", async () => {
  const testing = await import("../../domain/testing.ts");
  return { catalog: testing.withoutGroup(testing.catalog, "sabor") };
});

const menuBeforeSabor = withoutGroup(catalog, "sabor");

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

function dialog() {
  return within(screen.getByRole("dialog"));
}

function groupSection(name: string) {
  return within(screen.getByRole("region", { name }));
}

async function openModifiers() {
  goTo("#/menu");
  await click(screen.getByRole("tab", { name: "Modificadores" }));
}

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
  menuBeforeSabor,
);

const croissantWithSabor = setProductGroups(
  applyBatch(emptyState(), saborBatch),
  meta("asignar-sabor", admin, "10:01"),
  {
    productId: "52000822188",
    groupIds: ["sabor", "fruta-acompanamiento", "extras-dulces"],
  },
  menuBeforeSabor,
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
  await click(dialog().getByRole("button", { name: "Agregar" }));
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

    app.store.close();
  });

  it("[E] Admin quita un grupo de un producto", async () => {
    const line = addLine([], latte, {
      lineId: "l1",
      modifiers: resolveModifiers(menuBeforeSabor, latte, {
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
    expect(
      within(edit.getByRole("region", { name: "También incluye" })).getByText(
        /Amareto/,
      ),
    ).toBeDefined();
    await userEvent.type(
      edit.getByLabelText("Nota de preparación"),
      "sin espuma",
    );
    await click(edit.getByRole("button", { name: "Guardar cambios · $75.00" }));
    expect(screen.getAllByTestId("order-total")[0].textContent).toBe("$75.00");
    expect(
      app.store
        .getState()
        .orders["o-1"].lines[0].modifiers.map((modifier) => modifier.optionId),
    ).toContain("amareto");
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
    const barra = await renderApp(<App />, { as: "barra" });
    goTo("#/menu");
    expect(screen.queryByRole("tab", { name: "Modificadores" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nuevo grupo" })).toBeNull();
    expect(
      row("Latte").queryByRole("button", { name: "Editar Latte" }),
    ).toBeNull();
    barra.store.close();
    barra.unmount();

    const mesero = await renderApp(<App />, { as: "mesero" });
    goTo("#/menu");
    expect(
      screen.getByRole("link", { name: "Venta" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.queryByRole("button", { name: "Nuevo grupo" })).toBeNull();
    mesero.store.close();
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
          menuBeforeSabor,
        ),
      );
    });
    expect(groupChoices()).toContain("Sabor");
    await addGroup("Sabor");
    expect(assignedGroups().at(-1)).toBe("Sabor");
    app.store.close();
  });
});
