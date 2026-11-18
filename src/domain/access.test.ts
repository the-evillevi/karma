// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PERMISSIONS, can, permissionsOf } from "./access.ts";
import type { Permission } from "./access.ts";

const EVERYONE: Permission[] = ["capture-order", "send-comanda"];
const ADMIN_ONLY: Permission[] = [
  "cancel",
  "discount",
  "edit-menu",
  "adjust-inventory",
  "view-reports",
  "manage-users",
  "configure-tables",
  "reprint",
];

describe("EVL-118 [A] Matriz de permisos", () => {
  it("[A] Admin puede todo", () => {
    expect(permissionsOf("admin")).toEqual([...PERMISSIONS]);
    for (const permission of PERMISSIONS) {
      expect(can("admin", permission)).toBe(true);
    }
  });

  it("[A] Barra cobra pero no corrige ni administra", () => {
    expect(permissionsOf("barra")).toEqual([...EVERYONE, "charge"]);
    for (const permission of ADMIN_ONLY) {
      expect(can("barra", permission)).toBe(false);
    }
  });

  it("[A] Mesero captura pero no cobra", () => {
    expect(permissionsOf("mesero")).toEqual(EVERYONE);
    expect(can("mesero", "charge")).toBe(false);
    for (const permission of ADMIN_ONLY) {
      expect(can("mesero", permission)).toBe(false);
    }
  });

  it("[A] Un rol desconocido no tiene permisos", () => {
    expect(can("invitado", "capture-order")).toBe(false);
    expect(permissionsOf("invitado")).toEqual([]);
    expect(can("toString", "capture-order")).toBe(false);
    expect(can("Admin", "charge")).toBe(false);
  });
});
