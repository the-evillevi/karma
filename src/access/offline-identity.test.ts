import test from "node:test";
import assert from "node:assert/strict";
import {
  createOfflineIdentityGrant,
  parseVerifiedAccessContext,
  unlockOfflineIdentity,
  type VerifiedAccessContext,
} from "./offline-identity.ts";
import { bindRegisterSession } from "./register-session.ts";

const context: VerifiedAccessContext = {
  userId: "auth-user-1",
  displayName: "Caja",
  role: "barra",
  branchId: "branch-1",
  deviceId: "device-1",
  sessionId: "session-1",
  capability: "cash_register",
  leaseId: "lease-1",
  expiresAt: "2026-10-01T00:00:00.000Z",
  verifiedAt: "2026-09-29T12:00:00.000Z",
};

test("offline PIN grants store a salted verifier and throttle repeated failures", async () => {
  const grant = await createOfflineIdentityGrant(context, "246810");
  assert.notEqual(grant.pinVerifier, "246810");
  assert.notEqual(grant.salt, "");
  assert.equal(grant.pinIterations, 210_000);
  const differentSalt = await createOfflineIdentityGrant(context, "246810");
  assert.notEqual(differentSalt.salt, grant.salt);
  assert.notEqual(differentSalt.pinVerifier, grant.pinVerifier);

  const unlocked = await unlockOfflineIdentity(grant, "246810", 1_000);
  assert.equal(unlocked.ok, true);
  if (!unlocked.ok) return;
  let current = unlocked.grant;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await unlockOfflineIdentity(
      current,
      "000000",
      2_000 + attempt,
    );
    current = result.grant;
  }
  assert.equal(current.failedPinAttempts, 0);
  assert.equal(current.lockoutCount, 1);
  assert.equal(current.lockedUntil, 302_004);

  const locked = await unlockOfflineIdentity(current, "246810", 10_000);
  assert.equal(locked.ok, false);
  if (locked.ok) return;
  assert.equal(locked.reason, "locked");
  let wrongAfterExpiry = await unlockOfflineIdentity(
    current,
    "000000",
    current.lockedUntil! + 1,
  );
  for (let attempt = 1; attempt < 5; attempt += 1)
    wrongAfterExpiry = await unlockOfflineIdentity(
      wrongAfterExpiry.grant,
      "000000",
      current.lockedUntil! + 1 + attempt,
    );
  assert.equal(wrongAfterExpiry.ok, false);
  assert.equal(wrongAfterExpiry.grant.lockoutCount, 2);
  assert.equal(
    wrongAfterExpiry.grant.lockedUntil,
    current.lockedUntil! + 5 + 600_000,
  );
});

test("offline PIN setup rejects short PINs and access contexts reject unknown roles", async () => {
  await assert.rejects(
    createOfflineIdentityGrant(context, "1234"),
    /six to eight digits/,
  );
  assert.throws(
    () => parseVerifiedAccessContext({ ...context, role: "owner" }),
    /unknown role/,
  );
});

test("server binding rejects actor mismatch and sanitizes server authorization errors", async () => {
  const row = {
    session_id: "session-1",
    branch_id: "branch-1",
    device_id: "device-1",
    actor_id: "different-user",
    display_name: "Caja",
    role: "barra",
    capability: "cash_register",
    lease_id: "lease-1",
    expires_at: "2026-10-01T00:00:00.000Z",
  };
  const mismatched = await bindRegisterSession(
    { rpc: async () => ({ data: [row], error: null }) },
    {
      authUserId: context.userId,
      branchId: context.branchId,
      deviceId: context.deviceId,
    },
  ).catch((error: Error & { code?: string }) => error);
  assert.equal(
    (mismatched as Error & { code?: string }).code,
    "AUTHORIZATION_UNAVAILABLE",
  );
  assert.match((mismatched as Error).message, /incompleta o vencida/);

  const denied = await bindRegisterSession(
    { rpc: async () => ({ data: null, error: { code: "42501" } }) },
    {
      authUserId: context.userId,
      branchId: context.branchId,
      deviceId: context.deviceId,
    },
  ).catch((error: Error & { code?: string }) => error);
  assert.equal(
    (denied as Error & { code?: string }).code,
    "AUTHORIZATION_UNAVAILABLE",
  );
  assert.match((denied as Error).message, /no confirmó una autorización/);
  assert.doesNotMatch((denied as Error).message, /42501/);
});
