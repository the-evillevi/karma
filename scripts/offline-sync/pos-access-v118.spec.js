import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const env = {};
if (existsSync(".env.offline-test.local")) {
  for (const line of readFileSync(".env.offline-test.local", "utf8").split(
    /\r?\n/,
  )) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
}
const enabled = env.SUPABASE_V118_TESTS_ENABLED === "1";
const storageKey = `karma-pos-secure-v1:${encodeURIComponent(env.SUPABASE_BRANCH_ID)}:${encodeURIComponent(env.SUPABASE_CASH_DEVICE_ID)}`;
const rosterKey = `karma-evl118-pos-identities:${env.SUPABASE_BRANCH_ID}:${env.SUPABASE_CASH_DEVICE_ID}`;
const admin = enabled
  ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

async function login(page, role) {
  await page
    .getByLabel("Correo de la cuenta Supabase")
    .fill(env[`SUPABASE_${role}_EMAIL`]);
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill(env[`SUPABASE_${role}_PASSWORD`]);
  await page
    .getByRole("button", { name: "Iniciar sesión con Supabase" })
    .click();
  await expect(
    page.getByRole("searchbox", { name: "Buscar producto" }),
  ).toBeVisible();
}
async function readDraft(page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).order,
    storageKey,
  );
}

test("actual POS verifies identities, preserves the draft across roles and offline PIN, and closes known revoked access", async ({
  page,
  context,
}) => {
  test.skip(
    !enabled,
    "Requires isolated synthetic EVL-118 fixtures and reviewed secure POS runtime.",
  );
  await page.goto("http://127.0.0.1:4179/");
  await expect(
    page.getByRole("heading", { name: "Acceso individual verificado" }),
  ).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Buscar producto" }),
  ).toHaveCount(0);
  try {
    await login(page, "OWNER");
    await page
      .getByRole("button", { name: "Configurar PIN offline", exact: true })
      .click();
    await page.getByLabel("PIN de seis a ocho dígitos").fill("246810");
    await page.getByLabel("Confirma el PIN").fill("246810");
    await page
      .getByRole("button", { name: "Guardar PIN", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Configurar PIN offline" }),
    ).toHaveCount(0);
    await page
      .getByRole("searchbox", { name: "Buscar producto" })
      .fill("espresso");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: /^Agregar · \$30\.00$/ }).click();
    const original = await readDraft(page);
    expect(original.actorId).toBeTruthy();
    expect(original.items[0].unit).toBe(30);
    await page.getByRole("button", { name: /^Salir de la estación/ }).click();
    await login(page, "CASHIER");
    await expect(
      page.getByRole("button", { name: "Cobrar $30.00" }),
    ).toBeVisible();
    expect((await readDraft(page)).actorId).toBe(original.actorId);
    await page.getByRole("button", { name: "Aumentar Espresso" }).click();
    const changed = await readDraft(page);
    expect(changed.actorId).toBe(original.actorId);
    expect(changed.lastModifiedActorId === original.actorId).toBe(false);
    expect(changed.items[0].qty).toBe(2);
    await page
      .getByRole("button", { name: "Cancelar orden", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Acción no permitida" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Entendido", exact: true }).click();
    expect((await readDraft(page)).items[0].qty).toBe(2);
    await page.getByRole("button", { name: /^Salir de la estación/ }).click();
    await login(page, "WAITER");
    await page.getByRole("button", { name: "Cobrar $60.00" }).click();
    await expect(
      page.getByRole("heading", { name: "Acción no permitida" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Entendido", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Usuarios y configuración",
        exact: true,
      }),
    ).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("button", { name: /^Salir de la estación/ }).click();
    await expect(page.getByLabel("PIN offline", { exact: true })).toHaveCount(
      0,
    );
    await context.setOffline(true);
    await expect(page.getByLabel("PIN offline", { exact: true })).toBeVisible();
    await page
      .getByLabel("Persona", { exact: true })
      .selectOption(original.actorId);
    await page.getByLabel("PIN offline", { exact: true }).fill("246810");
    await page.getByRole("button", { name: "Desbloquear identidad" }).click();
    await expect(
      page.getByRole("button", { name: "Cobrar $60.00" }),
    ).toBeVisible();
    const offlineDraft = await readDraft(page);
    expect(offlineDraft.items).toEqual(changed.items);
    const revoked = await admin
      .from("register_devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("device_id", env.SUPABASE_CASH_DEVICE_ID);
    expect(revoked.error).toBeNull();
    await context.setOffline(false);
    await expect(
      page.getByRole("heading", { name: "Acceso individual verificado" }),
    ).toBeVisible();
    await page
      .getByLabel("Correo de la cuenta Supabase")
      .fill(env.SUPABASE_OWNER_EMAIL);
    await page
      .getByLabel("Contraseña", { exact: true })
      .fill(env.SUPABASE_OWNER_PASSWORD);
    await page
      .getByRole("button", { name: "Iniciar sesión con Supabase" })
      .click();
    await expect(
      page.getByRole("searchbox", { name: "Buscar producto" }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate((key) => {
          const grants = JSON.parse(localStorage.getItem(key) || "[]");
          return grants.length;
        }, rosterKey),
      )
      .toBe(0);
    expect((await readDraft(page)).items).toEqual(changed.items);
  } finally {
    await context.setOffline(false);
    const reset = await admin
      .from("register_devices")
      .update({ revoked_at: null })
      .eq("device_id", env.SUPABASE_CASH_DEVICE_ID);
    expect(reset.error).toBeNull();
  }
});
