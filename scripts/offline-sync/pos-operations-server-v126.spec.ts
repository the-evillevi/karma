import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import {
  replayPosOperations,
  type PosOperationCommand,
  type PosOperationLine,
  type PosOrderType,
} from "../../src/domain/pos-operations.ts";

function readLocalEnv(): Record<string, string> {
  const values: Record<string, string> = {};
  const allowedKeys = new Set([
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_OWNER_EMAIL",
    "SUPABASE_OWNER_PASSWORD",
    "SUPABASE_OWNER_TWO_EMAIL",
    "SUPABASE_OWNER_TWO_PASSWORD",
    "SUPABASE_CASHIER_EMAIL",
    "SUPABASE_CASHIER_PASSWORD",
    "SUPABASE_WAITER_EMAIL",
    "SUPABASE_WAITER_PASSWORD",
    "SUPABASE_BRANCH_ID",
    "SUPABASE_CASH_DEVICE_ID",
    "SUPABASE_PREP_DEVICE_ID",
  ]);
  if (!existsSync(".env.offline-test.local")) return values;
  for (const line of readFileSync(".env.offline-test.local", "utf8").split(
    /\r?\n/,
  )) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && allowedKeys.has(match[1]!)) values[match[1]!] = match[2]!;
  }
  return values;
}

const enabled = process.env.SUPABASE_V126_TESTS_ENABLED === "1";
const env: Record<string, string> = enabled ? readLocalEnv() : {};
if (enabled) {
  const requiredKeys = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_OWNER_EMAIL",
    "SUPABASE_OWNER_PASSWORD",
    "SUPABASE_OWNER_TWO_EMAIL",
    "SUPABASE_OWNER_TWO_PASSWORD",
    "SUPABASE_CASHIER_EMAIL",
    "SUPABASE_CASHIER_PASSWORD",
    "SUPABASE_WAITER_EMAIL",
    "SUPABASE_WAITER_PASSWORD",
    "SUPABASE_BRANCH_ID",
    "SUPABASE_CASH_DEVICE_ID",
    "SUPABASE_PREP_DEVICE_ID",
  ];
  const missing = requiredKeys.filter((key) => !env[key]);
  if (missing.length > 0)
    throw new Error(`Missing private POS test settings: ${missing.join(", ")}`);
}

type BoundSession = {
  session_id: string;
  lease_id: string;
};
type SignedIn = { client: SupabaseClient; actorId: string };

