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
const runHostedV118Proof = env.SUPABASE_V118_TESTS_ENABLED === "1";
const anon = () =>
  createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function appendAs({
  email,
  password,
  deviceId,
  type,
  payload = {},
  includeType = true,
}) {
  const client = anon();
  const signedIn = await client.auth.signInWithPassword({ email, password });
  expect(signedIn.error).toBeNull();
  const actorId = signedIn.data.user.id;
  const bound = await client.rpc("bind_register_session", {
    p_branch_id: env.SUPABASE_BRANCH_ID,
    p_device_id: deviceId,
  });
  expect(bound.error).toBeNull();
  const session = Array.isArray(bound.data) ? bound.data[0] : bound.data;
  expect(session?.session_id).toBeTruthy();

  const commandId = `evl118-${randomUUID()}`;
  const aggregateId = `evl118-order-${randomUUID()}`;
  const occurredAt = new Date().toISOString();
  const event = {
    eventId: `${commandId}:0`,
    commandId,
    aggregateId,
    ...(includeType ? { type } : {}),
    schemaVersion: 1,
    actorId,
    deviceId,
    occurredAt,
    payload,
  };
  return client.rpc("append_command_batch", {
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
}

test.describe("EVL-118 hosted role and event-envelope checks", () => {
  test.skip(
    !runHostedV118Proof,
    "Enable only after root review and apply of the EVL-118 migration; never run against the earlier schema.",
  );

  test("rejects missing, null, numeric, and unsupported event types before write", async () => {
    const owner = {
      email: env.SUPABASE_OWNER_EMAIL,
      password: env.SUPABASE_OWNER_PASSWORD,
      deviceId: env.SUPABASE_CASH_DEVICE_ID,
    };
    for (const variant of [
      { includeType: false },
      { type: null },
      { type: 17 },
      { type: "UnknownEvent" },
    ]) {
      const result = await appendAs({ ...owner, ...variant });
      expect(result.error?.code).toBe("22023");
    }
  });

  test("requires a bounded cancellation reason and restricts preparation cancellation", async () => {
    const owner = {
      email: env.SUPABASE_OWNER_EMAIL,
      password: env.SUPABASE_OWNER_PASSWORD,
      deviceId: env.SUPABASE_PREP_DEVICE_ID,
    };
    const missingReason = await appendAs({
      ...owner,
      type: "PreparationCancelled",
      payload: {},
    });
    expect(missingReason.error?.code).toBe("22023");

    const overlongReason = await appendAs({
      ...owner,
      type: "PreparationCancelled",
      payload: { reason: "r".repeat(251) },
    });
    expect(overlongReason.error?.code).toBe("22023");

    const waiterDenied = await appendAs({
      email: env.SUPABASE_WAITER_EMAIL,
      password: env.SUPABASE_WAITER_PASSWORD,
      deviceId: env.SUPABASE_PREP_DEVICE_ID,
      type: "PreparationCancelled",
      payload: { reason: "Corrección autorizada" },
    });
    expect(waiterDenied.error?.code).toBe("42501");

    const ownerAllowed = await appendAs({
      ...owner,
      type: "PreparationCancelled",
      payload: { reason: "Corrección autorizada" },
    });
    expect(ownerAllowed.error).toBeNull();
  });

  test("blocks all authenticated direct inserts even when the role can perform the action", async () => {
    const client = anon();
    const signedIn = await client.auth.signInWithPassword({
      email: env.SUPABASE_OWNER_EMAIL,
      password: env.SUPABASE_OWNER_PASSWORD,
    });
    expect(signedIn.error).toBeNull();
    const commandId = `evl118-direct-${randomUUID()}`;
    const result = await client.from("command_batches").insert({
      command_id: commandId,
      branch_id: env.SUPABASE_BRANCH_ID,
      aggregate_id: `evl118-direct-order-${randomUUID()}`,
      actor_id: signedIn.data.user.id,
      device_id: env.SUPABASE_CASH_DEVICE_ID,
      lease_id: env.SUPABASE_LEASE_ID,
      schema_version: 1,
      occurred_at: new Date().toISOString(),
      events: [],
    });
    expect(result.error?.code).toBe("42501");
  });
});
