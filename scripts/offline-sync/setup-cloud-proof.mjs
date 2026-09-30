import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const ref = "vwvlsayxsunefeehiavt";
const keysPath = "/Users/evillevi/.codex/karma-secrets/karma-pos-api-keys.json";
const secretsPath = ".env.offline-test.local";
const publicEnvPath = ".env.local";
const suffix = randomBytes(9).toString("hex");
const branchId = `evl114-proof-${suffix}`;
const cashDeviceId = `evl114-cash-${suffix}`;
const prepDeviceId = `evl114-prep-${suffix}`;
const leaseId = `evl114-lease-${suffix}`;
const supabaseUrl = `https://${ref}.supabase.co`;
const [keys, privateProject] = await Promise.all([
  readFile(keysPath, "utf8").then(JSON.parse),
  readFile(
    "/Users/evillevi/.codex/karma-secrets/karma-pos-project.json",
    "utf8",
  ).then(JSON.parse),
]);
if (privateProject.projectRef !== ref)
  throw new Error(
    "Private project identity did not match the approved project.",
  );
const anonKey = keys.find(
  (item) => item.name === "anon" && item.type === "legacy",
)?.api_key;
const serviceKey = keys.find(
  (item) => item.name === "service_role" && item.type === "legacy",
)?.api_key;
if (!anonKey || !serviceKey)
  throw new Error(
    "Expected project API keys were not found in private key storage.",
  );

const password = `Proof-${randomBytes(32).toString("base64url")}-K9!`;
const cashier = { email: `evl114-cashier-${suffix}@example.invalid`, password };
const waiter = {
  email: `evl114-waiter-${suffix}@example.invalid`,
  password: `Proof-${randomBytes(32).toString("base64url")}-W4!`,
};
const owner = {
  email: `evl118-owner-${suffix}@example.invalid`,
  password: `Proof-${randomBytes(32).toString("base64url")}-O8!`,
};
const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const createdCashier = await admin.auth.admin.createUser({
  ...cashier,
  email_confirm: true,
});
if (createdCashier.error)
  throw new Error(
    `Synthetic cashier creation failed: ${createdCashier.error.message}`,
  );
const createdWaiter = await admin.auth.admin.createUser({
  ...waiter,
  email_confirm: true,
});
if (createdWaiter.error)
  throw new Error(
    `Synthetic preparation user creation failed: ${createdWaiter.error.message}`,
  );
const createdOwner = await admin.auth.admin.createUser({
  ...owner,
  email_confirm: true,
});
if (createdOwner.error)
  throw new Error(
    `Synthetic owner creation failed: ${createdOwner.error.message}`,
  );
const cashierId = createdCashier.data.user.id;
const waiterId = createdWaiter.data.user.id;
const ownerId = createdOwner.data.user.id;
const now = new Date();
const validFrom = new Date(now.getTime() - 60_000).toISOString();
const expiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();

for (const [table, row, conflictKey] of [
  [
    "branches",
    {
      branch_id: branchId,
      name: "EVL-114 synthetic proof branch",
      currency: "MXN",
    },
    "branch_id",
  ],
  [
    "branch_memberships",
    { branch_id: branchId, user_id: cashierId, role: "barra" },
    "branch_id,user_id",
  ],
  [
    "branch_memberships",
    { branch_id: branchId, user_id: waiterId, role: "mesero" },
    "branch_id,user_id",
  ],
  [
    "branch_memberships",
    { branch_id: branchId, user_id: ownerId, role: "duena" },
    "branch_id,user_id",
  ],
  [
    "register_devices",
    {
      device_id: cashDeviceId,
      branch_id: branchId,
      owner_user_id: cashierId,
      capability: "cash_register",
    },
    "device_id",
  ],
  [
    "register_devices",
    {
      device_id: prepDeviceId,
      branch_id: branchId,
      owner_user_id: waiterId,
      capability: "preparation",
    },
    "device_id",
  ],
  [
    "branch_register_leases",
    {
      branch_id: branchId,
      device_id: cashDeviceId,
      lease_id: leaseId,
      valid_from: validFrom,
      expires_at: expiresAt,
      issued_by: cashierId,
    },
    "branch_id",
  ],
]) {
  const result = await admin
    .from(table)
    .upsert(row, { onConflict: conflictKey });
  if (result.error)
    throw new Error(
      `Synthetic fixture setup failed for ${table}: ${result.error.message}`,
    );
}

await writeFile(
  publicEnvPath,
  [
    `VITE_SUPABASE_URL=${supabaseUrl}`,
    `VITE_SUPABASE_ANON_KEY=${anonKey}`,
    `VITE_DEMO_BRANCH_ID=${branchId}`,
    `VITE_DEMO_DEVICE_ID=${cashDeviceId}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);
await chmod(publicEnvPath, 0o600);
await writeFile(
  secretsPath,
  [
    `SUPABASE_URL=${supabaseUrl}`,
    `SUPABASE_ANON_KEY=${anonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
    `SUPABASE_CASHIER_EMAIL=${cashier.email}`,
    `SUPABASE_CASHIER_PASSWORD=${cashier.password}`,
    `SUPABASE_WAITER_EMAIL=${waiter.email}`,
    `SUPABASE_WAITER_PASSWORD=${waiter.password}`,
    `SUPABASE_OWNER_EMAIL=${owner.email}`,
    `SUPABASE_OWNER_PASSWORD=${owner.password}`,
    `SUPABASE_BRANCH_ID=${branchId}`,
    `SUPABASE_CASH_DEVICE_ID=${cashDeviceId}`,
    `SUPABASE_PREP_DEVICE_ID=${prepDeviceId}`,
    `SUPABASE_LEASE_ID=${leaseId}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);
await chmod(secretsPath, 0o600);
console.log(
  "Created unique synthetic users and branch in the approved project. Browser config contains only the public anon key; private test credentials are stored in ignored .env.offline-test.local.",
);
