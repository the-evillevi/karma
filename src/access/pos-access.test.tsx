// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  usePosAccess,
  type PosAccessOptions,
  type PosAccessState,
} from "./pos-access";

let current: PosAccessState;
let storage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
};

function installMemoryStorage() {
  const values = new Map<string, string>();
  storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(String(key), String(value));
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
}

function Harness({ options }: { options: PosAccessOptions }) {
  current = usePosAccess(options);
  return (
    <>
      {current.accessScreen}
      <div>{current.accessControls}</div>
      <output data-testid="active-user">
        {current.context?.userId ?? "none"}
      </output>
    </>
  );
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: online,
  });
}

function fakeOfflineGrant(userId = "cached-owner") {
  const verifiedAt = new Date().toISOString();
  return {
    userId,
    displayName: "Cuenta cacheada",
    role: "duena",
    branchId: "branch-a",
    deviceId: "register-a",
    sessionId: "session-cached",
    capability: "cash_register",
    leaseId: "lease-cached",
    verifiedAt,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    salt: `${"A".repeat(22)}==`,
    pinVerifier: `${"A".repeat(43)}=`,
    pinIterations: 210_000,
    failedPinAttempts: 0,
    lockoutCount: 0,
    lockedUntil: null,
  };
}

function serverContext(userId = "owner-online") {
  return {
    session_id: "session-online",
    branch_id: "branch-a",
    device_id: "register-a",
    actor_id: userId,
    display_name: "Dueña Online",
    role: "duena",
    capability: "cash_register",
    lease_id: "lease-online",
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  };
}

type MockSession = { user: { id: string } };
type MockRpcResponse = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};
type MockClientOptions = {
  session?: MockSession | null;
  signIn?: () => Promise<{
    data: { session: MockSession | null };
    error: { message?: string } | null;
  }>;
  rpc?: (name: string, args?: unknown) => Promise<MockRpcResponse>;
};

function client({ session = null, signIn, rpc }: MockClientOptions = {}) {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      signInWithPassword: vi.fn(
        signIn ??
          (async () => ({
            data: { session: null },
            error: { message: "invalid" },
          })),
      ),
      signOut: vi.fn(async () => ({ error: null })),
    },
    rpc: vi.fn(rpc ?? (async () => ({ data: [serverContext()], error: null }))),
    functions: {
      invoke: vi.fn<
        (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>
      >(async () => ({ data: null, error: null })),
    },
  };
}

function options(supabase: ReturnType<typeof client>): PosAccessOptions {
  return {
    mode: "secure",
    branchId: "branch-a",
    deviceId: "register-a",
    createClient: async () => supabase as unknown as SupabaseClient,
  };
}

beforeEach(installMemoryStorage);
afterEach(() => {
  cleanup();
  storage.clear();
  setOnline(true);
  vi.restoreAllMocks();
});

