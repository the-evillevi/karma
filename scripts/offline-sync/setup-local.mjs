import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const projectRoot = process.cwd();
const localSecretsPath = `${projectRoot}/.offline-test.local`;
const publicEnvPath = `${projectRoot}/.env.local`;
const cashier = { email: "cashier@karma.local", password: "KarmaLocalDemo-2026!" };
const waiter = { email: "waiter@karma.local", password: "KarmaLocalDemo-2026!" };
const branchId = "karma-demo-branch";
const cashDeviceId = "karma-demo-register-01";
const prepDeviceId = "karma-demo-prep-01";

function run(args, { allowFailure = false } = {}) {
  const result = spawnSync("supabase", args, { cwd: `${projectRoot}/supabase`, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0 && !allowFailure) {
    // CLI output can contain local API keys; never print captured output.
    throw new Error(`Supabase command failed (${args[0]} ${args[1] ?? ""}, exit ${result.status ?? "unknown"}); inspect the local Docker/CLI logs privately.`);
  }
  return result;
}

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) return [];
    const value = match[2].replace(/^['"]|['"]$/g, "");
    return [[match[1], value]];
  }));
}

async function ensureUser(admin, user) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const existing = data.users.find((item) => item.email === user.email);
  if (existing) {
    const updated = await admin.auth.admin.updateUserById(existing.id, { password: user.password, email_confirm: true });
    if (updated.error) throw updated.error;
    return existing.id;
  }
  const created = await admin.auth.admin.createUser({ ...user, email_confirm: true });
  if (created.error) throw created.error;
  return created.data.user.id;
}

console.log("Starting the isolated local Supabase database and API. First startup may download Docker images.");
run(["start", "-x", "studio,mailpit,storage-api,vector,logflare,edge-runtime,realtime"]);
run(["db", "reset"]);
const status = run(["status", "-o", "env"]);
const env = parseEnv(status.stdout);
const supabaseUrl = env.API_URL || env.SUPABASE_URL || "http://127.0.0.1:56431";
const anonKey = env.ANON_KEY || env.PUBLISHABLE_KEY;
const serviceKey = env.SERVICE_ROLE_KEY || env.SECRET_KEY;
if (!anonKey || !serviceKey) throw new Error("Supabase CLI status did not provide the expected local keys.");

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const cashierId = await ensureUser(admin, cashier);
const waiterId = await ensureUser(admin, waiter);
const now = new Date();
const issuedAt = new Date(now.getTime() - 60_000).toISOString();
const expiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();

for (const [table, row] of [
  ["branches", { branch_id: branchId, name: "Karma local de prueba", currency: "MXN" }],
  ["branch_memberships", { branch_id: branchId, user_id: cashierId, role: "barra" }],
  ["branch_memberships", { branch_id: branchId, user_id: waiterId, role: "mesero" }],
  ["register_devices", { device_id: cashDeviceId, branch_id: branchId, owner_user_id: cashierId, capability: "cash_register", revoked_at: null }],
  ["register_devices", { device_id: prepDeviceId, branch_id: branchId, owner_user_id: waiterId, capability: "preparation", revoked_at: null }],
  ["branch_register_leases", { branch_id: branchId, device_id: cashDeviceId, lease_id: "karma-demo-lease-01", valid_from: issuedAt, expires_at: expiresAt, revoked_at: null, issued_by: cashierId }],
]) {
  const key = table === "branches" ? "branch_id" : table === "branch_memberships" ? "branch_id,user_id" : table === "branch_register_leases" ? "branch_id" : "device_id";
  const result = await admin.from(table).upsert(row, { onConflict: key });
  if (result.error) throw new Error(`Local fixture setup failed for ${table}: ${result.error.message}`);
}

await writeFile(publicEnvPath, [
  `VITE_SUPABASE_URL=${supabaseUrl}`,
  `VITE_SUPABASE_ANON_KEY=${anonKey}`,
  `VITE_DEMO_BRANCH_ID=${branchId}`,
  `VITE_DEMO_DEVICE_ID=${cashDeviceId}`,
  "",
].join("\n"));
await writeFile(localSecretsPath, [
  `SUPABASE_URL=${supabaseUrl}`,
  `SUPABASE_ANON_KEY=${anonKey}`,
  `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
  `SUPABASE_CASHIER_EMAIL=${cashier.email}`,
  `SUPABASE_CASHIER_PASSWORD=${cashier.password}`,
  `SUPABASE_WAITER_EMAIL=${waiter.email}`,
  `SUPABASE_WAITER_PASSWORD=${waiter.password}`,
  `SUPABASE_BRANCH_ID=${branchId}`,
  `SUPABASE_CASH_DEVICE_ID=${cashDeviceId}`,
  `SUPABASE_PREP_DEVICE_ID=${prepDeviceId}`,
  "",
].join("\n"), { mode: 0o600 });

console.log("Local Supabase is ready with synthetic cashier/waiter fixtures. Client config is in ignored .env.local; test-only credentials are in ignored .offline-test.local.");
