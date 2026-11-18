// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Catalog, ModifierGroup } from "./catalog.ts";
import { saveOrder } from "./commands.ts";
import { applyBatch, emptyState, replay } from "./journal.ts";
import type { Actor, CommandBatch, CommandMeta, PosState } from "./journal.ts";
import { addModifierOption, menuFor, updateModifierOption } from "./menu.ts";
import type { NewOptionInput, OptionEdit } from "./menu.ts";
import {
  ModifierError,
  defaultSelection,
  editLine,
  resolveModifiers,
} from "./modifiers.ts";
import type { ModifierSelection } from "./modifiers.ts";
import { addLine, lineUnitCents } from "./order.ts";
import type { OrderLine } from "./order.ts";
import {
  admin,
  catalog,
  latte,
  luis,
  mostrador,
  rejectionOf,
  sofi,
} from "./testing.ts";

let sequence = 0;
function at(actor: Actor = admin): CommandMeta {
  sequence += 1;
  return {
    commandId: `opt-${sequence}`,
    at: "2026-11-18T09:00:00.000-06:00",
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

const editOption = (state: PosState, input: OptionEdit, actor = admin) =>
  run(state, (current) =>
    updateModifierOption(current, at(actor), input, catalog),
  );

const addOption = (state: PosState, input: NewOptionInput) =>
  run(state, (current) => addModifierOption(current, at(), input, catalog));

function group(menu: Catalog, groupId: string): ModifierGroup {
  const found = menu.modifierGroups.find((item) => item.id === groupId);
  if (!found) throw new Error(`No group ${groupId}`);
  return found;
}

function latteWith(
  menu: Catalog,
  selection: ModifierSelection,
  lineId = "l1",
): OrderLine {
  return addLine([], latte, {
    lineId,
    modifiers: resolveModifiers(menu, latte, {
      leche: ["entera"],
      ...selection,
    }),
  })[0];
}

describe("EVL-119 [D] Opciones de un grupo", () => {
  it("[D] Admin cambia el precio de una opción", () => {
    expect(lineUnitCents(latteWith(catalog, { leche: ["avena"] }))).toBe(7500);
    const batch = updateModifierOption(
      emptyState(),
      at(),
      { groupId: "leche", optionId: "avena", priceDeltaCents: 0 },
      catalog,
    );
    const state = applyBatch(emptyState(), batch);
    expect(
      group(menuOf(state), "leche").options.find((o) => o.id === "avena"),
    ).toMatchObject({ name: "Avena", priceDeltaCents: 0, active: true });
    expect(lineUnitCents(latteWith(menuOf(state), { leche: ["avena"] }))).toBe(
      6500,
    );
    expect(replay([batch])).toEqual(state);
    for (const priceDeltaCents of [-100, 1.5, Number.NaN]) {
      expect(
        rejectionOf(() =>
          updateModifierOption(
            emptyState(),
            at(),
            { groupId: "leche", optionId: "avena", priceDeltaCents },
            catalog,
          ),
        ),
      ).toBe("invalid-option-price");
    }
  });

  it("[D] El cambio de opciones no toca cuentas ya capturadas", () => {
    const avena = latteWith(catalog, { leche: ["avena"] }, "l1");
    const amareto = latteWith(catalog, { shot: ["amareto"] }, "l2");
    let state = run(emptyState(), (current) =>
      saveOrder(current, at(luis), {
        orderId: "o-1",
        header: mostrador,
        lines: [avena, amareto],
      }),
    );
    const captured = structuredClone(state.orders["o-1"]);
    state = editOption(state, {
      groupId: "leche",
      optionId: "avena",
      priceDeltaCents: 0,
    });
    state = editOption(state, {
      groupId: "shot",
      optionId: "amareto",
      name: "Amaretto",
    });
    expect(state.orders["o-1"]).toEqual(captured);

    const menu = menuOf(state);
    const [line1, line2] = state.orders["o-1"].lines;
    const kept1 = resolveModifiers(
      menu,
      latte,
      { leche: ["avena"] },
      line1.modifiers,
    );
    const kept2 = resolveModifiers(
      menu,
      latte,
      { leche: ["entera"], shot: ["amareto"] },
      line2.modifiers,
    );
    const edited = editLine(
      editLine(state.orders["o-1"].lines, "l1", {
        modifiers: kept1,
        note: "sin espuma",
      }),
      "l2",
      { modifiers: kept2, note: "tibio" },
    );
    expect(lineUnitCents(edited[0])).toBe(7500);
    expect(edited[1].modifiers.map((m) => m.name)).toContain("Amareto");

    const withNewShot = resolveModifiers(
      menu,
      latte,
      { leche: ["avena"], shot: ["avellana"] },
      line1.modifiers,
    );
    expect(withNewShot.map((m) => [m.optionId, m.priceDeltaCents])).toEqual([
      ["avena", 1000],
      ["avellana", 1000],
    ]);
  });

  it("[D] Admin renombra una opción", () => {
    const state = editOption(emptyState(), {
      groupId: "shot",
      optionId: "amareto",
      name: " Amaretto ",
    });
    expect(
      group(menuOf(state), "shot").options.find((o) => o.id === "amareto")
        ?.name,
    ).toBe("Amaretto");
    expect(
      latteWith(menuOf(state), { shot: ["amareto"] }).modifiers.map(
        (m) => m.name,
      ),
    ).toContain("Amaretto");
    const attempt = (name: string) =>
      rejectionOf(() =>
        updateModifierOption(
          state,
          at(),
          { groupId: "shot", optionId: "amareto", name },
          catalog,
        ),
      );
    expect(attempt("   ")).toBe("invalid-option-name");
    expect(attempt("AVELLANA")).toBe("duplicate-option");
    expect(attempt("vainilla francesa")).toBe("duplicate-option");
    expect(attempt("AMARETTO")).toBe("not rejected");
  });

  it("[D] Admin agrega una opción", () => {
    const batch = addModifierOption(
      emptyState(),
      at(),
      {
        groupId: "leche",
        optionId: "soya",
        name: " Soya ",
        priceDeltaCents: 0,
      },
      catalog,
    );
    const state = applyBatch(emptyState(), batch);
    const leche = group(menuOf(state), "leche");
    expect(leche.options.map((o) => o.name)).toEqual([
      "Entera",
      "Deslactosada",
      "Coco",
      "Almendras",
      "Avena",
      "Soya",
    ]);
    expect(leche.options.at(-1)).toMatchObject({
      id: "soya",
      priceDeltaCents: 0,
      active: true,
    });
    expect(lineUnitCents(latteWith(menuOf(state), { leche: ["soya"] }))).toBe(
      6500,
    );
    expect(replay([batch])).toEqual(state);

    const attempt = (input: Partial<NewOptionInput>) =>
      rejectionOf(() =>
        addModifierOption(
          state,
          at(),
          {
            groupId: "leche",
            optionId: "nueva",
            name: "Nueva",
            priceDeltaCents: 0,
            ...input,
          },
          catalog,
        ),
      );
    expect(attempt({ name: "COCO" })).toBe("duplicate-option");
    expect(attempt({ name: "soya" })).toBe("duplicate-option");
    expect(attempt({ optionId: "avena" })).toBe("duplicate-option");
    expect(attempt({ name: " " })).toBe("invalid-option-name");
    expect(attempt({ priceDeltaCents: -1 })).toBe("invalid-option-price");
    expect(attempt({ groupId: "toppings" })).toBe("unknown-modifier-group");
    expect(attempt({})).toBe("not rejected");
  });

  it("[D] Admin oculta una opción", () => {
    const coco = latteWith(catalog, { leche: ["coco"] });
    let state = run(emptyState(), (current) =>
      saveOrder(current, at(luis), {
        orderId: "o-1",
        header: mostrador,
        lines: [coco],
      }),
    );
    const captured = structuredClone(state.orders["o-1"]);
    state = editOption(state, {
      groupId: "leche",
      optionId: "coco",
      active: false,
    });
    expect(
      group(menuOf(state), "leche").options.find((o) => o.id === "coco"),
    ).toMatchObject({ active: false });
    expect(() =>
      resolveModifiers(menuOf(state), latte, { leche: ["coco"] }),
    ).toThrow(ModifierError);
    expect(state.orders["o-1"]).toEqual(captured);
    const kept = resolveModifiers(
      menuOf(state),
      latte,
      { leche: ["coco"] },
      state.orders["o-1"].lines[0].modifiers,
    );
    expect(kept.map((m) => m.optionId)).toEqual(["coco"]);

    expect(defaultSelection(menuOf(state), latte).leche).toEqual(["entera"]);
    state = editOption(state, {
      groupId: "leche",
      optionId: "entera",
      active: false,
    });
    expect(defaultSelection(menuOf(state), latte).leche).toEqual([]);
    expect(() => resolveModifiers(menuOf(state), latte, {})).toThrow(
      ModifierError,
    );

    for (const optionId of ["deslactosada", "almendras"]) {
      state = editOption(state, { groupId: "leche", optionId, active: false });
    }
    expect(
      rejectionOf(() =>
        updateModifierOption(
          state,
          at(),
          { groupId: "leche", optionId: "avena", active: false },
          catalog,
        ),
      ),
    ).toBe("group-needs-option");
    expect(
      rejectionOf(() =>
        updateModifierOption(
          state,
          at(),
          { groupId: "shot", optionId: "amareto", active: false },
          catalog,
        ),
      ),
    ).toBe("not rejected");
  });

  it("[D] Solo Admin cambia las opciones", () => {
    for (const actor of [luis, sofi]) {
      for (const input of [
        { priceDeltaCents: 0 },
        { name: "Avena orgánica" },
        { active: false },
      ]) {
        expect(
          rejectionOf(() =>
            updateModifierOption(
              emptyState(),
              at(actor),
              { groupId: "leche", optionId: "avena", ...input },
              catalog,
            ),
          ),
        ).toBe("not-allowed");
      }
      expect(
        rejectionOf(() =>
          addModifierOption(
            emptyState(),
            at(actor),
            {
              groupId: "leche",
              optionId: "soya",
              name: "Soya",
              priceDeltaCents: 0,
            },
            catalog,
          ),
        ),
      ).toBe("not-allowed");
    }
  });
});

describe("EVL-119 [D] Opciones sobre el menú base", () => {
  it("rejects edits to an option or group that does not exist", () => {
    const attempt = (input: OptionEdit) =>
      rejectionOf(() =>
        updateModifierOption(emptyState(), at(), input, catalog),
      );
    expect(attempt({ groupId: "leche", optionId: "soya", name: "Soya" })).toBe(
      "unknown-option",
    );
    expect(attempt({ groupId: "toppings", optionId: "x", name: "X" })).toBe(
      "unknown-modifier-group",
    );
  });

  it("edits an added option like a base one and keeps the base menu when nothing changed", () => {
    let state = addOption(emptyState(), {
      groupId: "leche",
      optionId: "soya",
      name: "Soya",
      priceDeltaCents: 0,
    });
    state = editOption(state, {
      groupId: "leche",
      optionId: "soya",
      priceDeltaCents: 500,
    });
    expect(
      group(menuOf(state), "leche").options.find((o) => o.id === "soya")
        ?.priceDeltaCents,
    ).toBe(500);
    expect(menuFor(catalog, emptyState().menu)).toEqual(catalog);
  });

  it("lets the base menu win when a later deploy adds an option with the same id", () => {
    const state = addOption(emptyState(), {
      groupId: "leche",
      optionId: "soya",
      name: "Soya",
      priceDeltaCents: 0,
    });
    const later: Catalog = {
      ...catalog,
      modifierGroups: catalog.modifierGroups.map((item) =>
        item.id === "leche"
          ? {
              ...item,
              options: [
                ...item.options,
                {
                  id: "soya",
                  name: "Soya orgánica",
                  priceDeltaCents: 800,
                  active: true,
                },
              ],
            }
          : item,
      ),
    };
    const options = group(menuFor(later, state.menu), "leche").options;
    expect(options.filter((o) => o.id === "soya")).toHaveLength(1);
    expect(options.find((o) => o.id === "soya")?.name).toBe("Soya orgánica");
  });
});
