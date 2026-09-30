import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { createProvisionHandler, deleteCreatedAuthUser } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ready = Boolean(url && anonKey && serviceRoleKey);
const adminClient = ready
  ? createClient(url!, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const handle = createProvisionHandler({
  allowedOrigin: Deno.env.get("KARMA_POS_ALLOWED_ORIGIN") ?? null,
  resolveUser: async (accessToken) => {
    if (!ready) return null;
    const caller = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await caller.auth.getUser(accessToken);
    return error ? null : (data.user?.id ?? null);
  },
  isActiveOwner: async (userId, branchId) => {
    if (!adminClient) return false;
    const { data, error } = await adminClient
      .from("branch_memberships")
      .select("role, active")
      .eq("branch_id", branchId)
      .eq("user_id", userId)
      .maybeSingle();
    return !error && data?.role === "duena" && data.active === true;
  },
  createUser: async (email, password) => {
    if (!adminClient) return null;
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    return error ? null : (data.user?.id ?? null);
  },
  assignMembership: async (accessToken, input, userId) => {
    if (!url || !anonKey) return false;
    const caller = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { error } = await caller.rpc("manage_branch_membership", {
      p_branch_id: input.branchId,
      p_user_id: userId,
      p_display_name: input.displayName,
      p_role: input.role,
      p_active: input.active,
    });
    return !error;
  },
  deleteUser: (userId) => deleteCreatedAuthUser(adminClient, userId),
  generateTemporaryPassword: () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
      "",
    );
    return btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
  },
});

Deno.serve(handle);
