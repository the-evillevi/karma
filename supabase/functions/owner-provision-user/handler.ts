const roles = new Set(["duena", "encargado", "barra", "mesero"]);
const maxBodyBytes = 8_192;

export interface ProvisionInput {
  branchId: string;
  email: string;
  displayName: string;
  role: string;
  active: boolean;
}

export interface ProvisionServices {
  allowedOrigin: string | null;
  resolveUser(accessToken: string): Promise<string | null>;
  isActiveOwner(userId: string, branchId: string): Promise<boolean>;
  createUser(email: string, password: string): Promise<string | null>;
  assignMembership(
    accessToken: string,
    input: ProvisionInput,
    userId: string,
  ): Promise<boolean>;
  deleteUser(userId: string): Promise<void>;
  generateTemporaryPassword(): string;
}

interface AuthAdminDeleteClient {
  auth: {
    admin: {
      deleteUser(userId: string): Promise<{ error: unknown | null }>;
    };
  };
}

export async function deleteCreatedAuthUser(
  adminClient: AuthAdminDeleteClient | null,
  userId: string,
): Promise<void> {
  if (!adminClient) throw new Error("Account cleanup is unavailable.");
  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) throw new Error("Account cleanup failed.");
}

function json(
  status: number,
  body: Record<string, unknown>,
  origin?: string,
): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function preflight(origin: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "authorization, apikey, x-client-info, content-type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    },
  });
}

async function readBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBodyBytes || !request.body)
    throw new TypeError("Invalid request.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBodyBytes) {
      await reader.cancel();
      throw new TypeError("Invalid request.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function parseInput(value: unknown): ProvisionInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body.branchId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$/.test(body.branchId) ||
    typeof body.displayName !== "string" ||
    !body.displayName.trim() ||
    body.displayName.trim().length > 120 ||
    /[\u0000-\u001f\u007f]/.test(body.displayName) ||
    typeof body.email !== "string" ||
    body.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ||
    typeof body.role !== "string" ||
    !roles.has(body.role) ||
    typeof body.active !== "boolean"
  )
    return null;
  return {
    branchId: body.branchId,
    displayName: body.displayName.trim(),
    email: body.email.trim().toLowerCase(),
    role: body.role,
    active: body.active,
  };
}

export function createProvisionHandler(
  services: ProvisionServices,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const origin = request.headers.get("origin") ?? "";
    if (!services.allowedOrigin)
      return json(503, { error: "Provisioning is unavailable." });
    if (origin !== services.allowedOrigin)
      return json(403, { error: "Origin is not allowed." });
    if (request.method === "OPTIONS") return preflight(services.allowedOrigin);
    if (request.method !== "POST")
      return json(
        405,
        { error: "Method not allowed." },
        services.allowedOrigin,
      );

    const bearer = /^Bearer\s+([^\s]+)$/iu.exec(
      request.headers.get("authorization") ?? "",
    )?.[1];
    if (!bearer)
      return json(
        401,
        { error: "Sign in as an active branch owner." },
        services.allowedOrigin,
      );

    let input: ProvisionInput | null;
    try {
      input = parseInput(await readBody(request));
    } catch {
      input = null;
    }
    if (!input)
      return json(
        400,
        { error: "Account details are invalid." },
        services.allowedOrigin,
      );

    let userId: string | null;
    try {
      userId = await services.resolveUser(bearer);
    } catch {
      userId = null;
    }
    if (!userId)
      return json(
        401,
        { error: "Sign in as an active branch owner." },
        services.allowedOrigin,
      );

    let isOwner = false;
    try {
      isOwner = await services.isActiveOwner(userId, input.branchId);
    } catch {
      isOwner = false;
    }
    if (!isOwner)
      return json(
        403,
        { error: "Only an active branch owner can create accounts." },
        services.allowedOrigin,
      );

    let password: string;
    try {
      password = services.generateTemporaryPassword();
    } catch {
      return json(
        503,
        { error: "Provisioning is unavailable." },
        services.allowedOrigin,
      );
    }
    let createdUserId: string | null;
    try {
      createdUserId = await services.createUser(input.email, password);
    } catch {
      createdUserId = null;
    }
    if (!createdUserId)
      return json(
        409,
        { error: "The account could not be created." },
        services.allowedOrigin,
      );

    let assigned = false;
    try {
      assigned = await services.assignMembership(bearer, input, createdUserId);
    } catch {
      assigned = false;
    }
    if (!assigned) {
      let cleanupConfirmed = false;
      try {
        await services.deleteUser(createdUserId);
        cleanupConfirmed = true;
      } catch {
        // Do not claim the new Auth identity was removed if cleanup failed.
      }
      if (!cleanupConfirmed)
        return json(
          500,
          {
            error:
              "The account could not be assigned and cleanup could not be confirmed.",
          },
          services.allowedOrigin,
        );
      return json(
        409,
        { error: "The account could not be assigned to this branch." },
        services.allowedOrigin,
      );
    }

    return json(
      201,
      {
        userId: createdUserId,
        email: input.email,
        temporaryPassword: password,
      },
      services.allowedOrigin,
    );
  };
}