function makeClient(): SupabaseClient {
  return createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(
  kind: "OWNER" | "OWNER_TWO" | "CASHIER" | "WAITER",
): Promise<SignedIn> {
  const client = makeClient();
  const result = await client.auth.signInWithPassword({
    email: env[`SUPABASE_${kind}_EMAIL`]!,
    password: env[`SUPABASE_${kind}_PASSWORD`]!,
  });
  expect(result.error?.code ?? null).toBeNull();
  expect(typeof result.data.user?.id).toBe("string");
  return { client, actorId: result.data.user!.id };
}

async function bind(
  client: SupabaseClient,
  deviceId = env.SUPABASE_CASH_DEVICE_ID!,
): Promise<BoundSession> {
  const result = await client.rpc("bind_register_session", {
    p_branch_id: env.SUPABASE_BRANCH_ID!,
    p_device_id: deviceId,
  });
  expect(result.error?.code ?? null).toBeNull();
  const session = Array.isArray(result.data) ? result.data[0] : result.data;
  expect(typeof session?.session_id).toBe("string");
  expect(typeof session?.lease_id).toBe("string");
  return session as BoundSession;
}

function line(
  lineId: string,
  options: { quantity?: number; cents?: number } = {},
): PosOperationLine {
  const quantity = options.quantity ?? 1;
  const cents = options.cents ?? 1000;
  return {
    lineId,
    productId: null,
    nameSnapshot: `Producto de prueba ${lineId}`,
    quantity,
    currency: "MXN",
    baseUnitPriceCents: cents,
    modifierTotalCents: 0,
    unitPriceCents: cents,
    lineTotalCents: cents * quantity,
    priceEvidence: "prototype-captured",
    catalogPriceVersionId: null,
    modifiers: [],
    notes: null,
    tax: {
      currency: "MXN",
      evidence: "unknown",
      rateBasisPoints: null,
      amountCents: null,
      policyId: null,
    },
  };
}

function opened(
  actorId: string,
  orderId: string,
  deviceId: string,
  options: {
    orderType?: PosOrderType;
    tableId?: string | null;
    customer?: {
      name: string | null;
      phone: string | null;
      address: string | null;
    } | null;
    lines?: PosOperationLine[];
    commandId?: string;
  } = {},
): PosOperationCommand {
  const orderType = options.orderType ?? "mesa";
  const customer =
    options.customer === undefined
      ? orderType === "domicilio"
        ? {
            name: "Persona de prueba",
            phone: "TEST-ONLY",
            address: "Dirección de prueba",
          }
        : null
      : options.customer;
  return {
    schemaVersion: 1,
    commandId: options.commandId ?? `v126-${randomUUID()}`,
    branchId: env.SUPABASE_BRANCH_ID!,
    actorId,
    deviceId,
    occurredAt: new Date().toISOString(),
    expectedRevisions: [{ kind: "order", id: orderId, revision: 0 }],
    action: "order.opened",
    reason: null,
    payload: {
      orderId,
      orderType,
      tableId: options.tableId ?? null,
      customer,
      lines: options.lines ?? [line(`line-${randomUUID()}`)],
    },
  };
}

function lineAdded(
  actorId: string,
  deviceId: string,
  orderId: string,
  revision: number,
  added: PosOperationLine,
): PosOperationCommand {
  return {
    schemaVersion: 1,
    commandId: `v126-${randomUUID()}`,
    branchId: env.SUPABASE_BRANCH_ID!,
    actorId,
    deviceId,
    occurredAt: new Date().toISOString(),
    expectedRevisions: [{ kind: "order", id: orderId, revision }],
    action: "order.line-added",
    reason: null,
    payload: { orderId, line: added },
  };
}

function lineChanged(
  actorId: string,
  deviceId: string,
  orderId: string,
  revision: number,
  changed: PosOperationLine,
): PosOperationCommand {
  return {
    schemaVersion: 1,
    commandId: `v126-${randomUUID()}`,
    branchId: env.SUPABASE_BRANCH_ID!,
    actorId,
    deviceId,
    occurredAt: new Date().toISOString(),
    expectedRevisions: [{ kind: "order", id: orderId, revision }],
    action: "order.line-changed",
    reason: null,
    payload: { orderId, lineId: changed.lineId, line: changed },
  };
}

function lineRemoved(
  actorId: string,
  deviceId: string,
  orderId: string,
  revision: number,
  lineId: string,
): PosOperationCommand {
  return {
    schemaVersion: 1,
    commandId: `v126-${randomUUID()}`,
    branchId: env.SUPABASE_BRANCH_ID!,
    actorId,
    deviceId,
    occurredAt: new Date().toISOString(),
    expectedRevisions: [{ kind: "order", id: orderId, revision }],
    action: "order.line-removed",
    reason: null,
    payload: { orderId, lineId },
  };
}

function detailsChanged(
  actorId: string,
  deviceId: string,
  orderId: string,
  revision: number,
  tableId: string | null,
  customer?: {
    name: string | null;
    phone: string | null;
    address: string | null;
  } | null,
): PosOperationCommand {
  return {
    schemaVersion: 1,
    commandId: `v126-${randomUUID()}`,
    branchId: env.SUPABASE_BRANCH_ID!,
    actorId,
    deviceId,
    occurredAt: new Date().toISOString(),
    expectedRevisions: [{ kind: "order", id: orderId, revision }],
    action: "order.details-changed",
    reason: null,
    payload: {
      orderId,
      tableId,
      ...(customer === undefined ? {} : { customer }),
    },
  };
}

async function append(
  client: SupabaseClient,
  session: BoundSession,
  command: unknown,
  leaseId = session.lease_id,
) {
  return client.rpc("append_pos_operation_v1", {
    p_command: command,
    p_session_id: session.session_id,
    p_lease_id: leaseId,
  });
}

async function readOrders(
  client: SupabaseClient,
  session: BoundSession,
  after = 0,
  limit = 100,
) {
  return client.rpc("read_pos_open_orders_v1", {
    p_session_id: session.session_id,
    p_lease_id: session.lease_id,
    p_after_sequence: after,
    p_limit: limit,
  });
}

async function findVisibleOrder(
  client: SupabaseClient,
  session: BoundSession,
  orderId: string,
): Promise<Record<string, unknown> | undefined> {
  let cursor = 0;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const result = await readOrders(client, session, cursor, 100);
    expect(result.error?.code ?? null).toBeNull();
    const page = result.data?.[0];
    const orders = page?.orders as Array<Record<string, unknown>> | undefined;
    const found = orders?.find((order) => order.orderId === orderId);
    if (found) return found;
    const next = page?.server_cursor;
    if (orders?.length !== 100 || typeof next !== "number" || next <= cursor)
      return undefined;
    cursor = next;
  }
  return undefined;
}

