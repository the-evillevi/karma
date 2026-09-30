import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

function readLocalEnv() {
  const values = {};
  if (!existsSync(".env.offline-test.local")) return values;
  for (const line of readFileSync(".env.offline-test.local", "utf8").split(
    /\r?\n/,
  )) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

const env = readLocalEnv();
const admin = env.SUPABASE_URL
  ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;
const anon = () =>
  createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

test.beforeEach(() =>
  test.skip(
    !env.SUPABASE_URL,
    "Run the approved local/cloud fixture setup to create private test credentials.",
  ),
);

async function signIn(page) {
  await page.goto(`?db=evl114-${randomUUID()}`);
  await page.getByLabel("Correo").fill(env.SUPABASE_CASHIER_EMAIL);
  await page.getByLabel(/Contraseña/).fill(env.SUPABASE_CASHIER_PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  const enrollPin = page.getByRole("button", {
    name: "Guardar PIN y abrir estación",
  });
  if (await enrollPin.count()) {
    await page.getByLabel("Crear PIN offline").fill("246810");
    await page.getByLabel("Confirmar PIN offline").fill("246810");
    await enrollPin.click();
  } else {
    const unlockPin = page.getByRole("button", { name: "Desbloquear con PIN" });
    if (await unlockPin.count()) {
      await page.getByLabel("PIN offline").fill("246810");
      await unlockPin.click();
    }
  }
  await expect(
    page.getByRole("button", { name: "Crear venta capturada" }),
  ).toBeEnabled();
}

async function insertBatch(
  client,
  {
    userId,
    deviceId,
    leaseId = env.SUPABASE_LEASE_ID,
    type = "OrderOpened",
    payload = {},
    eventSchemaVersion = 1,
    eventActorId = userId,
    includeType = true,
    commandId = `test-${randomUUID()}`,
    aggregateId = `test-order-${randomUUID()}`,
    occurredAt = new Date().toISOString(),
  },
) {
  const event = {
    eventId: `${commandId}:0`,
    commandId,
    aggregateId,
    ...(includeType ? { type } : {}),
    schemaVersion: eventSchemaVersion,
    actorId: eventActorId,
    deviceId,
    occurredAt,
    payload,
  };
  if (env.SUPABASE_V118_TESTS_ENABLED === "1") {
    const bound = await client.rpc("bind_register_session", {
      p_branch_id: env.SUPABASE_BRANCH_ID,
      p_device_id: deviceId,
    });
    if (bound.error) return { data: null, error: bound.error };
    const session = Array.isArray(bound.data) ? bound.data[0] : bound.data;
    const result = await client.rpc("append_command_batch", {
      p_command_id: commandId,
      p_branch_id: env.SUPABASE_BRANCH_ID,
      p_aggregate_id: aggregateId,
      p_device_id: deviceId,
      p_session_id: session.session_id,
      p_lease_id: session.lease_id,
      p_schema_version: 1,
      p_occurred_at: occurredAt,
      p_events: [event],
    });
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return { data: row, error: result.error };
  }
  return client
    .from("command_batches")
    .insert({
      command_id: commandId,
      branch_id: env.SUPABASE_BRANCH_ID,
      aggregate_id: aggregateId,
      actor_id: userId,
      device_id: deviceId,
      lease_id: leaseId,
      schema_version: 1,
      occurred_at: occurredAt,
      events: [event],
    })
    .select("command_id")
    .maybeSingle();
}

async function readRenderedCommandId(page) {
  const commandId = (await page.getByTestId("order-row").innerText()).match(
    /Comando ([^\s]+)/,
  )?.[1];
  expect(commandId).toBeTruthy();
  return commandId;
}

test.afterEach(async () => {
  if (!admin || !env.SUPABASE_CASH_DEVICE_ID) return;
  const reset = await admin
    .from("register_devices")
    .update({ revoked_at: null })
    .eq("device_id", env.SUPABASE_CASH_DEVICE_ID);
  expect(reset.error).toBeNull();
});

test("Vite denies HTTP access to private test credentials", async ({
  request,
}) => {
  const response = await request.get(
    `/@fs${process.cwd()}/.env.offline-test.local`,
  );
  expect(response.status()).toBe(403);
  const responseBody = await response.text();
  expect(responseBody.includes("SUPABASE_SERVICE_ROLE_KEY")).toBe(false);
  expect(responseBody.includes("SUPABASE_CASHIER_PASSWORD")).toBe(false);
});

test("local write failure does not create a pending batch", async ({
  page,
}) => {
  await signIn(page);
  await page.getByText("Pruebas de fallo de este prototipo").click();
  await page
    .getByRole("button", { name: "Probar fallo al guardar localmente" })
    .click();
  await expect(page.getByTestId("sync-message")).toContainText(
    "La escritura local falló",
  );
  await expect(page.getByTestId("pending-count")).toHaveText("0 pendientes");
});

test("offline capture reconnects once and survives reload with app assets available", async ({
  page,
  context,
}) => {
  await signIn(page);
  await context.setOffline(true);
  await page.waitForFunction(() => !navigator.onLine);
  await page.getByRole("button", { name: "Crear venta capturada" }).click();
  await expect(page.getByTestId("pending-count")).toHaveText("1 pendientes");
  const commandId = await readRenderedCommandId(page);
  // The app shell is available for this reload. Offline cold boot awaits EVL-116's PWA cache.
  await context.setOffline(false);
  await expect(page.getByTestId("order-sync-status")).toHaveText(
    "Confirmada en Supabase",
  );
  await page.reload();
  await expect(page.getByTestId("order-sync-status")).toHaveText(
    "Confirmada en Supabase",
  );
  const { count, error } = await admin
    .from("command_batches")
    .select("command_id", { count: "exact", head: true })
    .eq("command_id", commandId);
  expect(error).toBeNull();
  expect(count).toBe(1);
});

test("an interrupted local receipt retries the same command without a duplicate", async ({
  page,
  context,
}) => {
  await signIn(page);
  await context.setOffline(true);
  await page.waitForFunction(() => !navigator.onLine);
  await page.getByRole("button", { name: "Crear venta capturada" }).click();
  await expect(page.getByTestId("pending-count")).toHaveText("1 pendientes");
  const commandId = await readRenderedCommandId(page);
  await page.getByText("Pruebas de fallo de este prototipo").click();
  await page
    .getByRole("button", { name: "Simular interrupción del recibo local" })
    .click();
  await context.setOffline(false);
  await expect(page.getByTestId("sync-message")).toContainText(
    "sigue pendiente",
  );
  const committed = await admin
    .from("command_batches")
    .select("command_id", { count: "exact", head: true })
    .eq("command_id", commandId);
  expect(committed.error).toBeNull();
  expect(committed.count).toBe(1);
  await page.getByRole("button", { name: "Sincronizar pendientes" }).click();
  await expect(page.getByTestId("order-sync-status")).toHaveText(
    "Confirmada en Supabase",
  );
  const { count, error } = await admin
    .from("command_batches")
    .select("command_id", { count: "exact", head: true })
    .eq("command_id", commandId);
  expect(error).toBeNull();
  expect(count).toBe(1);
});

test("one simulated receipt interruption affects only one of multiple pending batches", async ({
  page,
  context,
}) => {
  await signIn(page);
  await context.setOffline(true);
  await page.waitForFunction(() => !navigator.onLine);
  await page.getByRole("button", { name: "Crear venta capturada" }).click();
  await page.getByRole("button", { name: "Crear venta capturada" }).click();
  await expect(page.getByTestId("pending-count")).toHaveText("2 pendientes");
  await page.getByText("Pruebas de fallo de este prototipo").click();
  await page
    .getByRole("button", { name: "Simular interrupción del recibo local" })
    .click();
  await context.setOffline(false);
  await expect(page.getByTestId("pending-count")).toHaveText("1 pendientes");
  await page.getByRole("button", { name: "Sincronizar pendientes" }).click();
  await expect(page.getByTestId("pending-count")).toHaveText("0 pendientes");
  await expect(page.getByTestId("order-sync-status")).toHaveCount(2);
  await expect(page.getByTestId("order-sync-status").nth(0)).toHaveText(
    "Confirmada en Supabase",
  );
  await expect(page.getByTestId("order-sync-status").nth(1)).toHaveText(
    "Confirmada en Supabase",
  );
});

test("a known revoked device loses cached online authorization", async ({
  page,
}) => {
  await signIn(page);
  const revokedAt = new Date().toISOString();
  const update = await admin
    .from("register_devices")
    .update({ revoked_at: revokedAt })
    .eq("device_id", env.SUPABASE_CASH_DEVICE_ID);
  expect(update.error).toBeNull();
  await page
    .getByRole("button", { name: "Volver a verificar permiso" })
    .click();
  await expect(page.getByTestId("sync-message")).toHaveText(
    "El servidor rechazó esta autorización. Actualiza los permisos antes de continuar.",
  );
  expect(
    await page.evaluate(() =>
      localStorage.getItem("karma-evl114-offline-context"),
    ),
  ).toBeNull();
  await expect(
    page.getByRole("button", { name: "Crear venta capturada" }),
  ).toBeDisabled();
});

test("RLS allows valid cash and preparation writes but rejects forged, mutable, and malformed commands", async () => {
  const cashierClient = anon();
  const cashierLogin = await cashierClient.auth.signInWithPassword({
    email: env.SUPABASE_CASHIER_EMAIL,
    password: env.SUPABASE_CASHIER_PASSWORD,
  });
  expect(cashierLogin.error).toBeNull();
  const cashierUserId = cashierLogin.data.user.id;
  const validCash = await insertBatch(cashierClient, {
    userId: cashierUserId,
    deviceId: env.SUPABASE_CASH_DEVICE_ID,
    type: "OrderOpened",
  });
  expect(validCash.error).toBeNull();
  expect(validCash.data.command_id).toBeTruthy();

  const commandUpdate = await cashierClient
    .from("command_batches")
    .update({ aggregate_id: "changed" })
    .eq("command_id", validCash.data.command_id);
  expect(commandUpdate.error?.code).toBe("42501");
  const commandDelete = await cashierClient
    .from("command_batches")
    .delete()
    .eq("command_id", validCash.data.command_id);
  expect(commandDelete.error?.code).toBe("42501");

  const cashWrite = await insertBatch(cashierClient, {
    userId: cashierUserId,
    deviceId: env.SUPABASE_CASH_DEVICE_ID,
    type: "PreparationStarted",
  });
  expect(cashWrite.error?.code).toBe("42501");

  const waiterClient = anon();
  const waiterLogin = await waiterClient.auth.signInWithPassword({
    email: env.SUPABASE_WAITER_EMAIL,
    password: env.SUPABASE_WAITER_PASSWORD,
  });
  expect(waiterLogin.error).toBeNull();
  const waiterId = waiterLogin.data.user.id;
  const validPrep = await insertBatch(waiterClient, {
    userId: waiterId,
    deviceId: env.SUPABASE_PREP_DEVICE_ID,
    type: "PreparationStarted",
  });
  expect(validPrep.error).toBeNull();
  expect(validPrep.data.command_id).toBeTruthy();
  const cashierEvent = await insertBatch(waiterClient, {
    userId: waiterId,
    deviceId: env.SUPABASE_PREP_DEVICE_ID,
    type: "OrderOpened",
  });
  expect(cashierEvent.error?.code).toBe("42501");
  const unknown = await insertBatch(waiterClient, {
    userId: waiterId,
    deviceId: env.SUPABASE_PREP_DEVICE_ID,
    type: "MysteryEvent",
  });
  expect(unknown.error?.code).toBe("22023");
  const nullPayload = await insertBatch(waiterClient, {
    userId: waiterId,
    deviceId: env.SUPABASE_PREP_DEVICE_ID,
    type: "PreparationStarted",
    payload: null,
  });
  expect(nullPayload.error?.code).toBe("22023");
  const stringSchemaVersion = await insertBatch(waiterClient, {
    userId: waiterId,
    deviceId: env.SUPABASE_PREP_DEVICE_ID,
    type: "PreparationStarted",
    eventSchemaVersion: "1",
  });
  expect(stringSchemaVersion.error?.code).toBe("22023");
  const forgedActor = await insertBatch(cashierClient, {
    userId: waiterId,
    deviceId: env.SUPABASE_CASH_DEVICE_ID,
    type: "OrderOpened",
  });
  expect(forgedActor.error?.code).toBe("42501");
  const forgedDevice = await insertBatch(cashierClient, {
    userId: cashierUserId,
    deviceId: env.SUPABASE_PREP_DEVICE_ID,
    type: "OrderOpened",
  });
  expect(forgedDevice.error?.code).toBe("42501");

  const anonymous = anon();
  const anonymousWrite = await insertBatch(anonymous, {
    userId: waiterId,
    deviceId: env.SUPABASE_PREP_DEVICE_ID,
    type: "PreparationReady",
  });
  expect(anonymousWrite.error?.code).toBe("42501");
});

test("an altered retry with a command ID already stored is held for manual review", async ({
  page,
}) => {
  const testKey = randomUUID();
  await page.goto(`?db=alter-test-${testKey}`);
  const outcome = await page.evaluate(
    async ({ testKey, email, password, branchId, deviceId, leaseId }) => {
      const moduleUrl = (path) => new URL(path, window.location.href).href;
      const { openOfflineDatabase } = await import(
        moduleUrl("/src/offline-sync/database.js")
      );
      const {
        captureCommandBatch,
        createDemoOrderBatch,
        createSupabaseClient,
        syncPendingCommandBatches,
      } = await import(moduleUrl("/src/offline-sync/command-sync.js"));
      const client = await createSupabaseClient();
      const signedIn = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (signedIn.error) throw signedIn.error;
      const dbOriginal = await openOfflineDatabase(`alter-original-${testKey}`);
      const original = createDemoOrderBatch({
        branchId,
        actorId: signedIn.data.user.id,
        deviceId,
        leaseId,
        commandId: `alter-${testKey}`,
        occurredAt: "2026-09-29T10:00:00-06:00",
      });
      await captureCommandBatch(dbOriginal, original);
      const first = await syncPendingCommandBatches(dbOriginal, client);
      const dbChanged = await openOfflineDatabase(`alter-changed-${testKey}`);
      const changed = structuredClone(original);
      changed.events[0].payload.lines[0].unitPriceCents += 1;
      await captureCommandBatch(dbChanged, changed);
      const conflict = await syncPendingCommandBatches(dbChanged, client);
      const blockedRetry = await syncPendingCommandBatches(dbChanged, client);
      return {
        first: first[0],
        conflict: conflict[0],
        blockedRetry: blockedRetry[0],
      };
    },
    {
      testKey,
      email: env.SUPABASE_CASHIER_EMAIL,
      password: env.SUPABASE_CASHIER_PASSWORD,
      branchId: env.SUPABASE_BRANCH_ID,
      deviceId: env.SUPABASE_CASH_DEVICE_ID,
      leaseId: env.SUPABASE_LEASE_ID,
    },
  );
  expect(outcome.first.state).toBe("acknowledged");
  expect(outcome.conflict).toMatchObject({
    state: "blocked",
    code: "COMMAND_CONFLICT",
  });
  expect(outcome.blockedRetry).toMatchObject({
    state: "blocked",
    code: "COMMAND_CONFLICT",
  });
  const { count, error } = await admin
    .from("command_batches")
    .select("command_id", { count: "exact", head: true })
    .eq("command_id", `alter-${testKey}`);
  expect(error).toBeNull();
  expect(count).toBe(1);
});
