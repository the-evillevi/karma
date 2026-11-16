// Shared fixtures for domain tests. Not imported by app code.
import rawCatalog from "../../catalog/catalog.json";
import { findProduct, parseCatalog } from "./catalog.ts";
import type { Product } from "./catalog.ts";
import type { Actor, CommandMeta, OrderHeader } from "./journal.ts";
import { addLine } from "./order.ts";
import type { LineModifier, OrderLine } from "./order.ts";

export const catalog = parseCatalog(rawCatalog);

export function product(sku: string): Product {
  const found = findProduct(catalog, sku);
  if (!found) throw new Error(`No product ${sku}`);
  return found;
}

export const americano = product("52000822146"); // $50.00
export const latte = product("52000822148"); // $65.00
export const brownie = product("52000822189"); // $38.00

export const avena: LineModifier = {
  groupId: "leche",
  groupName: "Tipo de leche",
  optionId: "avena",
  name: "Avena",
  priceDeltaCents: 1000,
};

export const admin: Actor = { userId: "u-admin", name: "Admin", role: "admin" };
export const luis: Actor = { userId: "u-luis", name: "Luis", role: "barra" };
export const sofi: Actor = { userId: "u-sofi", name: "Sofi", role: "mesero" };

const NO_CUSTOMER = { name: "", phone: "", address: "" };

export function mesa(table: number): OrderHeader {
  return { type: "mesa", table, customer: NO_CUSTOMER };
}

export const mostrador: OrderHeader = {
  type: "mostrador",
  table: null,
  customer: NO_CUSTOMER,
};

/** Command metadata at a given time of 15 Nov 2026 (local hour as "HH:MM"). */
export function meta(
  commandId: string,
  actor: Actor,
  time = "10:00",
): CommandMeta {
  return {
    commandId,
    at: `2026-11-15T${time}:00.000-06:00`,
    actor,
    deviceId: "caja-1",
  };
}

/** One line per [product, quantity?, modifiers?, note?] entry. */
export function linesOf(
  ...entries: [Product, number?, LineModifier[]?, string?][]
): OrderLine[] {
  return entries.reduce<OrderLine[]>(
    (lines, [item, quantity = 1, modifiers = [], note = ""], index) =>
      addLine(lines, item, {
        lineId: `l${index + 1}`,
        quantity,
        modifiers,
        note,
      }),
    [],
  );
}

export function recoger(name: string, phone: string): OrderHeader {
  return {
    type: "recoger",
    table: null,
    customer: { name, phone, address: "" },
  };
}

export function entrega(
  name: string,
  phone: string,
  address: string,
): OrderHeader {
  return { type: "entrega", table: null, customer: { name, phone, address } };
}

/** The rejection reason of a command, or "not rejected". */
export function rejectionOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof Error && error.name === "CommandRejectedError") {
      return (error as Error & { reason: string }).reason;
    }
    throw error;
  }
  return "not rejected";
}
