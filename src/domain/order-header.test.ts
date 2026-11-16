// @vitest-environment node
// Spec: Linear EVL-122, slice [B]. Test names are the scenario titles.
import { describe, expect, it } from "vitest";
import { CommandRejectedError, saveOrder } from "./commands.ts";
import { applyBatch, emptyState } from "./journal.ts";
import type { OrderHeader } from "./journal.ts";
import {
  headerLabel,
  missingCustomerFields,
  requiredCustomerFields,
} from "./order-header.ts";
import {
  americano,
  entrega,
  linesOf,
  luis,
  mesa,
  meta,
  mostrador,
  recoger,
} from "./testing.ts";

function save(header: OrderHeader) {
  return saveOrder(emptyState(), meta("op-1", luis), {
    orderId: "o-1",
    header,
    lines: linesOf([americano]),
  });
}

function missingOnSave(header: OrderHeader): readonly string[] | "saved" {
  try {
    save(header);
  } catch (error) {
    if (
      error instanceof CommandRejectedError &&
      error.reason === "missing-customer-data"
    ) {
      return error.fields;
    }
    throw error;
  }
  return "saved";
}

describe("EVL-122 [B] Datos de entrega y recolección", () => {
  it("[B] Entrega exige nombre, teléfono y dirección", () => {
    // Dado una orden de tipo Entrega sin dirección, cuando intento guardarla,
    // entonces no se guarda y se indica que falta la dirección
    expect(requiredCustomerFields("entrega")).toEqual([
      "name",
      "phone",
      "address",
    ]);
    expect(missingOnSave(entrega("Ana", "4421234567", ""))).toEqual([
      "address",
    ]);
    expect(missingOnSave(entrega("", " ", "  "))).toEqual([
      "name",
      "phone",
      "address",
    ]);
    expect(missingOnSave(entrega("Ana", "4421234567", "Av. Juárez 10"))).toBe(
      "saved",
    );
  });

  it("[B] Recolección exige nombre y teléfono", () => {
    // Dado una orden de tipo Recoger con nombre "Ana" y sin teléfono, cuando
    // intento guardarla, entonces no se guarda y se indica que falta el teléfono
    expect(requiredCustomerFields("recoger")).toEqual(["name", "phone"]);
    expect(missingCustomerFields(recoger("Ana", ""))).toEqual(["phone"]);
    expect(missingOnSave(recoger("Ana", ""))).toEqual(["phone"]);
    expect(missingOnSave(recoger("Ana", "4421234567"))).toBe("saved");
  });

  it("[B] Venta rápida en caja no exige cliente", () => {
    // Dado una orden de tipo Mostrador sin datos de cliente, cuando la
    // guardo, entonces se guarda correctamente
    expect(requiredCustomerFields("mostrador")).toEqual([]);
    expect(requiredCustomerFields("mesa")).toEqual([]);
    expect(missingOnSave(mostrador)).toBe("saved");
    expect(missingOnSave(mesa(3))).toBe("saved");
  });

  it("stores customer data trimmed and labels each order type", () => {
    const state = applyBatch(
      emptyState(),
      save(entrega("  Ana ", " 4421234567 ", " Av. Juárez 10 ")),
    );
    expect(state.orders["o-1"].header.customer).toEqual({
      name: "Ana",
      phone: "4421234567",
      address: "Av. Juárez 10",
    });
    expect(headerLabel(mesa(3))).toBe("Mesa 3");
    expect(headerLabel(mostrador)).toBe("Mostrador");
    expect(headerLabel(recoger("Ana", "4421234567"))).toBe("Recoger · Ana");
    expect(headerLabel(entrega("Ana", "1", "x"))).toBe("Entrega · Ana");
    expect(headerLabel(recoger("", ""))).toBe("Recoger");
  });
});