describe("secure access session lifecycle", () => {
  it("does not allow a saved owner PIN to unlock while online, even if the offline form was already open", async () => {
    setOnline(false);
    const supabase = client();
    const rosterKey = "karma-evl118-pos-identities:branch-a:register-a";
    localStorage.setItem(rosterKey, JSON.stringify([fakeOfflineGrant()]));
    render(<Harness options={options(supabase)} />);
    const pinField = await screen.findByLabelText("PIN offline");
    fireEvent.change(screen.getByLabelText("Persona"), {
      target: { value: "cached-owner" },
    });
    fireEvent.change(pinField, { target: { value: "123456" } });

    setOnline(true);
    fireEvent.submit(pinField.closest("form")!);

    expect(
      await screen.findByText(
        /PIN offline solo se puede usar cuando este dispositivo no tiene conexión/,
      ),
    ).toBeTruthy();
    expect(current.context).toBeNull();
    expect(screen.getByTestId("active-user").textContent).toBe("none");
    expect(JSON.parse(localStorage.getItem(rosterKey)!)).toHaveLength(1);
  });

  it("purges a cached grant after the server rejects that identity online", async () => {
    setOnline(true);
    const rosterKey = "karma-evl118-pos-identities:branch-a:register-a";
    localStorage.setItem(
      rosterKey,
      JSON.stringify([fakeOfflineGrant("cached-owner")]),
    );
    const supabase = client({
      signIn: async () => ({
        data: { session: { user: { id: "cached-owner" } } },
        error: null,
      }),
      rpc: async () => ({
        data: null,
        error: { code: "42501", message: "private server error" },
      }),
    });
    render(<Harness options={options(supabase)} />);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Iniciar sesión con Supabase" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("Correo de la cuenta Supabase"), {
      target: { value: "owner@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "private-password" },
    });
    fireEvent.submit(
      screen.getByLabelText("Correo de la cuenta Supabase").closest("form")!,
    );

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(rosterKey)!)).toEqual([]),
    );
    expect(current.context).toBeNull();
    expect(screen.getByTestId("active-user").textContent).toBe("none");
    expect(
      screen.getByText(/servidor no confirmó una autorización activa/),
    ).toBeTruthy();
  });

  it("keeps the owner for validation errors but purges cached authority after a member RPC denial", async () => {
    setOnline(true);
    const rosterKey = "karma-evl118-pos-identities:branch-a:register-a";
    localStorage.setItem(
      rosterKey,
      JSON.stringify([fakeOfflineGrant("owner-online")]),
    );
    let membershipError: { code: string; message: string } = {
      code: "22023",
      message: "validation detail",
    };
    const supabase = client({
      signIn: async () => ({
        data: { session: { user: { id: "owner-online" } } },
        error: null,
      }),
      rpc: async (name: string) => {
        if (name === "bind_register_session")
          return { data: [serverContext()], error: null };
        if (name === "manage_branch_membership")
          return { data: null, error: membershipError };
        return { data: [], error: null };
      },
    });
    render(<Harness options={options(supabase)} />);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Iniciar sesión con Supabase" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("Correo de la cuenta Supabase"), {
      target: { value: "owner@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "private-password" },
    });
    fireEvent.submit(
      screen.getByLabelText("Correo de la cuenta Supabase").closest("form")!,
    );
    await waitFor(() => expect(current.context?.userId).toBe("owner-online"));

    const member = {
      userId: "new-member",
      displayName: "Barra",
      role: "barra" as const,
      active: true,
    };
    await expect(current.onManageMember(member)).rejects.toMatchObject({
      code: "22023",
    });
    expect(current.context?.userId).toBe("owner-online");
    expect(JSON.parse(localStorage.getItem(rosterKey)!)).toHaveLength(1);

    membershipError = { code: "42501", message: "private denial details" };
    await expect(current.onManageMember(member)).rejects.toMatchObject({
      code: "AUTHORIZATION_UNAVAILABLE",
    });
    await waitFor(() => expect(current.context).toBeNull());
    expect(JSON.parse(localStorage.getItem(rosterKey)!)).toEqual([]);
    expect(screen.getByTestId("active-user").textContent).toBe("none");
  });

  it("closes a cached owner grant when the provisioning endpoint returns 403", async () => {
    setOnline(true);
    const rosterKey = "karma-evl118-pos-identities:branch-a:register-a";
    localStorage.setItem(
      rosterKey,
      JSON.stringify([fakeOfflineGrant("owner-online")]),
    );
    const supabase = client({
      signIn: async () => ({
        data: { session: { user: { id: "owner-online" } } },
        error: null,
      }),
      rpc: async (name: string) =>
        name === "bind_register_session"
          ? { data: [serverContext()], error: null }
          : { data: [], error: null },
    });
    supabase.functions.invoke.mockResolvedValue({
      data: null,
      error: { message: "private response", context: { status: 403 } },
    });
    render(<Harness options={options(supabase)} />);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Iniciar sesión con Supabase" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("Correo de la cuenta Supabase"), {
      target: { value: "owner@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "private-password" },
    });
    fireEvent.submit(
      screen.getByLabelText("Correo de la cuenta Supabase").closest("form")!,
    );
    await waitFor(() => expect(current.context?.userId).toBe("owner-online"));

    await expect(
      current.onCreateMember({
        email: "barista@example.invalid",
        displayName: "Barra",
        role: "barra",
        active: true,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_UNAVAILABLE" });
    await waitFor(() => expect(current.context).toBeNull());
    expect(JSON.parse(localStorage.getItem(rosterKey)!)).toEqual([]);
  });

  it("does not restore a pending owner bind after the owner switches identity", async () => {
    setOnline(true);
    let resolveBind!: (result: MockRpcResponse) => void;
    const pendingBind = new Promise<MockRpcResponse>((resolve) => {
      resolveBind = resolve;
    });
    const supabase = client({
      signIn: async () => ({
        data: { session: { user: { id: "owner-online" } } },
        error: null,
      }),
      rpc: () => pendingBind,
    });
    render(<Harness options={options(supabase)} />);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Iniciar sesión con Supabase" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("Correo de la cuenta Supabase"), {
      target: { value: "owner@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "private-password" },
    });
    fireEvent.submit(
      screen.getByLabelText("Correo de la cuenta Supabase").closest("form")!,
    );
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledOnce());

    act(() => current.switchIdentity());
    resolveBind({ data: [serverContext()], error: null });
    await waitFor(() => expect(current.context).toBeNull());
    expect(screen.getByTestId("active-user").textContent).toBe("none");
    expect(screen.getByText("Acceso individual verificado")).toBeTruthy();
  });

  it("keeps online verification active when local PIN persistence fails", async () => {
    setOnline(true);
    const supabase = client({
      signIn: async () => ({
        data: { session: { user: { id: "owner-online" } } },
        error: null,
      }),
    });
    render(<Harness options={options(supabase)} />);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Iniciar sesión con Supabase" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("Correo de la cuenta Supabase"), {
      target: { value: "owner@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "private-password" },
    });
    fireEvent.submit(
      screen.getByLabelText("Correo de la cuenta Supabase").closest("form")!,
    );
    await waitFor(() => expect(current.context?.userId).toBe("owner-online"));
    fireEvent.click(
      screen.getByRole("button", { name: "Configurar PIN offline" }),
    );
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    fireEvent.change(screen.getByLabelText("PIN de seis a ocho dígitos"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("Confirma el PIN"), {
      target: { value: "123456" },
    });
    fireEvent.submit(
      screen.getByLabelText("PIN de seis a ocho dígitos").closest("form")!,
    );

    expect(
      await screen.findByText(/No se pudo guardar el PIN en este dispositivo/),
    ).toBeTruthy();
    expect(current.context?.userId).toBe("owner-online");
    expect(screen.queryByText(/PIN guardado para esta identidad/)).toBeNull();
  });
});
