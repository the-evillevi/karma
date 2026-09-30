import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

function readLocalEnv() {
  const values = {};
  if (!existsSync(".offline-test.local")) return values;
  for (const line of readFileSync(".offline-test.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

const env = readLocalEnv();
const admin = env.SUPABASE_URL ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const anon = () => createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

test.beforeEach(() => test.skip(!env.SUPABASE_URL, "Run pnpm offline:local:up to create private local test credentials."));

async function signIn(page) {
  await page.goto(`offline-demo.html?db=evl114-${randomUUID()}`);
  await page.getByLabel("Correo").fill(env.SUPABASE_CASHIER_EMAIL);
  await page.getByLabel("Contraseña local de prueba").fill(env.SUPABASE_CASHIER_PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByRole("button", { name: "Crear venta capturada" })).toBeEnabled();
}

async function insertBatch(client, { userId, deviceId, leaseId = "karma-demo-lease-01", type = "OrderOpened", payload = {}, eventSchemaVersion = 1 }) {
  const commandId = `test-${randomUUID()}`;
  const aggregateId = `test-order-${randomUUID()}`;
  const occurredAt = new Date().toISOString();
  const event = {
    eventId: `${commandId}:0`, commandId, aggregateId, type,
    schemaVersion: eventSchemaVersion, actorId: userId, deviceId, occurredAt, payload,
  };
  return client.from("command_batches").insert({
    command_id: commandId,
    branch_id: env.SUPABASE_BRANCH_ID,
    aggregate_id: aggregateId,
    actor_id: userId,
    device_id: deviceId,
    lease_id: leaseId,
    schema_version: 1,
    occurred_at: occurredAt,
    events: [event],
  }).select("command_id").maybeSingle();
}

test("local write failure does not create a pending batch", async ({ page }) => {
  await signIn(page);
  await page.getByText("Pruebas de fallo de este prototipo").click();
  await page.getByRole("button", { name: "Probar fallo al guardar localmente" }).click();
  await expect(page.getByTestId("sync-message")).toContainText("La escritura local falló");
  await expect(page.getByTestId("pending-count")).toHaveText("0 pendientes");
});

test("offline capture survives reload and an interrupted remote receipt retries exactly once", async ({ page, context }) => {
  await signIn(page);
  await context.setOffline(true);
  await page.waitForFunction(() => !navigator.onLine);
  await page.getByRole("button", { name: "Crear venta capturada" }).click();
  await expect(page.getByTestId("pending-count")).toHaveText("1 pendientes");
  await page.reload();
  await expect(page.getByTestId("pending-count")).toHaveText("1 pendientes");
  await expect(page.getByTestId("order-sync-status")).toHaveText("Pendiente");
  await expect(page.getByRole("button", { name: "Crear venta capturada" })).toBeEnabled();

  await page.getByText("Pruebas de fallo de este prototipo").click();
  await page.getByRole("button", { name: "Simular interrupción del recibo local" }).click();
  await context.setOffline(false);
  await page.waitForFunction(() => navigator.onLine);
  await page.getByRole("button", { name: "Sincronizar pendientes" }).click();
  await expect(page.getByTestId("sync-message")).toContainText("sigue pendiente");
  await expect(page.getByTestId("pending-count")).toHaveText("1 pendientes");
  const firstCount = await page.getByTestId("order-row").count();
  expect(firstCount).toBe(1);
  const commandId = (await page.getByTestId("order-row").innerText()).match(/Comando ([^\s]+)/)?.[1];
  expect(commandId).toBeTruthy();

  await page.getByRole("button", { name: "Sincronizar pendientes" }).click();
  await expect(page.getByTestId("order-sync-status")).toHaveText("Confirmada en Supabase");
  const { count, error } = await admin.from("command_batches").select("command_id", { count: "exact", head: true }).eq("command_id", commandId);
  expect(error).toBeNull();
  expect(count).toBe(1);
});

test("one simulated receipt interruption affects only one of multiple pending batches", async ({ page, context }) => {
  await signIn(page);
  await context.setOffline(true);
  await page.waitForFunction(() => !navigator.onLine);
  await page.getByRole("button", { name: "Crear venta capturada" }).click();
  await page.getByRole("button", { name: "Crear venta capturada" }).click();
  await expect(page.getByTestId("pending-count")).toHaveText("2 pendientes");
  await page.getByText("Pruebas de fallo de este prototipo").click();
  await page.getByRole("button", { name: "Simular interrupción del recibo local" }).click();
  await context.setOffline(false);
  await page.waitForFunction(() => navigator.onLine);
  await page.getByRole("button", { name: "Sincronizar pendientes" }).click();
  await expect(page.getByTestId("pending-count")).toHaveText("1 pendientes");
  await page.getByRole("button", { name: "Sincronizar pendientes" }).click();
  await expect(page.getByTestId("pending-count")).toHaveText("0 pendientes");
  await expect(page.getByTestId("order-sync-status")).toHaveCount(2);
  await expect(page.getByTestId("order-sync-status").nth(0)).toHaveText("Confirmada en Supabase");
  await expect(page.getByTestId("order-sync-status").nth(1)).toHaveText("Confirmada en Supabase");
});

test("a known revoked device loses cached online authorization", async ({ page }) => {
  await signIn(page);
  const revokedAt = new Date().toISOString();
  const update = await admin.from("register_devices").update({ revoked_at: revokedAt }).eq("device_id", env.SUPABASE_CASH_DEVICE_ID);
  expect(update.error).toBeNull();
  await page.getByRole("button", { name: "Volver a verificar permiso" }).click();
  await expect(page.getByTestId("sync-message")).toContainText("no tiene una autorización");
  await expect(page.getByRole("button", { name: "Crear venta capturada" })).toBeDisabled();
});

test("RLS and the trigger reject anon, preparation-to-cash, unknown events, and non-object payloads", async () => {
  const cashierClient = anon();
  const cashierLogin = await cashierClient.auth.signInWithPassword({ email: env.SUPABASE_CASHIER_EMAIL, password: env.SUPABASE_CASHIER_PASSWORD });
  expect(cashierLogin.error).toBeNull();
  const cashierUserId = cashierLogin.data.user.id;
  const cashWrite = await insertBatch(cashierClient, { userId: cashierUserId, deviceId: env.SUPABASE_CASH_DEVICE_ID, type: "PreparationStarted" });
  expect(cashWrite.error?.code).toBe("42501");

  const waiterClient = anon();
  const waiterLogin = await waiterClient.auth.signInWithPassword({ email: env.SUPABASE_WAITER_EMAIL, password: env.SUPABASE_WAITER_PASSWORD });
  expect(waiterLogin.error).toBeNull();
  const waiterId = waiterLogin.data.user.id;
  const cashierEvent = await insertBatch(waiterClient, { userId: waiterId, deviceId: env.SUPABASE_PREP_DEVICE_ID, type: "OrderOpened" });
  expect(cashierEvent.error?.code).toBe("42501");
  const unknown = await insertBatch(waiterClient, { userId: waiterId, deviceId: env.SUPABASE_PREP_DEVICE_ID, type: "MysteryEvent" });
  expect(unknown.error?.code).toBe("22023");
  const nullPayload = await insertBatch(waiterClient, { userId: waiterId, deviceId: env.SUPABASE_PREP_DEVICE_ID, type: "PreparationStarted", payload: null });
  expect(nullPayload.error?.code).toBe("22023");
  const stringSchemaVersion = await insertBatch(waiterClient, { userId: waiterId, deviceId: env.SUPABASE_PREP_DEVICE_ID, type: "PreparationStarted", eventSchemaVersion: "1" });
  expect(stringSchemaVersion.error?.code).toBe("22023");

  const anonymous = anon();
  const anonymousWrite = await insertBatch(anonymous, { userId: waiterId, deviceId: env.SUPABASE_PREP_DEVICE_ID, type: "PreparationReady" });
  expect(anonymousWrite.error).not.toBeNull();
});
