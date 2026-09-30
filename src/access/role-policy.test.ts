import test from "node:test";
import assert from "node:assert/strict";
import {
  canPerform,
  isAccessRole,
  resolveAccessAction,
  seededRoleToAccessRole,
} from "./role-policy.ts";

test("server role matrix supports the allowed work and denies every privileged operation to Mesero", () => {
  assert.equal(canPerform("duena", "manageUsers"), true);
  assert.equal(canPerform("duena", "configureTables"), true);
  assert.equal(canPerform("duena", "cancelPreparationWithReason"), true);
  assert.equal(canPerform("duena", "reprintWithReason"), true);
  assert.equal(canPerform("encargado", "manageUsers"), false);
  assert.equal(canPerform("encargado", "configureTables"), true);
  assert.equal(canPerform("encargado", "cancelPreparationWithReason"), true);
  assert.equal(canPerform("encargado", "reprintWithReason"), true);
  assert.equal(canPerform("duena", "refundSaleWithReason"), true);
  assert.equal(canPerform("encargado", "refundSaleWithReason"), true);
  assert.equal(canPerform("barra", "refundSaleWithReason"), false);
  assert.equal(canPerform("barra", "checkout"), true);
  assert.equal(canPerform("barra", "viewReports"), false);
  assert.equal(canPerform("mesero", "openOrder"), true);
  assert.equal(canPerform("mesero", "viewStock"), true);
  assert.equal(canPerform("mesero", "prepareOrder"), true);
  for (const action of [
    "checkout",
    "cancelWithReason",
    "cancelPreparationWithReason",
    "discountWithReason",
    "reprintWithReason",
    "editMenu",
    "adjustInventory",
    "viewReports",
    "manageUsers",
    "configureTables",
    "refundSaleWithReason",
  ] as const) {
    assert.equal(canPerform("mesero", action), false, action);
  }
});

test("unverified and legacy role labels never become secure role values implicitly", () => {
  assert.equal(isAccessRole("manager"), false);
  assert.equal(isAccessRole("cajero"), false);
  assert.equal(canPerform(null, "checkout"), false);
  assert.equal(canPerform("owner" as never, "checkout"), false);
  assert.equal(seededRoleToAccessRole("cajero"), "barra");
  assert.equal(seededRoleToAccessRole("dueno"), "duena");
  assert.equal(seededRoleToAccessRole("cocina"), "mesero");
  assert.equal(seededRoleToAccessRole("owner"), null);
  assert.equal(resolveAccessAction("cancelar"), "cancelWithReason");
  assert.equal(resolveAccessAction("ajuste"), "adjustInventory");
  assert.equal(resolveAccessAction("configureTables"), "configureTables");
  assert.equal(resolveAccessAction("unknown"), null);
});
