import test from "node:test";
import assert from "node:assert/strict";
import {
  canPerform,
  isAccessRole,
  seededRoleToAccessRole,
} from "./role-policy.ts";

test("server role matrix supports the allowed work and denies every privileged operation to Mesero", () => {
  assert.equal(canPerform("duena", "manageUsers"), true);
  assert.equal(canPerform("encargado", "manageUsers"), false);
  assert.equal(canPerform("barra", "checkout"), true);
  assert.equal(canPerform("barra", "viewReports"), false);
  assert.equal(canPerform("mesero", "openOrder"), true);
  assert.equal(canPerform("mesero", "viewStock"), true);
  assert.equal(canPerform("mesero", "prepareOrder"), true);
  for (const action of [
    "checkout",
    "cancelWithReason",
    "discountWithReason",
    "editMenu",
    "adjustInventory",
    "viewReports",
    "manageUsers",
  ] as const) {
    assert.equal(canPerform("mesero", action), false, action);
  }
});

test("unverified and legacy role labels never become secure role values implicitly", () => {
  assert.equal(isAccessRole("manager"), false);
  assert.equal(isAccessRole("cajero"), false);
  assert.equal(canPerform(null, "checkout"), false);
  assert.equal(seededRoleToAccessRole("cajero"), "barra");
  assert.equal(seededRoleToAccessRole("cocina"), "mesero");
  assert.equal(seededRoleToAccessRole("owner"), null);
});
