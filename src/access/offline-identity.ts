import { isAccessRole, type AccessRole } from "./role-policy";

const PIN_PATTERN = /^\d{6,8}$/;
const PBKDF2_ITERATIONS = 210_000;
const MAX_PIN_FAILURES = 5;
const LOCKOUT_MS = 5 * 60_000;
const MAX_LOCKOUT_MS = 30 * 60_000;

export interface VerifiedAccessContext {
  userId: string;
  displayName: string;
  role: AccessRole;
  branchId: string;
  deviceId: string;
  sessionId: string;
  capability: "cash_register" | "preparation";
  leaseId: string;
  expiresAt: string;
  verifiedAt: string;
}

export interface OfflineIdentityGrant extends VerifiedAccessContext {
  salt: string;
  pinVerifier: string;
  pinIterations: number;
  failedPinAttempts: number;
  lockoutCount: number;
  lockedUntil: number | null;
}

export type OfflineUnlockResult =
  | { ok: true; grant: OfflineIdentityGrant }
  | {
      ok: false;
      grant: OfflineIdentityGrant;
      reason: "invalid-pin" | "locked" | "expired";
      retryAt?: number;
    };

export function parseVerifiedAccessContext(
  value: unknown,
): VerifiedAccessContext {
  if (!value || typeof value !== "object")
    throw new TypeError("The access service returned an invalid identity.");
  const context = value as Record<string, unknown>;
  const requiredText = [
    "userId",
    "displayName",
    "branchId",
    "deviceId",
    "sessionId",
    "leaseId",
    "expiresAt",
    "verifiedAt",
  ] as const;
  for (const key of requiredText) {
    if (typeof context[key] !== "string" || !context[key].trim())
      throw new TypeError(
        "The access service returned an incomplete identity.",
      );
  }
  if (!isAccessRole(context.role))
    throw new TypeError("The access service returned an unknown role.");
  if (
    context.capability !== "cash_register" &&
    context.capability !== "preparation"
  )
    throw new TypeError("The access service returned an unsupported device.");
  const verifiedAt = Date.parse(context.verifiedAt as string);
  const expiresAt = Date.parse(context.expiresAt as string);
  if (
    !Number.isFinite(verifiedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= verifiedAt
  )
    throw new TypeError("The device authorization has an invalid expiry.");
  return context as unknown as VerifiedAccessContext;
}

export async function createOfflineIdentityGrant(
  context: VerifiedAccessContext,
  pin: string,
  cryptoApi: Crypto = globalThis.crypto,
): Promise<OfflineIdentityGrant> {
  if (!PIN_PATTERN.test(pin))
    throw new TypeError("Offline PIN must contain six to eight digits.");
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const pinVerifier = await derivePinVerifier(pin, salt, cryptoApi);
  return {
    ...context,
    salt: toBase64(salt),
    pinVerifier,
    pinIterations: PBKDF2_ITERATIONS,
    failedPinAttempts: 0,
    lockoutCount: 0,
    lockedUntil: null,
  };
}

export async function unlockOfflineIdentity(
  untrustedGrant: OfflineIdentityGrant,
  pin: string,
  now = Date.now(),
  cryptoApi: Crypto = globalThis.crypto,
): Promise<OfflineUnlockResult> {
  const grant = parseOfflineIdentityGrant(untrustedGrant);
  if (now >= Date.parse(grant.expiresAt))
    return { ok: false, grant, reason: "expired" };
  if (grant.lockedUntil !== null && now < grant.lockedUntil)
    return {
      ok: false,
      grant,
      reason: "locked",
      retryAt: grant.lockedUntil,
    };
  if (!PIN_PATTERN.test(pin)) return recordPinFailure(grant, now);
  const salt = fromBase64(grant.salt);
  const candidate = await derivePinVerifier(
    pin,
    salt,
    cryptoApi,
    grant.pinIterations,
  );
  if (!constantTimeEqual(candidate, grant.pinVerifier))
    return recordPinFailure(grant, now);
  return {
    ok: true,
    grant: {
      ...grant,
      failedPinAttempts: 0,
      lockoutCount: 0,
      lockedUntil: null,
    },
  };
}

export function parseOfflineIdentityGrant(
  value: unknown,
): OfflineIdentityGrant {
  if (!value || typeof value !== "object")
    throw new TypeError("Saved offline access data is invalid.");
  const grant = value as Record<string, unknown>;
  const context = parseVerifiedAccessContext(grant);
  if (
    typeof grant.salt !== "string" ||
    !/^[A-Za-z0-9+/]{22}==$/.test(grant.salt) ||
    typeof grant.pinVerifier !== "string" ||
    !/^[A-Za-z0-9+/]{43}=$/.test(grant.pinVerifier) ||
    !Number.isSafeInteger(grant.pinIterations) ||
    (grant.pinIterations as number) < 100_000 ||
    (grant.pinIterations as number) > 500_000 ||
    !Number.isSafeInteger(grant.failedPinAttempts) ||
    (grant.failedPinAttempts as number) < 0 ||
    (grant.failedPinAttempts as number) >= MAX_PIN_FAILURES ||
    !Number.isSafeInteger(grant.lockoutCount) ||
    (grant.lockoutCount as number) < 0 ||
    (grant.lockoutCount as number) > 16 ||
    (grant.lockedUntil !== null &&
      (typeof grant.lockedUntil !== "number" ||
        !Number.isFinite(grant.lockedUntil) ||
        grant.lockedUntil < 0))
  ) {
    throw new TypeError("Saved offline access data is invalid.");
  }
  return {
    ...context,
    salt: grant.salt,
    pinVerifier: grant.pinVerifier,
    pinIterations: grant.pinIterations as number,
    failedPinAttempts: grant.failedPinAttempts as number,
    lockoutCount: grant.lockoutCount as number,
    lockedUntil: grant.lockedUntil as number | null,
  };
}

export function assertOfflineGrantAllowsCapture(
  grant: OfflineIdentityGrant,
  {
    actorId,
    branchId,
    deviceId,
    now = Date.now(),
  }: {
    actorId: string;
    branchId: string;
    deviceId: string;
    now?: number;
  },
): void {
  const verified = parseOfflineIdentityGrant(grant);
  if (
    verified.userId !== actorId ||
    verified.branchId !== branchId ||
    verified.deviceId !== deviceId
  ) {
    throw Object.assign(
      new Error("Esta identidad no puede capturar en este dispositivo."),
      { code: "OFFLINE_IDENTITY_MISMATCH" },
    );
  }
  if (now >= Date.parse(verified.expiresAt)) {
    throw Object.assign(
      new Error(
        "La autorización almacenada venció. Reconecta y vuelve a verificar el acceso.",
      ),
      { code: "OFFLINE_AUTHORIZATION_EXPIRED" },
    );
  }
}

function recordPinFailure(
  grant: OfflineIdentityGrant,
  now: number,
): OfflineUnlockResult {
  const attempts = grant.failedPinAttempts + 1;
  if (attempts < MAX_PIN_FAILURES)
    return {
      ok: false,
      grant: { ...grant, failedPinAttempts: attempts },
      reason: "invalid-pin",
    };
  const lockoutCount = grant.lockoutCount + 1;
  const lockMs = Math.min(
    MAX_LOCKOUT_MS,
    LOCKOUT_MS * 2 ** Math.min(lockoutCount - 1, 8),
  );
  const lockedUntil = now + lockMs;
  return {
    ok: false,
    grant: { ...grant, failedPinAttempts: 0, lockoutCount, lockedUntil },
    reason: "locked",
    retryAt: lockedUntil,
  };
}

async function derivePinVerifier(
  pin: string,
  salt: Uint8Array,
  cryptoApi: Crypto,
  iterations = PBKDF2_ITERATIONS,
): Promise<string> {
  const key = await cryptoApi.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await cryptoApi.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new Uint8Array(salt).buffer as ArrayBuffer,
      iterations,
    },
    key,
    256,
  );
  return toBase64(new Uint8Array(derived));
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1)
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
