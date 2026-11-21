// @vitest-environment node
import { describe, expect, it } from "vitest";
import { findProduct, modifierGroupsFor } from "./catalog.ts";
import type { Catalog, ModifierGroup, Product } from "./catalog.ts";
import { saveOrder } from "./commands.ts";
import { applyBatch, emptyState, replay } from "./journal.ts";
import type { Actor, CommandBatch, CommandMeta, PosState } from "./journal.ts";
import {
  addModifierOption,
  createModifierGroup,
  menuFor,
  setProductGroups,
  updateModifierOption,
} from "./menu.ts";
import type { NewGroupInput } from "./menu.ts";
import {
  ModifierError,
  defaultSelection,
  editLine,
  resolveModifiers,
} from "./modifiers.ts";
import { addLine, lineUnitCents } from "./order.ts";
import {
  admin,
  catalog,
  latte,
  luis,
  mostrador,
  product,
  rejectionOf,
  sofi,
} from "./testing.ts";

const croissant = product("52000822188");
const crepaPollo = product("52000822208");

const sabor: NewGroupInput = {
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

let sequence = 0;
function at(actor: Actor = admin): CommandMeta {
  sequence += 1;
  return {
    commandId: `grp-${sequence}`,
    at: "2026-11-21T09:00:00.000-06:00",
    actor,
    deviceId: "caja-1",
  };
}

function run(
  state: PosState,
  decide: (state: PosState) => CommandBatch,
): PosState {
  return applyBatch(state, decide(state));
}

const menuOf = (state: PosState): Catalog => menuFor(catalog, state.menu);

function inMenu(state: PosState, item: Product): Product {
  const found = findProduct(menuOf(state), item.id);
  if (!found) throw new Error(`No product ${item.id}`);
  return found;
}

function group(menu: Catalog, groupId: string): ModifierGroup {
  const found = menu.modifierGroups.find((item) => item.id === groupId);
  if (!found) throw new Error(`No group ${groupId}`);
  return found;
}

const withSabor = () =>
  run(emptyState(), (current) =>
    createModifierGroup(current, at(), sabor, catalog),
  );

const assign = (state: PosState, item: Product, groupIds: string[]) =>
  run(state, (current) =>
    setProductGroups(current, at(), { productId: item.id, groupIds }, catalog),
  );

describe("EVL-119 [E] Grupos de modificadores", () => {
  it("[E] Admin crea un grupo de modificadores", () => {
    const batch = createModifierGroup(emptyState(), at(), sabor, catalog);
    const state = applyBatch(emptyState(), batch);
    const groups = menuOf(state).modifierGroups;
    expect(groups.map((item) => item.id).at(-1)).toBe("sabor");
    expect(groups).toHaveLength(catalog.modifierGroups.length + 1);
    expect(group(menuOf(state), "sabor")).toMatchObject({
      name: "Sabor",
      min: 1,
      max: 1,
    });
    expect(group(menuOf(state), "sabor").defaultOptionId).toBeUndefined();
    expect(
      group(menuOf(state), "sabor").options.map((option) => [
        option.id,
        option.name,
        option.priceDeltaCents,
        option.active,
      ]),
    ).toEqual([
      ["fresa", "Mermelada de fresa", 0, true],
      ["frutos-rojos", "Mermelada de frutos rojos", 0, true],
      ["zarzamora", "Mermelada de zarzamora c/ queso", 0, true],
    ]);
    expect(replay([batch])).toEqual(state);

    const attempt = (changes: Partial<NewGroupInput>, current = state) =>
      rejectionOf(() =>
        createModifierGroup(
          current,
          at(),
          { ...sabor, groupId: "otro", name: "Otro", ...changes },
          catalog,
        ),
      );
    expect(attempt({ name: "  " })).toBe("invalid-group-name");
    expect(attempt({ name: "tipo de leche" })).toBe("duplicate-group");
    expect(attempt({ name: " SABOR " })).toBe("duplicate-group");
    expect(attempt({ groupId: "leche" })).toBe("duplicate-group");
    expect(attempt({ options: [] })).toBe("group-needs-option");
    expect(attempt({ min: 2, max: 1 })).toBe("invalid-group-limits");
    expect(attempt({ min: 0, max: 0 })).toBe("invalid-group-limits");
    expect(attempt({ min: 0, max: 4 })).toBe("invalid-group-limits");
    expect(attempt({ min: -1, max: 1 })).toBe("invalid-group-limits");
    expect(attempt({ min: 0.5, max: 1 })).toBe("invalid-group-limits");
    expect(attempt({ defaultOptionId: "nutella" })).toBe("unknown-option");
    expect(
      attempt({ options: [{ optionId: "a", name: " ", priceDeltaCents: 0 }] }),
    ).toBe("invalid-option-name");
    expect(
      attempt({
        options: [
          { optionId: "a", name: "Fresa", priceDeltaCents: 0 },
          { optionId: "b", name: "FRESA", priceDeltaCents: 0 },
        ],
      }),
    ).toBe("duplicate-option");
    expect(
      attempt({
        options: [
          { optionId: "a", name: "Fresa", priceDeltaCents: 0 },
          { optionId: "a", name: "Mango", priceDeltaCents: 0 },
        ],
      }),
    ).toBe("duplicate-option");
    expect(
      attempt({
        options: [{ optionId: "a", name: "Fresa", priceDeltaCents: -1 }],
      }),
    ).toBe("invalid-option-price");
    expect(attempt({ min: 0, max: 3, defaultOptionId: "fresa" })).toBe(
      "not rejected",
    );
  });

  it("[E] Admin asigna grupos a un producto en orden", () => {
    let state = withSabor();
    const batch = setProductGroups(
      state,
      at(),
      {
        productId: croissant.id,
        groupIds: ["sabor", "fruta-acompanamiento", "extras-dulces"],
      },
      catalog,
    );
    state = applyBatch(state, batch);
    const menu = menuOf(state);
    const item = inMenu(state, croissant);
    expect(modifierGroupsFor(menu, item).map((g) => g.id)).toEqual([
      "sabor",
      "fruta-acompanamiento",
      "extras-dulces",
    ]);
    expect(defaultSelection(menu, item).sabor).toEqual([]);
    expect(() =>
      resolveModifiers(menu, item, { "fruta-acompanamiento": ["durazno"] }),
    ).toThrow(ModifierError);
    const line = addLine([], item, {
      lineId: "l1",
      modifiers: resolveModifiers(menu, item, {
        sabor: ["fresa"],
        "fruta-acompanamiento": ["durazno"],
      }),
    })[0];
    expect(lineUnitCents(line)).toBe(6000);
    expect(line.modifiers.map((m) => m.name)).toEqual([
      "Mermelada de fresa",
      "Durazno",
    ]);

    state = assign(state, crepaPollo, [
      "acompanamiento",
      "aderezo-incluido",
      "aderezo-extra",
    ]);
    expect(
      modifierGroupsFor(menuOf(state), inMenu(state, crepaPollo)).map(
        (g) => g.name,
      ),
    ).toEqual(["Acompañamiento", "Aderezo incluido", "Aderezo extra"]);
  });

  it("[E] Admin quita un grupo de un producto", () => {
    const captured = addLine([], latte, {
      lineId: "l1",
      modifiers: resolveModifiers(catalog, latte, {
        leche: ["entera"],
        shot: ["amareto"],
      }),
    });
    let state = run(emptyState(), (current) =>
      saveOrder(current, at(luis), {
        orderId: "o-1",
        header: mostrador,
        lines: captured,
      }),
    );
    const before = structuredClone(state.orders["o-1"]);
    state = assign(state, latte, ["leche"]);
    const menu = menuOf(state);
    const item = inMenu(state, latte);
    expect(modifierGroupsFor(menu, item).map((g) => g.id)).toEqual(["leche"]);
    expect(() =>
      resolveModifiers(menu, item, { leche: ["entera"], shot: ["amareto"] }),
    ).toThrow(ModifierError);
    expect(state.orders["o-1"]).toEqual(before);
    const line = state.orders["o-1"].lines[0];
    expect(lineUnitCents(line)).toBe(7500);
    const kept = resolveModifiers(
      menu,
      item,
      { leche: ["entera"] },
      line.modifiers,
    );
    expect(
      lineUnitCents(
        editLine([line], "l1", { modifiers: kept, note: "tibio" })[0],
      ),
    ).toBe(7500);

    const attempt = (groupIds: string[]) =>
      rejectionOf(() =>
        setProductGroups(
          state,
          at(),
          { productId: latte.id, groupIds },
          catalog,
        ),
      );
    expect(attempt(["leche", "toppings"])).toBe("unknown-modifier-group");
    expect(attempt(["leche", "shot", "leche"])).toBe("repeated-group");
    expect(attempt([])).toBe("not rejected");
    expect(
      rejectionOf(() =>
        setProductGroups(
          state,
          at(),
          { productId: "52000822999", groupIds: [] },
          catalog,
        ),
      ),
    ).toBe("unknown-product");
  });

  it("[E] Las opciones de un grupo nuevo se editan como las demás", () => {
    let state = withSabor();
    state = run(state, (current) =>
      addModifierOption(
        current,
        at(),
        {
          groupId: "sabor",
          optionId: "nutella",
          name: "Nutella",
          priceDeltaCents: 1000,
        },
        catalog,
      ),
    );
    state = run(state, (current) =>
      updateModifierOption(
        current,
        at(),
        { groupId: "sabor", optionId: "fresa", name: "Fresa" },
        catalog,
      ),
    );
    state = run(state, (current) =>
      updateModifierOption(
        current,
        at(),
        { groupId: "sabor", optionId: "frutos-rojos", active: false },
        catalog,
      ),
    );
    const offered = group(menuOf(state), "sabor")
      .options.filter((option) => option.active)
      .map((option) => [option.name, option.priceDeltaCents]);
    expect(offered).toEqual([
      ["Fresa", 0],
      ["Mermelada de zarzamora c/ queso", 0],
      ["Nutella", 1000],
    ]);
  });

  it("[E] Solo Admin crea grupos y los asigna", () => {
    for (const actor of [luis, sofi]) {
      expect(
        rejectionOf(() =>
          createModifierGroup(emptyState(), at(actor), sabor, catalog),
        ),
      ).toBe("not-allowed");
      expect(
        rejectionOf(() =>
          setProductGroups(
            emptyState(),
            at(actor),
            { productId: latte.id, groupIds: ["leche"] },
            catalog,
          ),
        ),
      ).toBe("not-allowed");
    }
  });
});

describe("EVL-119 [E] Grupos sobre el menú base", () => {
  it("lets the base menu win when a later deploy adds a group with the same id", () => {
    const state = withSabor();
    const later: Catalog = {
      ...catalog,
      modifierGroups: [
        ...catalog.modifierGroups,
        {
          id: "sabor",
          name: "Sabor base",
          min: 0,
          max: 1,
          options: [
            { id: "cajeta", name: "Cajeta", priceDeltaCents: 0, active: true },
          ],
        },
      ],
    };
    const groups = menuFor(later, state.menu).modifierGroups.filter(
      (item) => item.id === "sabor",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Sabor base");
  });

  it("keeps the base menu when nothing changed and skips assigned groups a menu lacks", () => {
    expect(menuFor(catalog, emptyState().menu)).toEqual(catalog);
    const state = assign(withSabor(), croissant, [
      "sabor",
      "fruta-acompanamiento",
    ]);
    const item = inMenu(state, croissant);
    expect(modifierGroupsFor(catalog, item).map((g) => g.id)).toEqual([
      "fruta-acompanamiento",
    ]);
  });
});
