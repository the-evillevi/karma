import { isAccessRole, type AccessRole } from "./role-policy";
import type { VerifiedAccessContext } from "./offline-identity";

export interface RegisterSessionClient {
  rpc(
    functionName: "bind_register_session",
    args: { p_branch_id: string; p_device_id: string },
  ): PromiseLike<{
    data: RegisterSessionRow[] | RegisterSessionRow | null;
    error: { code?: string } | null;
  }>;
}

interface RegisterSessionRow {
  session_id: string;
  branch_id: string;
  device_id: string;
  actor_id: string;
  display_name: string;
  role: string;
  capability: string;
  lease_id: string;
  expires_at: string;
}

const safeAuthErrors: Record<string, { code: string; message: string }> = {
  "42501": {
    code: "AUTHORIZATION_UNAVAILABLE",
    message:
      "El servidor no confirmó una autorización activa para esta identidad y dispositivo.",
  },
  P0002: {
    code: "DEVICE_UNAVAILABLE",
    message:
      "El dispositivo autorizado no está disponible. Solicita apoyo a la dueña.",
  },
};

export async function bindRegisterSession(
  client: RegisterSessionClient,
  {
    authUserId,
    branchId,
    deviceId,
    now = new Date(),
  }: {
    authUserId: string;
    branchId: string;
    deviceId: string;
    now?: Date;
  },
): Promise<VerifiedAccessContext> {
  const result = await client.rpc("bind_register_session", {
    p_branch_id: branchId,
    p_device_id: deviceId,
  });
  if (result.error) {
    const safe = safeAuthErrors[result.error.code ?? ""] ?? {
      code: "AUTHORIZATION_UNAVAILABLE",
      message: "No se pudo confirmar la autorización con el servidor.",
    };
    throw Object.assign(new Error(safe.message), { code: safe.code });
  }
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row)
    throw new Error("El servidor no devolvió una sesión de dispositivo.");
  if (
    row.actor_id !== authUserId ||
    row.branch_id !== branchId ||
    row.device_id !== deviceId ||
    !row.session_id ||
    !row.display_name?.trim() ||
    !isAccessRole(row.role) ||
    (row.capability !== "cash_register" && row.capability !== "preparation") ||
    !row.lease_id ||
    !Number.isFinite(Date.parse(row.expires_at)) ||
    Date.parse(row.expires_at) <= now.getTime()
  ) {
    throw Object.assign(
      new Error(
        "El servidor devolvió una sesión de dispositivo incompleta o vencida.",
      ),
      { code: "AUTHORIZATION_UNAVAILABLE" },
    );
  }
  return {
    userId: row.actor_id,
    displayName: row.display_name,
    role: row.role as AccessRole,
    branchId: row.branch_id,
    deviceId: row.device_id,
    sessionId: row.session_id,
    capability: row.capability,
    leaseId: row.lease_id,
    expiresAt: row.expires_at,
    verifiedAt: now.toISOString(),
  };
}