function publicOrderView(order: {
  orderId: string;
  revision: number;
  status: string;
  orderType: string;
  tableId: string | null;
  customer: {
    name: string | null;
    phone: string | null;
    address: string | null;
  } | null;
  openedAt: string;
  lines: PosOperationLine[];
}) {
  return {
    orderId: order.orderId,
    revision: order.revision,
    status: order.status,
    orderType: order.orderType,
    tableId: order.tableId,
    customer: order.customer,
    openedAt: order.openedAt,
    lines: order.lines,
  };
}

test.describe("EVL-126 server order operations v1", () => {
  test.skip(
    !enabled,
    "Enable only after root review and apply of the new forward migration against the isolated karma-pos fixture.",
  );

  test("open, edits, and details match deterministic replay; identical retry keeps its acknowledgement", async () => {
    const owner = await signIn("OWNER");
    const session = await bind(owner.client);
    const orderId = `v126-order-${randomUUID()}`;
    const initial = opened(
      owner.actorId,
      orderId,
      env.SUPABASE_CASH_DEVICE_ID!,
      {
        orderType: "domicilio",
        tableId: null,
        lines: [line(`v126-line-${randomUUID()}`)],
      },
    );
    const commands: PosOperationCommand[] = [initial];
    const first = await append(owner.client, session, initial);
    expect(first.error?.code ?? null).toBeNull();
    expect(first.data?.[0]?.outcome).toBe("inserted");

    const addedLine = line(`v126-line-${randomUUID()}`, {
      quantity: 1,
      cents: 250,
    });
    const added = lineAdded(
      owner.actorId,
      env.SUPABASE_CASH_DEVICE_ID!,
      orderId,
      1,
      addedLine,
    );
    commands.push(added);
    const addResult = await append(owner.client, session, added);
    expect(addResult.error?.code ?? null).toBeNull();
    expect(addResult.data?.[0]?.outcome).toBe("inserted");

    const changedLine = line(addedLine.lineId, { quantity: 2, cents: 250 });
    const changed = lineChanged(
      owner.actorId,
      env.SUPABASE_CASH_DEVICE_ID!,
      orderId,
      2,
      changedLine,
    );
    commands.push(changed);
    const changeResult = await append(owner.client, session, changed);
    expect(changeResult.error?.code ?? null).toBeNull();

    const originalLineId =
      initial.action === "order.opened" ? initial.payload.lines[0]!.lineId : "";
    const removed = lineRemoved(
      owner.actorId,
      env.SUPABASE_CASH_DEVICE_ID!,
      orderId,
      3,
      originalLineId,
    );
    commands.push(removed);
    const removeResult = await append(owner.client, session, removed);
    expect(removeResult.error?.code ?? null).toBeNull();

    const changedCustomer = {
      name: "Entrega sintética actualizada",
      phone: "TEST-ONLY-2",
      address: "Calle de prueba actualizada",
    };
    const details = detailsChanged(
      owner.actorId,
      env.SUPABASE_CASH_DEVICE_ID!,
      orderId,
      4,
      "D-12",
      changedCustomer,
    );
    commands.push(details);
    const detailsResult = await append(owner.client, session, details);
    expect(detailsResult.error?.code ?? null).toBeNull();

    const replayed = replayPosOperations(
      {
        branchId: env.SUPABASE_BRANCH_ID!,
        deviceId: env.SUPABASE_CASH_DEVICE_ID!,
      },
      commands,
    );
    const expected = replayed.orders.find(
      (order) => order.orderId === orderId,
    )!;
    const actual = await findVisibleOrder(owner.client, session, orderId);
    expect(actual).toEqual(publicOrderView(expected));
    expect(expected.revision).toBe(5);
    expect(expected.lines).toHaveLength(1);
    expect(expected.customer).toEqual(changedCustomer);

    const retry = await append(owner.client, session, initial);
    expect(retry.error?.code ?? null).toBeNull();
    expect(retry.data?.[0]?.outcome).toBe("identical-retry");
    expect(retry.data?.[0]?.server_sequence).toBe(
      first.data?.[0]?.server_sequence,
    );
    expect(retry.data?.[0]?.received_at).toBe(first.data?.[0]?.received_at);

    const changedRetry = structuredClone(initial);
    if (changedRetry.action === "order.opened")
      changedRetry.payload.tableId = "DIFFERENT";
    const conflict = await append(owner.client, session, changedRetry);
    expect(conflict.error?.code).toBe("23505");
  });

  test("rechecks current authority before exact retry and excludes session from command identity", async () => {
    const owner = await signIn("OWNER");
    const firstSession = await bind(owner.client);
    const command = opened(
      owner.actorId,
      `v126-order-${randomUUID()}`,
      env.SUPABASE_CASH_DEVICE_ID!,
    );
    const inserted = await append(owner.client, firstSession, command);
    expect(inserted.error?.code ?? null).toBeNull();

    const renewedSession = await bind(owner.client);
    expect(renewedSession.session_id).not.toBe(firstSession.session_id);
    const renewedRetry = await append(owner.client, renewedSession, command);
    expect(renewedRetry.error?.code ?? null).toBeNull();
    expect(renewedRetry.data?.[0]?.outcome).toBe("identical-retry");
    expect(renewedRetry.data?.[0]?.server_sequence).toBe(
      inserted.data?.[0]?.server_sequence,
    );

    const secondOwner = await signIn("OWNER_TWO");
    await bind(secondOwner.client);
    const revokedSessionRetry = await append(
      owner.client,
      renewedSession,
      command,
    );
    expect(revokedSessionRetry.error?.code).toBe("42501");
  });

  test("enforces role/capability, actor scope, unsupported actions, contacts, and price provenance", async () => {
    const owner = await signIn("OWNER");
    const session = await bind(owner.client);
    const deviceId = env.SUPABASE_CASH_DEVICE_ID!;
    const base = opened(owner.actorId, `v126-order-${randomUUID()}`, deviceId);

    const anonymous = makeClient();
    const anonymousResult = await append(anonymous, session, base);
    expect(anonymousResult.error?.code).toBe("42501");

    const forgedActor = structuredClone(base);
    forgedActor.actorId = randomUUID();
    expect((await append(owner.client, session, forgedActor)).error?.code).toBe(
      "42501",
    );

    const forgedBranch = structuredClone(base);
    forgedBranch.branchId = `other-${randomUUID()}`;
    expect(
      (await append(owner.client, session, forgedBranch)).error?.code,
    ).toBe("42501");

    const unsupported = structuredClone(base) as unknown as Record<
      string,
      unknown
    >;
    unsupported.action = "order.discounted";
    expect((await append(owner.client, session, unsupported)).error?.code).toBe(
      "0A000",
    );
    for (const action of [
      "preparation.sent",
      "preparation.transitioned",
      "preparation.cancelled",
      "order.cancelled",
      "order.split",
      "order.checked-out",
      "sale.refunded",
    ]) {
      const unsupportedFamily = structuredClone(base) as unknown as Record<
        string,
        unknown
      >;
      unsupportedFamily.action = action;
      expect(
        (await append(owner.client, session, unsupportedFamily)).error?.code,
      ).toBe("0A000");
    }

    const extraField = structuredClone(base) as unknown as Record<
      string,
      unknown
    >;
    extraField.role = "duena";
    expect((await append(owner.client, session, extraField)).error?.code).toBe(
      "22023",
    );

    const missingRequiredField = structuredClone(base);
    if (missingRequiredField.action === "order.opened")
      delete (
        missingRequiredField.payload as unknown as Record<string, unknown>
      ).tableId;
    expect(
      (await append(owner.client, session, missingRequiredField)).error?.code,
    ).toBe("22023");

    const detailsWithoutChange = detailsChanged(
      owner.actorId,
      deviceId,
      `v126-order-${randomUUID()}`,
      1,
      null,
    );
    if (detailsWithoutChange.action === "order.details-changed")
      delete (detailsWithoutChange.payload as Record<string, unknown>).tableId;
    expect(
      (await append(owner.client, session, detailsWithoutChange)).error?.code,
    ).toBe("22023");

    const detailsWithExtraField = detailsChanged(
      owner.actorId,
      deviceId,
      `v126-order-${randomUUID()}`,
      1,
      null,
    );
    if (detailsWithExtraField.action === "order.details-changed")
      (detailsWithExtraField.payload as Record<string, unknown>).projection =
        {};
    expect(
      (await append(owner.client, session, detailsWithExtraField)).error?.code,
    ).toBe("22023");

    const catalogClaim = structuredClone(base);
    if (catalogClaim.action === "order.opened") {
      catalogClaim.payload.lines[0]!.priceEvidence = "catalog-versioned";
      catalogClaim.payload.lines[0]!.catalogPriceVersionId = "invented-version";
    }
    expect(
      (await append(owner.client, session, catalogClaim)).error?.code,
    ).toBe("22023");

    const nonMx = structuredClone(base);
    if (nonMx.action === "order.opened")
      nonMx.payload.lines[0]!.currency = "USD" as "MXN";
    expect((await append(owner.client, session, nonMx)).error?.code).toBe(
      "22023",
    );

    const fractional = structuredClone(base);
    if (fractional.action === "order.opened")
      fractional.payload.lines[0]!.unitPriceCents = 1.5;
    expect((await append(owner.client, session, fractional)).error?.code).toBe(
      "22023",
    );

    for (const timestamp of [
      "2026-09-30T24:00:00.000Z",
      "2026-09-30T23:59:60.000Z",
      "2026-02-30T12:00:00.000Z",
    ]) {
      const nonCanonicalTime = structuredClone(base);
      nonCanonicalTime.occurredAt = timestamp;
      expect(
        (await append(owner.client, session, nonCanonicalTime)).error?.code,
      ).toBe("22023");
    }
    const validAfterRejectedPayload = await append(owner.client, session, base);
    expect(validAfterRejectedPayload.error?.code ?? null).toBeNull();
    expect(validAfterRejectedPayload.data?.[0]?.outcome).toBe("inserted");

    const invalidDelivery = opened(
      owner.actorId,
      `v126-order-${randomUUID()}`,
      deviceId,
      {
        orderType: "domicilio",
        customer: { name: "Cliente", phone: "TEST-ONLY", address: null },
      },
    );
    expect(
      (await append(owner.client, session, invalidDelivery)).error?.code,
    ).toBe("22023");

    const prepOnly = await signIn("WAITER");
    const prepSession = await bind(
      prepOnly.client,
      env.SUPABASE_PREP_DEVICE_ID!,
    );
    const prepOrder = opened(
      prepOnly.actorId,
      `v126-order-${randomUUID()}`,
      env.SUPABASE_PREP_DEVICE_ID!,
    );
    expect(
      (await append(prepOnly.client, prepSession, prepOrder)).error?.code,
    ).toBe("42501");
    expect((await readOrders(prepOnly.client, prepSession)).error?.code).toBe(
      "42501",
    );
  });

  test("allows every reviewed openOrder role on a cash register", async () => {
    const deviceId = env.SUPABASE_CASH_DEVICE_ID!;
    for (const kind of ["OWNER", "CASHIER", "WAITER"] as const) {
      const staff = await signIn(kind);
      const session = await bind(staff.client, deviceId);
      const command = opened(
        staff.actorId,
        `v126-order-${randomUUID()}`,
        deviceId,
      );
      const result = await append(staff.client, session, command);
      expect(result.error?.code ?? null).toBeNull();
      expect(result.data?.[0]?.outcome).toBe("inserted");
    }

    const owner = await signIn("OWNER");
    const waiter = await signIn("WAITER");
    async function setWaiterRole(role: "barra" | "mesero") {
      const result = await owner.client.rpc("manage_branch_membership", {
        p_branch_id: env.SUPABASE_BRANCH_ID!,
        p_user_id: waiter.actorId,
        p_display_name:
          role === "barra" ? "Barra sintética" : "Mesero sintético",
        p_role: role,
        p_active: true,
      });
      expect(result.error?.code ?? null).toBeNull();
    }

    await setWaiterRole("barra");
    try {
      const barSession = await bind(waiter.client, deviceId);
      const command = opened(
        waiter.actorId,
        `v126-order-${randomUUID()}`,
        deviceId,
      );
      const result = await append(waiter.client, barSession, command);
      expect(result.error?.code ?? null).toBeNull();
      expect(result.data?.[0]?.outcome).toBe("inserted");
    } finally {
      await setWaiterRole("mesero");
    }
  });

  test("serializes concurrent stale revisions with one commit and one conflict", async () => {
    const owner = await signIn("OWNER");
    const session = await bind(owner.client);
    const deviceId = env.SUPABASE_CASH_DEVICE_ID!;
    const orderId = `v126-order-${randomUUID()}`;
    const initial = opened(owner.actorId, orderId, deviceId);
    const created = await append(owner.client, session, initial);
    expect(created.error?.code ?? null).toBeNull();

    const first = detailsChanged(
      owner.actorId,
      deviceId,
      orderId,
      1,
      "TABLE-A",
    );
    const second = detailsChanged(
      owner.actorId,
      deviceId,
      orderId,
      1,
      "TABLE-B",
    );
    const results = await Promise.all([
      append(owner.client, session, first),
      append(owner.client, session, second),
    ]);
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    expect(
      results.filter((result) => result.error?.code === "40001"),
    ).toHaveLength(1);
    const persisted = await findVisibleOrder(owner.client, session, orderId);
    expect(persisted?.revision).toBe(2);
    expect(["TABLE-A", "TABLE-B"]).toContain(persisted?.tableId);
  });

  test("continues the live cursor across an order appended during pagination", async () => {
    const owner = await signIn("OWNER");
    const session = await bind(owner.client);
    const firstPage = await readOrders(owner.client, session, 0, 1);
    expect(firstPage.error?.code ?? null).toBeNull();
    expect(firstPage.data?.[0]).toBeDefined();
    let cursor = firstPage.data![0]!.server_cursor as number;

    const orderId = `v126-order-${randomUUID()}`;
    const command = opened(
      owner.actorId,
      orderId,
      env.SUPABASE_CASH_DEVICE_ID!,
    );
    const [write, racingPage] = await Promise.all([
      append(owner.client, session, command),
      readOrders(owner.client, session, cursor, 1),
    ]);
    expect(write.error?.code ?? null).toBeNull();
    expect(racingPage.error?.code ?? null).toBeNull();

    const firstRacingResult = racingPage.data?.[0];
    expect(firstRacingResult).toBeDefined();
    let orders = firstRacingResult?.orders as
      Array<Record<string, unknown>> | undefined;
    let observed = orders?.some((order) => order.orderId === orderId) ?? false;
    cursor = firstRacingResult!.server_cursor as number;

    for (let pageNumber = 0; pageNumber < 100 && !observed; pageNumber += 1) {
      const nextPage = await readOrders(owner.client, session, cursor, 1);
      expect(nextPage.error?.code ?? null).toBeNull();
      const result = nextPage.data?.[0];
      expect(result).toBeDefined();
      orders = result?.orders as Array<Record<string, unknown>> | undefined;
      observed = orders?.some((order) => order.orderId === orderId) ?? false;
      const nextCursor = result!.server_cursor as number;
      expect(nextCursor).toBeGreaterThanOrEqual(cursor);
      cursor = nextCursor;
    }
    expect(observed).toBe(true);
  });

  test("scopes ordinary reads to the creator", async () => {
    const cashier = await signIn("CASHIER");
    const cashierSession = await bind(cashier.client);
    const cashierOrderId = `v126-order-${randomUUID()}`;
    const cashierCommand = opened(
      cashier.actorId,
      cashierOrderId,
      env.SUPABASE_CASH_DEVICE_ID!,
    );
    expect(
      (await append(cashier.client, cashierSession, cashierCommand)).error
        ?.code ?? null,
    ).toBeNull();

    const waiter = await signIn("WAITER");
    const waiterSession = await bind(waiter.client);
    const waiterOrderId = `v126-order-${randomUUID()}`;
    const waiterCommand = opened(
      waiter.actorId,
      waiterOrderId,
      env.SUPABASE_CASH_DEVICE_ID!,
    );
    expect(
      (await append(waiter.client, waiterSession, waiterCommand)).error?.code ??
        null,
    ).toBeNull();

    const waiterOwnOrder = await findVisibleOrder(
      waiter.client,
      waiterSession,
      waiterOrderId,
    );
    const waiterCannotSeeCashierOrder = await findVisibleOrder(
      waiter.client,
      waiterSession,
      cashierOrderId,
    );
    expect(waiterOwnOrder).toBeDefined();
    expect(waiterCannotSeeCashierOrder).toBeUndefined();
    expect(Object.hasOwn(waiterOwnOrder ?? {}, "history")).toBe(false);
    expect(Object.hasOwn(waiterOwnOrder ?? {}, "createdByActorId")).toBe(false);

    const owner = await signIn("OWNER");
    const ownerSession = await bind(owner.client);
    expect(
      await findVisibleOrder(owner.client, ownerSession, waiterOrderId),
    ).toBeDefined();
    expect(
      await findVisibleOrder(owner.client, ownerSession, cashierOrderId),
    ).toBeDefined();
  });

  test("known membership revocation prevents an exact retry and is restored for the fixture", async () => {
    const waiter = await signIn("WAITER");
    const waiterSession = await bind(waiter.client);
    const deviceId = env.SUPABASE_CASH_DEVICE_ID!;
    const command = opened(
      waiter.actorId,
      `v126-order-${randomUUID()}`,
      deviceId,
    );
    const accepted = await append(waiter.client, waiterSession, command);
    expect(accepted.error?.code ?? null).toBeNull();

    const owner = await signIn("OWNER");
    async function setWaiterActive(active: boolean) {
      const result = await owner.client.rpc("manage_branch_membership", {
        p_branch_id: env.SUPABASE_BRANCH_ID!,
        p_user_id: waiter.actorId,
        p_display_name: "Mesero sintético",
        p_role: "mesero",
        p_active: active,
      });
      expect(result.error?.code ?? null).toBeNull();
    }

    await setWaiterActive(false);
    try {
      expect(
        (await append(waiter.client, waiterSession, command)).error?.code,
      ).toBe("42501");
    } finally {
      await setWaiterActive(true);
    }
  });
});
