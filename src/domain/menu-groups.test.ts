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
  updateProductAndGroups,
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
  rejectionOf,
  sofi,
  withoutGroup,
} from "./testing.ts";

const menuBeforeSabor = withoutGroup(catalog, "sabor");

function productIn(menu: Catalog, id: string): Product {
  const found = findProduct(menu, id);
  if (!found) throw new Error(`No product ${id}`);
  return found;
}

const croissant = productIn(menuBeforeSabor, "52000822188");

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

const menuOf = (state: PosState): Catalog =>
  menuFor(menuBeforeSabor, state.menu);

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
    createModifierGroup(current, at(), sabor, menuBeforeSabor),
  );

const assign = (state: PosState, item: Product, groupIds: string[]) =>
  run(state, (current) =>
    setProductGroups(
      current,
      at(),
      { productId: item.id, groupIds },
      menuBeforeSabor,
    ),
  );

describe("EVL-119 [E] Grupos de modificadores", () => {
  it("[E] Admin crea un grupo de modificadores", () => {
    const batch = createModifierGroup(
      emptyState(),
      at(),
      sabor,
      menuBeforeSabor,
    );
    const state = applyBatch(emptyState(), batch);
    const groups = menuOf(state).modifierGroups;
    expect(groups.map((item) => item.id).at(-1)).toBe("sabor");
    expect(groups).toHaveLength(menuBeforeSabor.modifierGroups.length + 1);
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
          menuBeforeSabor,
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
      menuBeforeSabor,
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
  });

  it("[E] Admin quita un grupo de un producto", () => {
    const captured = addLine([], latte, {
      lineId: "l1",
      modifiers: resolveModifiers(menuBeforeSabor, latte, {
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
          menuBeforeSabor,
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
          menuBeforeSabor,
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
        menuBeforeSabor,
      ),
    );
    state = run(state, (current) =>
      updateModifierOption(
        current,
        at(),
        { groupId: "sabor", optionId: "fresa", name: "Fresa" },
        menuBeforeSabor,
      ),
    );
    state = run(state, (current) =>
      updateModifierOption(
        current,
        at(),
        { groupId: "sabor", optionId: "frutos-rojos", active: false },
        menuBeforeSabor,
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
          createModifierGroup(emptyState(), at(actor), sabor, menuBeforeSabor),
        ),
      ).toBe("not-allowed");
      expect(
        rejectionOf(() =>
          setProductGroups(
            emptyState(),
            at(actor),
            { productId: latte.id, groupIds: ["leche"] },
            menuBeforeSabor,
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
      ...menuBeforeSabor,
      modifierGroups: [
        ...menuBeforeSabor.modifierGroups,
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
    expect(menuFor(menuBeforeSabor, emptyState().menu)).toEqual(
      menuBeforeSabor,
    );
    const state = assign(withSabor(), croissant, [
      "sabor",
      "fruta-acompanamiento",
    ]);
    const item = inMenu(state, croissant);
    expect(modifierGroupsFor(menuBeforeSabor, item).map((g) => g.id)).toEqual([
      "fruta-acompanamiento",
    ]);
  });
});

describe("EVL-119 [E] Saving a product edit in one batch", () => {
  it("records the rename and the new group list as one batch", () => {
    const state = withSabor();
    const batch = updateProductAndGroups(
      state,
      at(),
      {
        productId: croissant.id,
        name: " Croissant de Mermelada ",
        groupIds: ["sabor", "fruta-acompanamiento", "extras-dulces"],
      },
      menuBeforeSabor,
    );
    expect(batch.events.map((event) => event.type)).toEqual([
      "product-updated",
      "product-groups-set",
    ]);
    const item = inMenu(applyBatch(state, batch), croissant);
    expect(item.name).toBe("Croissant de Mermelada");
    expect(item.modifierGroupIds).toEqual([
      "sabor",
      "fruta-acompanamiento",
      "extras-dulces",
    ]);
  });

  it("records only the group list when only the groups changed", () => {
    const batch = updateProductAndGroups(
      emptyState(),
      at(),
      { productId: latte.id, groupIds: ["leche"] },
      menuBeforeSabor,
    );
    expect(batch.events.map((event) => event.type)).toEqual([
      "product-groups-set",
    ]);
    expect(
      inMenu(applyBatch(emptyState(), batch), latte).modifierGroupIds,
    ).toEqual(["leche"]);
  });

  it("records only the rename when the groups did not change", () => {
    const batch = updateProductAndGroups(
      emptyState(),
      at(),
      { productId: latte.id, name: "Latte Grande" },
      menuBeforeSabor,
    );
    expect(batch.events.map((event) => event.type)).toEqual([
      "product-updated",
    ]);
  });

  it("saves nothing when the group list is rejected", () => {
    expect(
      rejectionOf(() =>
        updateProductAndGroups(
          emptyState(),
          at(),
          {
            productId: latte.id,
            name: "Latte Grande",
            groupIds: ["leche", "leche"],
          },
          menuBeforeSabor,
        ),
      ),
    ).toBe("repeated-group");
    expect(
      rejectionOf(() =>
        updateProductAndGroups(
          emptyState(),
          at(),
          { productId: latte.id, name: "", groupIds: ["leche"] },
          menuBeforeSabor,
        ),
      ),
    ).toBe("invalid-name");
  });

  it("only Admin saves product edits and groups", () => {
    expect(
      rejectionOf(() =>
        updateProductAndGroups(
          emptyState(),
          at(sofi),
          { productId: latte.id, groupIds: [] },
          menuBeforeSabor,
        ),
      ),
    ).toBe("not-allowed");
  });
});

describe("EVL-119 [E] Review regressions", () => {
  it("deciding the same product edit again on the applied state is ignored by the journal", () => {
    const retry = at();
    const input = {
      productId: latte.id,
      name: "Latte Grande",
      groupIds: ["leche"],
    };
    const once = applyBatch(
      emptyState(),
      updateProductAndGroups(emptyState(), retry, input, menuBeforeSabor),
    );
    const again = updateProductAndGroups(once, retry, input, menuBeforeSabor);
    expect(applyBatch(once, again)).toBe(once);
  });
});

describe("EVL-112 [D] Un grupo creado en la app y el menú base", () => {
  const carlosSabor: NewGroupInput = { ...sabor, groupId: "sabor-de-carlos" };

  const createdByCarlos = () =>
    run(
      run(emptyState(), (current) =>
        createModifierGroup(current, at(), carlosSabor, menuBeforeSabor),
      ),
      (current) =>
        addModifierOption(
          current,
          at(),
          {
            groupId: "sabor-de-carlos",
            optionId: "nutella",
            name: "Nutella",
            priceDeltaCents: 1000,
          },
          menuBeforeSabor,
        ),
    );

  const croissantGroupIds = (state: PosState) => {
    const menu = menuFor(catalog, state.menu);
    const item = findProduct(menu, croissant.id);
    if (!item) throw new Error("No Croissant Dulce");
    return modifierGroupsFor(menu, item).map((group) => group.id);
  };

  it("does not create a group with the id of a base group that Carlos's group hides", () => {
    const state = createdByCarlos();
    expect(
      rejectionOf(() =>
        createModifierGroup(
          state,
          at(),
          { ...sabor, groupId: "sabor", name: "Mermeladas" },
          catalog,
        ),
      ),
    ).toBe("duplicate-group");
  });

  it("[D] Un Sabor creado en la app no se duplica", () => {
    const assigned = assign(createdByCarlos(), croissant, [
      "sabor-de-carlos",
      "fruta-acompanamiento",
      "extras-dulces",
    ]);
    const sabores = menuFor(catalog, assigned.menu).modifierGroups.filter(
      (group) => group.name.toLowerCase() === "sabor",
    );
    expect(sabores.map((group) => group.id)).toEqual(["sabor-de-carlos"]);
    expect(sabores[0].options.map((option) => option.name)).toContain(
      "Nutella",
    );
    expect(croissantGroupIds(assigned)).toEqual([
      "sabor-de-carlos",
      "fruta-acompanamiento",
      "extras-dulces",
    ]);

    expect(croissantGroupIds(createdByCarlos())).toEqual([
      "sabor-de-carlos",
      "fruta-acompanamiento",
      "extras-dulces",
    ]);
  });
});
