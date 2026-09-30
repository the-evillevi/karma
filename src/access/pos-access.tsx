import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createOfflineIdentityGrant,
  parseVerifiedAccessContext,
  parseOfflineIdentityGrant,
  unlockOfflineIdentity,
  type OfflineIdentityGrant,
  type VerifiedAccessContext,
} from "./offline-identity.ts";
import { bindRegisterSession } from "./register-session.ts";
import { createSupabaseClient } from "../offline-sync/command-sync.ts";
import { isAccessRole, type AccessRole } from "./role-policy.ts";
import { posAccessStorageKey } from "./pos-storage-key.ts";

const branchId = import.meta.env.VITE_KARMA_BRANCH_ID;
const deviceId = import.meta.env.VITE_KARMA_DEVICE_ID;

export interface PosAccessOptions {
  mode?: "secure" | "demo";
  branchId?: string;
  deviceId?: string;
  createClient?: typeof createSupabaseClient;
}

export interface BranchMember {
  userId: string;
  displayName: string;
  role: AccessRole;
  active: boolean;
}

interface MembershipRow {
  user_id: string;
  display_name: string;
  role: string;
  active: boolean;
}

export interface PosAccessState {
  mode: "secure" | "demo";
  storageKey: string;
  expectedBranchId: string;
  expectedDeviceId: string;
  context: VerifiedAccessContext | OfflineIdentityGrant | null;
  accessScreen: React.ReactNode;
  accessControls: React.ReactNode;
  configError: string;
  members: BranchMember[];
  switchIdentity(): void;
  onManageMember(input: {
    userId: string;
    displayName: string;
    role: AccessRole;
    active: boolean;
  }): Promise<void>;
  onCreateMember(input: {
    email: string;
    displayName: string;
    role: AccessRole;
    active: boolean;
  }): Promise<{ userId: string; email: string; temporaryPassword: string }>;
  onSetMemberActive(userId: string, active: boolean): Promise<void>;
}

function readOfflineRoster(
  rosterKey: string,
  branchId?: string,
  deviceId?: string,
): OfflineIdentityGrant[] {
  try {
    const raw = window.localStorage.getItem(rosterKey);
    if (!raw) return [];
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) throw new TypeError("invalid access list");
    return value
      .map(parseOfflineIdentityGrant)
      .filter(
        (grant) => grant.branchId === branchId && grant.deviceId === deviceId,
      );
  } catch {
    try {
      window.localStorage.removeItem(rosterKey);
    } catch {
      /* An unavailable store stays fail-closed. */
    }
    return [];
  }
}

function toMember(row: MembershipRow): BranchMember | null {
  if (
    typeof row?.user_id !== "string" ||
    !row.user_id ||
    typeof row.display_name !== "string" ||
    !row.display_name.trim() ||
    !isAccessRole(row.role) ||
    typeof row.active !== "boolean"
  )
    return null;
  return {
    userId: row.user_id,
    displayName: row.display_name,
    role: row.role,
    active: row.active,
  };
}

function safeMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return "No se pudo confirmar el acceso con el servidor.";
}

function authorizationDenial(
  error: unknown,
  allowProvisioningHttp = false,
): boolean {
  if (!error || typeof error !== "object") return false;
  const code =
    "code" in error && typeof error.code === "string" ? error.code : "";
  if (
    ["42501", "AUTHORIZATION_UNAVAILABLE", "DEVICE_UNAVAILABLE"].includes(code)
  )
    return true;
  if (!allowProvisioningHttp) return false;
  const context = "context" in error ? error.context : undefined;
  const status =
    context && typeof context === "object" && "status" in context
      ? context.status
      : "status" in error
        ? error.status
        : undefined;
  return status === 401 || status === 403;
}

function revokedAuthorizationError(): Error & { code: string } {
  return Object.assign(
    new Error(
      "El servidor ya no confirma esta autorización. Inicia sesión de nuevo para continuar.",
    ),
    { code: "AUTHORIZATION_UNAVAILABLE" },
  );
}

function isNetworkFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    Boolean(
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "FetchError",
    )
  );
}

const roleLabels: Record<AccessRole, string> = {
  duena: "Dueña",
  encargado: "Encargado",
  barra: "Barra",
  mesero: "Mesero",
};

export function usePosAccess(options: PosAccessOptions = {}): PosAccessState {
  const configuredBranchId = options.branchId ?? branchId;
  const configuredDeviceId = options.deviceId ?? deviceId;
  const rosterKey = `karma-evl118-pos-identities:${configuredBranchId ?? ""}:${configuredDeviceId ?? ""}`;
  const makeClient = options.createClient ?? createSupabaseClient;
  const secure =
    options.mode ?? import.meta.env.VITE_KARMA_ACCESS_MODE === "secure";
  const mode = secure ? "secure" : "demo";
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [context, setContext] = useState<
    VerifiedAccessContext | OfflineIdentityGrant | null
  >(null);
  const [roster, setRoster] = useState<OfflineIdentityGrant[]>(() =>
    readOfflineRoster(rosterKey, configuredBranchId, configuredDeviceId),
  );
  const rosterRef = useRef(roster);
  const identityGeneration = useRef(0);
  const [members, setMembers] = useState<BranchMember[]>([]);
  const [configError, setConfigError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedOfflineUser, setSelectedOfflineUser] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinSetupOpen, setPinSetupOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);

  const configReady = Boolean(
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_ANON_KEY &&
    configuredBranchId?.trim() &&
    configuredDeviceId?.trim(),
  );

  const saveRoster = useCallback(
    (next: OfflineIdentityGrant[]): boolean => {
      rosterRef.current = next;
      setRoster(next);
      try {
        window.localStorage.setItem(rosterKey, JSON.stringify(next));
        return true;
      } catch {
        try {
          window.localStorage.removeItem(rosterKey);
        } catch {
          // Revoke from memory even when browser storage is locked.
        }
        return false;
      }
    },
    [rosterKey],
  );

  const clearIdentity = useCallback(() => {
    identityGeneration.current += 1;
    setContext(null);
    setSessionUserId(null);
    setMembers([]);
    setMessage("");
    setSelectedOfflineUser("");
    setPin("");
    setPinConfirm("");
    setPinSetupOpen(false);
  }, []);

  const invalidateIdentity = useCallback(
    (userId: string, generation: number) => {
      if (
        generation !== identityGeneration.current ||
        context?.userId !== userId
      )
        return;
      saveRoster(rosterRef.current.filter((grant) => grant.userId !== userId));
      clearIdentity();
      setMessage(
        "El servidor ya no confirma esta autorización. Inicia sesión de nuevo para continuar.",
      );
    },
    [clearIdentity, context, saveRoster],
  );

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  const bindUser = useCallback(
    async (
      supabase: SupabaseClient,
      userId: string,
      generation = identityGeneration.current,
    ) => {
      if (!configuredBranchId || !configuredDeviceId)
        throw new Error("Falta configurar la sucursal o el dispositivo.");
      const verified = await bindRegisterSession(supabase, {
        authUserId: userId,
        branchId: configuredBranchId,
        deviceId: configuredDeviceId,
      });
      if (generation !== identityGeneration.current) return verified;
      setSessionUserId(userId);
      setContext(verified);
      const currentRoster = rosterRef.current;
      const existing = currentRoster.find((grant) => grant.userId === userId);
      if (existing) {
        const refreshed = { ...existing, ...verified };
        saveRoster(
          currentRoster.map((grant) =>
            grant.userId === userId ? refreshed : grant,
          ),
        );
        setContext(refreshed);
      }
      setMessage(
        "Servidor confirmó la identidad, el rol y la autorización del dispositivo.",
      );
      return verified;
    },
    [saveRoster, configuredBranchId, configuredDeviceId],
  );

  const refreshMembers = useCallback(
    async (
      supabase: SupabaseClient,
      access: VerifiedAccessContext | OfflineIdentityGrant,
      expectedGeneration = identityGeneration.current,
    ) => {
      if (access.role !== "duena") {
        setMembers([]);
        return;
      }
      const result = await supabase.rpc("list_branch_memberships", {
        p_branch_id: access.branchId,
      });
      if (result.error) {
        if (authorizationDenial(result.error)) {
          invalidateIdentity(access.userId, expectedGeneration);
          throw revokedAuthorizationError();
        }
        throw result.error;
      }
      setMembers(
        Array.isArray(result.data)
          ? result.data
              .map(toMember)
              .filter((value): value is BranchMember => value !== null)
          : [],
      );
    },
    [invalidateIdentity],
  );

  useEffect(() => {
    if (!secure) return;
    if (!configReady) {
      setConfigError(
        "El acceso seguro requiere configuración explícita de Supabase, sucursal y dispositivo. No se abrirá el POS demo como sustituto.",
      );
      return;
    }
    let cancelled = false;
    const generation = identityGeneration.current;
    void makeClient()
      .then(async (supabase) => {
        if (cancelled) return;
        setClient(supabase);
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (cancelled) return;
        const userId = data.session?.user.id;
        if (!userId || !navigator.onLine) return;
        try {
          await bindUser(supabase, userId, generation);
        } catch (error) {
          if (!cancelled && generation === identityGeneration.current) {
            await supabase.auth.signOut();
            if (!isNetworkFailure(error)) {
              const freshRoster = readOfflineRoster(
                rosterKey,
                configuredBranchId,
                configuredDeviceId,
              );
              saveRoster(
                freshRoster.filter((grant) => grant.userId !== userId),
              );
            }
            clearIdentity();
            setMessage(safeMessage(error));
          }
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setConfigError(safeMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [
    secure,
    configReady,
    bindUser,
    clearIdentity,
    saveRoster,
    makeClient,
    rosterKey,
    configuredBranchId,
    configuredDeviceId,
  ]);

  useEffect(() => {
    if (!context) return;
    const remaining = Date.parse(context.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      clearIdentity();
      setMessage(
        "La autorización venció. Inicia sesión para volver a comprobarla.",
      );
      return;
    }
    const timer = window.setTimeout(() => {
      clearIdentity();
      setMessage(
        "La autorización venció. Inicia sesión para volver a comprobarla.",
      );
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [context, clearIdentity]);

  useEffect(() => {
    if (!secure || !client || !context) return;
    let current = true;
    const recheck = async () => {
      if (!navigator.onLine || !client) return;
      const generation = identityGeneration.current;
      try {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (!current || generation !== identityGeneration.current) return;
        const onlineUserId = data.session?.user.id;
        if (!onlineUserId || onlineUserId !== context.userId) {
          const freshRoster = readOfflineRoster(
            rosterKey,
            configuredBranchId,
            configuredDeviceId,
          );
          saveRoster(
            freshRoster.filter((grant) => grant.userId !== context.userId),
          );
          clearIdentity();
          setMessage(
            "La red volvió. Inicia sesión con esta misma persona para volver a confirmar su autorización.",
          );
          return;
        }
        await bindUser(client, onlineUserId, generation);
        if (current && generation === identityGeneration.current) {
          setMessage(
            "Conexión restablecida; el servidor volvió a confirmar esta sesión.",
          );
        }
      } catch (error) {
        if (current && generation === identityGeneration.current) {
          if (isNetworkFailure(error)) {
            setMessage(
              "No se pudo renovar la autorización por un fallo de red. La sesión local conserva su vencimiento y las operaciones siguen asociadas a esta identidad.",
            );
            return;
          }
          const freshRoster = readOfflineRoster(
            rosterKey,
            configuredBranchId,
            configuredDeviceId,
          );
          saveRoster(
            freshRoster.filter((grant) => grant.userId !== context.userId),
          );
          clearIdentity();
          setMessage(safeMessage(error));
        }
      }
    };
    window.addEventListener("online", recheck);
    return () => {
      current = false;
      window.removeEventListener("online", recheck);
    };
  }, [
    secure,
    client,
    context,
    bindUser,
    clearIdentity,
    saveRoster,
    rosterKey,
    configuredBranchId,
    configuredDeviceId,
  ]);

  useEffect(() => {
    if (!secure || !client || !context) return;
    if (context.role !== "duena" || !navigator.onLine || !sessionUserId) {
      setMembers([]);
      return;
    }
    let active = true;
    void refreshMembers(client, context).catch((error: unknown) => {
      if (active) setMessage(safeMessage(error));
    });
    return () => {
      active = false;
    };
  }, [secure, client, context, sessionUserId, refreshMembers]);

  const signIn = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!navigator.onLine) {
        setMessage(
          "Inicia sesión cuando haya conexión; el PIN solo funciona para una identidad ya verificada y sin conexión.",
        );
        return;
      }
      if (!client || busy) return;
      setBusy(true);
      setMessage("");
      const generation = ++identityGeneration.current;
      let attemptedUserId: string | null = null;
      try {
        const result = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (result.error || !result.data.session)
          throw result.error ?? new Error("No se inició sesión.");
        setPassword("");
        attemptedUserId = result.data.session.user.id;
        await bindUser(client, result.data.session.user.id, generation);
      } catch (error) {
        if (generation !== identityGeneration.current) return;
        setPassword("");
        if (attemptedUserId && !isNetworkFailure(error)) {
          const freshRoster = readOfflineRoster(
            rosterKey,
            configuredBranchId,
            configuredDeviceId,
          );
          saveRoster(
            freshRoster.filter((grant) => grant.userId !== attemptedUserId),
          );
        }
        clearIdentity();
        setMessage(safeMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [
      client,
      busy,
      email,
      password,
      bindUser,
      clearIdentity,
      saveRoster,
      rosterKey,
      configuredBranchId,
      configuredDeviceId,
    ],
  );

  const unlockOffline = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (navigator.onLine) {
        setPin("");
        setMessage(
          "El PIN offline solo se puede usar cuando este dispositivo no tiene conexión. Inicia sesión con Supabase para comprobar permisos online.",
        );
        return;
      }
      const selected = roster.find(
        (grant) => grant.userId === selectedOfflineUser,
      );
      if (!selected) {
        setMessage(
          "Elige una identidad que ya se autorizó con el servidor en este dispositivo.",
        );
        return;
      }
      const generation = ++identityGeneration.current;
      const result = await unlockOfflineIdentity(selected, pin);
      if (generation !== identityGeneration.current || navigator.onLine) {
        setPin("");
        return;
      }
      saveRoster(
        roster.map((grant) =>
          grant.userId === selected.userId ? result.grant : grant,
        ),
      );
      setPin("");
      if (!result.ok) {
        setMessage(
          result.reason === "expired"
            ? "La autorización guardada venció. Reconecta y vuelve a iniciar sesión."
            : result.reason === "locked"
              ? "PIN bloqueado temporalmente. Espera antes de volver a intentar."
              : "PIN incorrecto.",
        );
        return;
      }
      setSessionUserId(null);
      setContext(result.grant);
      setMessage(
        "Identidad desbloqueada con una autorización guardada previamente. La revocación remota se comprobará al reconectar.",
      );
    },
    [roster, selectedOfflineUser, pin, saveRoster],
  );

  const switchIdentity = useCallback(() => {
    clearIdentity();
    if (client) void client.auth.signOut();
  }, [client, clearIdentity]);

  const createOfflinePin = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!context || !sessionUserId || !navigator.onLine) {
        setMessage(
          "Inicia sesión y confirma el acceso con el servidor antes de guardar un PIN offline.",
        );
        return;
      }
      if (pin !== pinConfirm) {
        setMessage("Los PIN no coinciden.");
        return;
      }
      try {
        const verified = parseVerifiedAccessContext(context);
        const grant = await createOfflineIdentityGrant(verified, pin);
        const nextRoster = [
          ...roster.filter((item) => item.userId !== grant.userId),
          grant,
        ];
        if (!saveRoster(nextRoster)) {
          saveRoster(roster);
          setPin("");
          setPinConfirm("");
          setMessage(
            "No se pudo guardar el PIN en este dispositivo. La sesión verificada sigue activa; revisa el almacenamiento e inténtalo de nuevo.",
          );
          return;
        }
        setContext(grant);
        setPin("");
        setPinConfirm("");
        setPinSetupOpen(false);
        setMessage(
          "PIN guardado para esta identidad verificada y este dispositivo.",
        );
      } catch (error) {
        setMessage(safeMessage(error));
      }
    },
    [context, sessionUserId, pin, pinConfirm, roster, saveRoster],
  );

  const onManageMember = useCallback(
    async (input: {
      userId: string;
      displayName: string;
      role: AccessRole;
      active: boolean;
    }) => {
      if (
        !client ||
        !context ||
        context.role !== "duena" ||
        !sessionUserId ||
        !navigator.onLine
      )
        throw new Error(
          "La administración de usuarios requiere una sesión online de Dueña.",
        );
      const generation = identityGeneration.current;
      if (
        !isAccessRole(input.role) ||
        !input.userId.trim() ||
        !input.displayName.trim()
      )
        throw new Error(
          "Captura el UUID de una cuenta Auth existente, su nombre y un rol válido.",
        );
      const result = await client.rpc("manage_branch_membership", {
        p_branch_id: context.branchId,
        p_user_id: input.userId.trim(),
        p_display_name: input.displayName.trim(),
        p_role: input.role,
        p_active: input.active,
      });
      if (result.error) {
        if (authorizationDenial(result.error)) {
          invalidateIdentity(context.userId, generation);
          throw revokedAuthorizationError();
        }
        throw result.error;
      }
      await refreshMembers(client, context, generation);
    },
    [client, context, sessionUserId, refreshMembers, invalidateIdentity],
  );

  const onCreateMember = useCallback(
    async (input: {
      email: string;
      displayName: string;
      role: AccessRole;
      active: boolean;
    }) => {
      if (
        !client ||
        !context ||
        context.role !== "duena" ||
        !sessionUserId ||
        !navigator.onLine
      )
        throw new Error("Crear cuentas requiere una sesión online de Dueña.");
      const generation = identityGeneration.current;
      if (
        !isAccessRole(input.role) ||
        !input.displayName.trim() ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())
      )
        throw new Error("Captura un nombre, correo y rol válidos.");
      const result = await client.functions.invoke("owner-provision-user", {
        body: {
          branchId: context.branchId,
          email: input.email.trim().toLowerCase(),
          displayName: input.displayName.trim(),
          role: input.role,
          active: input.active,
        },
      });
      if (
        result.error ||
        !result.data ||
        typeof result.data.userId !== "string" ||
        typeof result.data.email !== "string" ||
        typeof result.data.temporaryPassword !== "string"
      ) {
        if (result.error && authorizationDenial(result.error, true)) {
          invalidateIdentity(context.userId, generation);
          throw revokedAuthorizationError();
        }
        throw new Error("No se pudo crear la cuenta o asignar el acceso.");
      }
      try {
        await refreshMembers(client, context, generation);
      } catch (error) {
        if (authorizationDenial(error)) throw error;
        setMessage(safeMessage(error));
      }
      return {
        userId: result.data.userId,
        email: result.data.email,
        temporaryPassword: result.data.temporaryPassword,
      };
    },
    [client, context, sessionUserId, refreshMembers, invalidateIdentity],
  );

  const onSetMemberActive = useCallback(
    async (userId: string, active: boolean) => {
      const member = members.find((item) => item.userId === userId);
      if (!member) throw new Error("No se encontró esa cuenta autorizada.");
      await onManageMember({ ...member, active });
    },
    [members, onManageMember],
  );

  const accessScreen = useMemo(() => {
    if (!secure) return null;
    if (configError)
      return (
        <AccessCard title="Acceso seguro no disponible">
          <p role="alert">{configError}</p>
        </AccessCard>
      );
    if (context && context.capability !== "cash_register")
      return (
        <AccessCard title="Este dispositivo no es caja">
          <p role="status">
            La autorización corresponde a un dispositivo de preparación. Abre el
            punto de venta en una caja autorizada.
          </p>
          <button
            type="button"
            style={styles.secondary}
            onClick={switchIdentity}
          >
            Cambiar identidad
          </button>
        </AccessCard>
      );
    return (
      <AccessCard title="Acceso individual verificado">
        <form onSubmit={signIn}>
          <label style={styles.label}>
            Correo de la cuenta Supabase
            <input
              style={styles.input}
              autoComplete="username"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label style={styles.label}>
            Contraseña
            <input
              style={styles.input}
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button style={styles.primary} disabled={busy || !client || !online}>
            Iniciar sesión con Supabase
          </button>
        </form>
        {roster.length > 0 && !online && (
          <form onSubmit={unlockOffline} style={styles.form}>
            <h3 style={styles.subheading}>Desbloqueo sin conexión</h3>
            <p style={styles.note}>
              Solo aparecen identidades que ya fueron autorizadas por el
              servidor y configuraron un PIN en este dispositivo.
            </p>
            <label style={styles.label}>
              Persona
              <select
                style={styles.input}
                value={selectedOfflineUser}
                onChange={(event) => setSelectedOfflineUser(event.target.value)}
              >
                <option value="">Selecciona una identidad</option>
                {roster.map((grant) => (
                  <option key={grant.userId} value={grant.userId}>
                    {grant.displayName} · {roleLabels[grant.role]}
                  </option>
                ))}
              </select>
            </label>
            <label style={styles.label}>
              PIN offline
              <input
                style={styles.input}
                autoComplete="current-password"
                inputMode="numeric"
                type="password"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                minLength={6}
                maxLength={8}
                required
              />
            </label>
            <button
              style={styles.secondary}
              disabled={pin.length < 6 || !selectedOfflineUser}
            >
              Desbloquear identidad
            </button>
          </form>
        )}
        {message && (
          <p role="status" aria-live="polite" style={styles.message}>
            {message}
          </p>
        )}
      </AccessCard>
    );
  }, [
    secure,
    configError,
    context,
    signIn,
    email,
    password,
    busy,
    client,
    roster,
    selectedOfflineUser,
    pin,
    unlockOffline,
    message,
    switchIdentity,
    online,
  ]);

  const accessControls = useMemo(
    () =>
      secure ? (
        <>
          {context && (
            <div className="pos-access-status" role="status">
              <span>
                {context.displayName} · {roleLabels[context.role]} ·{" "}
                {sessionUserId
                  ? "servidor verificado"
                  : "permiso offline guardado"}
              </span>
              {sessionUserId &&
                !roster.some((grant) => grant.userId === sessionUserId) && (
                  <button type="button" onClick={() => setPinSetupOpen(true)}>
                    Configurar PIN offline
                  </button>
                )}
            </div>
          )}
          {pinSetupOpen && context && (
            <div style={styles.overlay} role="presentation">
              <section
                style={styles.pinDialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="offline-pin-title"
              >
                <h2 id="offline-pin-title" style={styles.heading}>
                  Configurar PIN offline
                </h2>
                <p style={styles.note}>
                  Este PIN solo desbloquea en este dispositivo una identidad que
                  el servidor acaba de confirmar. La autorización vence junto
                  con la sesión del dispositivo.
                </p>
                <form onSubmit={createOfflinePin}>
                  <label style={styles.label}>
                    PIN de seis a ocho dígitos
                    <input
                      style={styles.input}
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      value={pin}
                      onChange={(event) => setPin(event.target.value)}
                      minLength={6}
                      maxLength={8}
                      required
                    />
                  </label>
                  <label style={styles.label}>
                    Confirma el PIN
                    <input
                      style={styles.input}
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      value={pinConfirm}
                      onChange={(event) => setPinConfirm(event.target.value)}
                      minLength={6}
                      maxLength={8}
                      required
                    />
                  </label>
                  <div style={styles.actions}>
                    <button
                      style={styles.secondary}
                      type="button"
                      onClick={() => {
                        setPinSetupOpen(false);
                        setPin("");
                        setPinConfirm("");
                      }}
                    >
                      Volver
                    </button>
                    <button
                      style={styles.primary}
                      disabled={pin.length < 6 || pinConfirm.length < 6}
                    >
                      Guardar PIN
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}
        </>
      ) : (
        <div className="pos-access-status demo" role="status">
          DEMO · usuarios, inventario y ventas de ejemplo
        </div>
      ),
    [
      secure,
      context,
      sessionUserId,
      roster,
      pinSetupOpen,
      pin,
      pinConfirm,
      createOfflinePin,
    ],
  );

  return {
    mode,
    storageKey: posAccessStorageKey(
      mode,
      configuredBranchId,
      configuredDeviceId,
    ),
    expectedBranchId: configuredBranchId ?? "",
    expectedDeviceId: configuredDeviceId ?? "",
    context: secure && configError ? null : context,
    accessScreen,
    accessControls,
    configError,
    members,
    switchIdentity,
    onManageMember,
    onCreateMember,
    onSetMemberActive,
  };
}

function AccessCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main style={styles.page}>
      <header style={styles.brand}>
        <div style={styles.logo}>Karma</div>
        <div style={styles.eyebrow}>Punto de venta · acceso seguro</div>
      </header>
      <section style={styles.card}>
        <h1 style={styles.heading}>{title}</h1>
        {children}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    boxSizing: "border-box",
    minHeight: "100vh",
    maxWidth: 520,
    margin: "0 auto",
    padding: "clamp(24px, 6vw, 48px) 20px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    fontFamily: "system-ui, sans-serif",
    color: "#20252b",
  },
  brand: { textAlign: "center", marginBottom: 24 },
  logo: { fontFamily: "Georgia,serif", fontStyle: "italic", fontSize: 40 },
  eyebrow: {
    marginTop: 8,
    fontSize: 11,
    letterSpacing: ".13em",
    textTransform: "uppercase",
    color: "#6b6a63",
  },
  card: {
    background: "white",
    border: "1px solid #dfe3e8",
    borderRadius: 12,
    padding: 22,
    boxShadow: "0 3px 12px #1720330b",
  },
  heading: { fontSize: 20, margin: "0 0 18px", fontWeight: 550 },
  subheading: { fontSize: 15, margin: 0 },
  form: { borderTop: "1px solid #e2e0d6", marginTop: 20, paddingTop: 18 },
  label: { display: "block", fontSize: 13, fontWeight: 600, margin: "12px 0" },
  input: {
    display: "block",
    boxSizing: "border-box",
    width: "100%",
    marginTop: 6,
    padding: 11,
    border: "1px solid #c5ccd4",
    borderRadius: 7,
    font: "inherit",
  },
  primary: {
    background: "#203c60",
    color: "white",
    border: 0,
    borderRadius: 7,
    padding: "10px 14px",
    font: "inherit",
    cursor: "pointer",
    minHeight: 42,
  },
  secondary: {
    background: "#f4f6f8",
    color: "#20252b",
    border: "1px solid #cbd2d9",
    borderRadius: 7,
    padding: "9px 12px",
    font: "inherit",
    cursor: "pointer",
    minHeight: 42,
  },
  note: { color: "#58616c", lineHeight: 1.45, fontSize: 13 },
  message: { margin: "16px 0 0", color: "#46505b", fontSize: 13 },
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 80,
    background: "#14141375",
    display: "grid",
    placeItems: "center",
    padding: 20,
  },
  pinDialog: {
    background: "white",
    borderRadius: 12,
    padding: 24,
    width: "min(100%, 420px)",
    boxShadow: "0 16px 48px #0003",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 18,
  },
};
