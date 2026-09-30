import { describe, expect, it, vi } from "vitest";
import {
  createProvisionHandler,
  deleteCreatedAuthUser,
  type ProvisionServices,
} from "./handler";

const allowedOrigin = "http://127.0.0.1:4179";
const serviceKey = "server-only-service-key-marker";
const temporaryPassword = "ONE-TIME-PASSWORD-marker";
const input = {
  branchId: "branch-allowed",
  email: "synthetic-person@example.invalid",
  displayName: "Persona sintética",
  role: "mesero",
  active: true,
};

function request(body: unknown = input, authorization = "Bearer owner-jwt") {
  return new Request(
    "https://example.invalid/functions/v1/owner-provision-user",
    {
      method: "POST",
      headers: {
        origin: allowedOrigin,
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function services(overrides: Partial<ProvisionServices> = {}) {
  return {
    allowedOrigin,
    resolveUser: vi.fn(async (token: string) =>
      token === "owner-jwt" ? "owner-auth-id" : null,
    ),
    isActiveOwner: vi.fn(
      async (userId: string, branchId: string) =>
        userId === "owner-auth-id" && branchId === "branch-allowed",
    ),
    createUser: vi.fn(async () => "new-auth-id"),
    assignMembership: vi.fn(async () => true),
    deleteUser: vi.fn(async () => {}),
    generateTemporaryPassword: vi.fn(() => temporaryPassword),
    ...overrides,
  } satisfies ProvisionServices;
}

describe("owner-provision-user handler", () => {
  it("propagates an Auth SDK deletion error without exposing its contents", async () => {
    const deleteUser = vi.fn(async () => ({
      error: new Error(`${serviceKey} ${temporaryPassword}`),
    }));

    await expect(
      deleteCreatedAuthUser({ auth: { admin: { deleteUser } } }, "new-auth-id"),
    ).rejects.toThrow("Account cleanup failed.");
    expect(deleteUser).toHaveBeenCalledWith("new-auth-id");
  });

  it("requires a verified caller JWT before resolving branch permissions", async () => {
    const deps = services();
    const response = await createProvisionHandler(deps)(request(input, ""));
    expect(response.status).toBe(401);
    expect(deps.resolveUser).not.toHaveBeenCalled();
    expect(deps.createUser).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "Barra",
      userId: "barista-auth-id",
      requestBranch: "branch-allowed",
      membership: {
        userId: "barista-auth-id",
        branchId: "branch-allowed",
        role: "barra",
        active: true,
      },
    },
    {
      label: "wrong branch",
      userId: "owner-auth-id",
      requestBranch: "branch-other",
      membership: {
        userId: "owner-auth-id",
        branchId: "branch-allowed",
        role: "duena",
        active: true,
      },
    },
    {
      label: "inactive Dueña",
      userId: "owner-auth-id",
      requestBranch: "branch-allowed",
      membership: {
        userId: "owner-auth-id",
        branchId: "branch-allowed",
        role: "duena",
        active: false,
      },
    },
  ])(
    "denies $label without creating a user or returning credentials",
    async (testCase) => {
      const deps = services({
        resolveUser: vi.fn(async () => testCase.userId),
        isActiveOwner: vi.fn(async (userId, branchId) => {
          const membership = testCase.membership;
          return (
            membership.userId === userId &&
            membership.branchId === branchId &&
            membership.role === "duena" &&
            membership.active
          );
        }),
      });
      const response = await createProvisionHandler(deps)(
        request({ ...input, branchId: testCase.requestBranch }),
      );
      const body = await response.text();
      expect(response.status).toBe(403);
      expect(deps.createUser).not.toHaveBeenCalled();
      expect(body).not.toContain(temporaryPassword);
      expect(body).not.toContain(serviceKey);
    },
  );

  it("creates and assigns an individual Auth identity only after active-owner verification", async () => {
    const deps = services();
    const response = await createProvisionHandler(deps)(request());
    expect(response.status).toBe(201);
    expect(deps.isActiveOwner).toHaveBeenCalledWith(
      "owner-auth-id",
      "branch-allowed",
    );
    expect(deps.createUser).toHaveBeenCalledWith(
      input.email,
      temporaryPassword,
    );
    expect(deps.assignMembership).toHaveBeenCalledWith(
      "owner-jwt",
      input,
      "new-auth-id",
    );
    expect(deps.deleteUser).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      userId: "new-auth-id",
      email: input.email,
      temporaryPassword,
    });
  });

  it("deletes the new synthetic identity if the caller-authorized membership RPC fails", async () => {
    const deps = services({ assignMembership: vi.fn(async () => false) });
    const response = await createProvisionHandler(deps)(request());
    const body = await response.text();
    expect(response.status).toBe(409);
    expect(deps.deleteUser).toHaveBeenCalledWith("new-auth-id");
    expect(body).not.toContain(temporaryPassword);
    expect(body).not.toContain(serviceKey);
  });

  it("reports unconfirmed cleanup without exposing the temporary password when Auth deletion fails", async () => {
    const deps = services({
      assignMembership: vi.fn(async () => false),
      deleteUser: vi.fn(async () => {
        throw new Error(`${serviceKey} ${temporaryPassword}`);
      }),
    });
    const response = await createProvisionHandler(deps)(request());
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("cleanup could not be confirmed");
    expect(body).not.toContain(temporaryPassword);
    expect(body).not.toContain(serviceKey);
    expect(deps.deleteUser).toHaveBeenCalledWith("new-auth-id");
  });

  it("does not expose dependency errors, service credentials, or generated passwords on failures", async () => {
    const deps = services({
      createUser: vi.fn(async () => {
        throw new Error(`${serviceKey} ${temporaryPassword}`);
      }),
    });
    const response = await createProvisionHandler(deps)(request());
    const body = await response.text();
    expect(response.status).toBe(409);
    expect(body).not.toContain(serviceKey);
    expect(body).not.toContain(temporaryPassword);
  });

  it("rejects an unconfigured or foreign browser origin", async () => {
    const unconfigured = await createProvisionHandler(
      services({ allowedOrigin: null }),
    )(request());
    const foreign = await createProvisionHandler(services())(
      new Request("https://example.invalid", {
        method: "POST",
        headers: {
          origin: "https://attacker.invalid",
          authorization: "Bearer owner-jwt",
        },
        body: JSON.stringify(input),
      }),
    );
    expect(unconfigured.status).toBe(503);
    expect(foreign.status).toBe(403);
  });
});
