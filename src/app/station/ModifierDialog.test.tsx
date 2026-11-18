import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Catalog, Product } from "../../domain/catalog.ts";
import { resolveModifiers } from "../../domain/modifiers.ts";
import { addLine } from "../../domain/order.ts";
import { catalog, latte } from "../../domain/testing.ts";
import { ModifierDialog } from "./ModifierDialog.tsx";

const captured = addLine([], latte, {
  lineId: "l1",
  modifiers: resolveModifiers(catalog, latte, {
    leche: ["avena"],
    shot: ["amareto"],
  }),
})[0];

describe("EVL-119 [D] Captured modifiers that the menu no longer offers", () => {
  it("keeps a captured modifier from a group the product no longer has", async () => {
    const withoutShot: Product = { ...latte, modifierGroupIds: ["leche"] };
    const onConfirm = vi.fn();
    render(
      <ModifierDialog
        catalog={catalog}
        product={withoutShot}
        line={captured}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Amareto +$10.00")).toBeDefined();
    await userEvent.click(
      dialog.getByRole("button", { name: "Guardar cambios · $85.00" }),
    );
    expect(
      onConfirm.mock.calls[0][0].map((m: { optionId: string }) => m.optionId),
    ).toEqual(["avena", "amareto"]);
  });

  it("keeps a captured option that its group no longer lists", async () => {
    const withoutAvena: Catalog = {
      ...catalog,
      modifierGroups: catalog.modifierGroups.map((group) =>
        group.id === "leche"
          ? { ...group, options: group.options.filter((o) => o.id !== "avena") }
          : group,
      ),
    };
    const onConfirm = vi.fn();
    render(
      <ModifierDialog
        catalog={withoutAvena}
        product={latte}
        line={captured}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    const dialog = within(screen.getByRole("dialog"));
    expect(
      dialog
        .getByRole("radio", { name: "Avena +$10.00" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await userEvent.click(
      dialog.getByRole("button", { name: "Guardar cambios · $85.00" }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
