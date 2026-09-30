import { randomUUID } from "node:crypto";
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
const client = (key) =>
  createClient(env.SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

// No trace or credential output: the one-time password is used only in memory.
test("hosted owner provisioning verifies authority, creates without email, denies inactive access and cleans the synthetic identity", async () => {
  test.skip(
    !enabled,
    "Requires isolated EVL-118 fixtures and the reviewed function deployment.",
  );
  expect(new URL(env.SUPABASE_URL).hostname).toBe(
    "vwvlsayxsunefeehiavt.supabase.co",
  );
  const owner = client(env.SUPABASE_ANON_KEY);
  const service = client(env.SUPABASE_SERVICE_ROLE_KEY);
  const signIn = await owner.auth.signInWithPassword({
    email: env.SUPABASE_OWNER_EMAIL,
    password: env.SUPABASE_OWNER_PASSWORD,
  });
  expect(Boolean(signIn.error)).toBe(false);
  const ownerToken = signIn.data.session.access_token;
  const email = `evl118-provision-${randomUUID()}@example.invalid`;
  const input = {
    branchId: env.SUPABASE_BRANCH_ID,
    email,
    displayName: "Mesero sintético de aprovisionamiento",
    role: "mesero",
    active: true,
  };
  async function invoke(token, body = input, origin = "http://127.0.0.1:4179") {
    return fetch(`${env.SUPABASE_URL}/functions/v1/owner-provision-user`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
        Origin: origin,
      },
      body: JSON.stringify(body),
    });
  }
  expect((await invoke(null)).status).toBe(401);
  expect((await invoke("invalid-test-token")).status).toBe(401);
  expect(
    (await invoke(ownerToken, input, "https://unapproved.example.invalid"))
      .status,
  ).toBe(403);
  expect(
    (await invoke(ownerToken, { ...input, branchId: `other-${randomUUID()}` }))
      .status,
  ).toBe(403);
  expect(
    (await invoke(ownerToken, { ...input, role: "administrator" })).status,
  ).toBe(400);
  let createdId;
  try {
    const response = await invoke(ownerToken);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const created = await response.json();
    createdId = typeof created.userId === "string" ? created.userId : null;
    expect(Boolean(createdId)).toBe(true);
    expect(
      typeof created.temporaryPassword === "string" &&
        created.temporaryPassword.length >= 24,
    ).toBe(true);
    const membership = await service
      .from("branch_memberships")
      .select("role,active")
      .eq("branch_id", env.SUPABASE_BRANCH_ID)
      .eq("user_id", createdId)
      .single();
    expect(Boolean(membership.error)).toBe(false);
    expect(membership.data).toEqual({ role: "mesero", active: true });
    const member = client(env.SUPABASE_ANON_KEY);
    const signedMember = await member.auth.signInWithPassword({
      email,
      password: created.temporaryPassword,
    });
    expect(Boolean(signedMember.error)).toBe(false);
    const bound = await member.rpc("bind_register_session", {
      p_branch_id: env.SUPABASE_BRANCH_ID,
      p_device_id: env.SUPABASE_CASH_DEVICE_ID,
    });
    expect(Boolean(bound.error)).toBe(false);
    expect(
      (
        await invoke(signedMember.data.session.access_token, {
          ...input,
          email: `denied-${email}`,
        })
      ).status,
    ).toBe(403);
    const inactive = await owner.rpc("manage_branch_membership", {
      p_branch_id: env.SUPABASE_BRANCH_ID,
      p_user_id: createdId,
      p_display_name: input.displayName,
      p_role: "mesero",
      p_active: false,
    });
    expect(Boolean(inactive.error)).toBe(false);
    const deniedBind = await member.rpc("bind_register_session", {
      p_branch_id: env.SUPABASE_BRANCH_ID,
      p_device_id: env.SUPABASE_CASH_DEVICE_ID,
    });
    expect(deniedBind.error?.code).toBe("42501");
    expect(
      (
        await invoke(signedMember.data.session.access_token, {
          ...input,
          email: `inactive-${email}`,
        })
      ).status,
    ).toBe(403);
  } finally {
    if (createdId) {
      const sessions = await service
        .from("register_device_sessions")
        .delete()
        .eq("branch_id", env.SUPABASE_BRANCH_ID)
        .eq("actor_id", createdId);
      expect(Boolean(sessions.error)).toBe(false);
      const removal = await service
        .from("branch_memberships")
        .delete()
        .eq("branch_id", env.SUPABASE_BRANCH_ID)
        .eq("user_id", createdId);
      expect(Boolean(removal.error)).toBe(false);
      const deleted = await service.auth.admin.deleteUser(createdId);
      expect(Boolean(deleted.error)).toBe(false);
    }
    await owner.auth.signOut();
  }
});
