// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  bindRegisterSession: vi.fn(),
  createOfflineIdentityGrant: vi.fn(),
  createSupabaseClient: vi.fn(),
  reportUpdateSafety: vi.fn(),
}));

vi.mock("./database.js", () => ({ openOfflineDatabase: vi.fn() }));
vi.mock("./command-sync.ts", () => ({
  captureCommandBatch: vi.fn(),
  createDemoOrderBatch: vi.fn(),
  createSupabaseClient: mocks.createSupabaseClient,
  syncPendingCommandBatches: vi.fn(),
}));
vi.mock("../access/register-session.ts", () => ({
  bindRegisterSession: mocks.bindRegisterSession,
}));
vi.mock("../access/offline-identity.ts", () => ({
  assertOfflineGrantAllowsCapture: vi.fn(),
  createOfflineIdentityGrant: mocks.createOfflineIdentityGrant,
  parseOfflineIdentityGrant: (grant) => grant,
  unlockOfflineIdentity: vi.fn(),
}));
vi.mock("../pwa/update-safety.ts", () => ({
  reportUpdateSafety: mocks.reportUpdateSafety,
}));
vi.mock("../pwa/PwaUpdateControl.tsx", () => ({
  PwaUpdateControl: () => null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

it("does not repeat secure session binding after PIN enrollment and blocks updates while PIN data is unsaved", async () => {
  vi.stubEnv("VITE_KARMA_ACCESS_MODE", "secure");
  vi.stubEnv("VITE_KARMA_BRANCH_ID", "branch-test");
  vi.stubEnv("VITE_KARMA_DEVICE_ID", "device-test");

  const session = {
    user: { id: "actor-test", email: "actor@example.invalid" },
  };
  let signedIn = false;
  let getSessionCalls = 0;
  const query = {
    exec: async () => [],
    sort: () => query,
    $: { subscribe: () => ({ unsubscribe: vi.fn() }) },
  };
  const collection = { find: () => query };
  const database = {
    commandBatches: collection,
    syncReceipts: collection,
    syncBlocks: collection,
  };
  const client = {
    auth: {
      getSession: vi.fn(async () => {
        getSessionCalls += 1;
        return { data: { session: signedIn ? session : null }, error: null };
      }),
      signInWithPassword: vi.fn(async () => {
        signedIn = true;
        return { data: { session }, error: null };
      }),
      signOut: vi.fn(),
    },
  };
  const context = {
    userId: session.user.id,
    displayName: "Caja de prueba",
    role: "barra",
    branchId: "branch-test",
    deviceId: "device-test",
    sessionId: "session-test",
    capability: "cash_register",
    leaseId: "lease-test",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    verifiedAt: new Date().toISOString(),
  };

  const { openOfflineDatabase } = await import("./database.js");
  vi.mocked(openOfflineDatabase).mockResolvedValue(database);
  mocks.createSupabaseClient.mockResolvedValue(client);
  mocks.bindRegisterSession.mockImplementation(async () => ({
    ...context,
    sessionId: `session-${mocks.bindRegisterSession.mock.calls.length}`,
  }));
  mocks.createOfflineIdentityGrant.mockImplementation(async (verified) => ({
    ...verified,
    salt: "AAAAAAAAAAAAAAAAAAAAAA==",
    pinVerifier: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    pinIterations: 210_000,
    failedPinAttempts: 0,
    lockoutCount: 0,
    lockedUntil: null,
  }));
  const storage = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });

  const { OfflineSyncDemo } = await import("./main.jsx");
  const user = userEvent.setup();
  render(<OfflineSyncDemo />);

  await screen.findByRole("button", { name: "Iniciar sesión" });
  await user.clear(screen.getByLabelText("Correo"));
  await user.type(screen.getByLabelText("Correo"), session.user.email);
  await user.type(screen.getByLabelText("Contraseña"), "private-test-password");
  await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
  await screen.findByRole("button", { name: "Guardar PIN y abrir estación" });

  await user.type(screen.getByLabelText("Crear PIN offline"), "246810");
  expect(mocks.reportUpdateSafety).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: "blocked" }),
  );
  await user.type(screen.getByLabelText("Confirmar PIN offline"), "246810");
  await user.click(screen.getByRole("button", { name: "Guardar PIN y abrir estación" }));

  await screen.findByRole("button", { name: "Crear venta capturada" });
  await waitFor(() => expect(mocks.bindRegisterSession).toHaveBeenCalledTimes(1));
  expect(getSessionCalls).toBe(1);
  await user.click(screen.getByRole("button", { name: "Volver a verificar permiso" }));
  await waitFor(() => expect(mocks.bindRegisterSession).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(mocks.bindRegisterSession).toHaveBeenCalledTimes(2);
  expect(getSessionCalls).toBe(1);
});
