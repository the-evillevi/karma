import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPosOperation,
  createPosOperationsState,
  PosOperationError,
  PosOperationRevisionConflict,
  replayPosOperations,
  validatePosOperationCommand,
  type PosOperationAuthority,
  type PosOperationCommand,
  type PosOperationLine,
  type PosOperationsScope,
} from "./pos-operations.ts";

const scope: PosOperationsScope = {
  branchId: "branch-1",
  deviceId: "register-1",
};

const owner: PosOperationAuthority = {
  ...scope,
  actorId: "owner-1",
  role: "duena",
  capabilities: [
    "openOrder",
    "checkout",
    "cancelWithReason",
    "cancelPreparationWithReason",
    "discountWithReason",
    "prepareOrder",
    "splitAccount",
    "refundSaleWithReason",
  ],
};

const capturedLine = (
  lineId = "line-1",
  overrides: Partial<PosOperationLine> = {},
): PosOperationLine => ({
  lineId,
  productId: "product-1",
  nameSnapshot: "Americano",
  quantity: 1,
  currency: "MXN",
  baseUnitPriceCents: 6000,
  modifierTotalCents: 0,
  unitPriceCents: 6000,
  lineTotalCents: 6000,
  priceEvidence: "prototype-captured",
  catalogPriceVersionId: null,
  modifiers: [
    {
      groupId: "milk",
      optionId: "oat",
      nameSnapshot: "Avena",
      quantity: 1,
      unit: null,
      priceEffectCents: 0,
    },
  ],
  notes: null,
  tax: {
    currency: "MXN",
    evidence: "unknown",
    rateBasisPoints: null,
    amountCents: null,
    policyId: null,
  },
  ...overrides,
});

function openCommand(
  overrides: Partial<
    Extract<PosOperationCommand, { action: "order.opened" }>
  > = {},
): Extract<PosOperationCommand, { action: "order.opened" }> {
  return {
    schemaVersion: 1,
    commandId: "open-command-1",
    branchId: scope.branchId,
    actorId: owner.actorId,
    deviceId: scope.deviceId,
    occurredAt: "2026-09-30T12:00:00.000Z",
    expectedRevisions: [{ kind: "order", id: "order-1", revision: 0 }],
    action: "order.opened",
    reason: null,
    payload: {
      orderId: "order-1",
      orderType: "mesa",
      tableId: "table-4",
      customer: null,
      lines: [capturedLine()],
    },
    ...overrides,
  };
}

function lineAddedCommand(
  overrides: Partial<
    Extract<PosOperationCommand, { action: "order.line-added" }>
  > = {},
): Extract<PosOperationCommand, { action: "order.line-added" }> {
  return {
    schemaVersion: 1,
    commandId: "line-added-1",
    branchId: scope.branchId,
    actorId: "cashier-1",
    deviceId: scope.deviceId,
    occurredAt: "2026-09-30T12:01:00.000Z",
    expectedRevisions: [{ kind: "order", id: "order-1", revision: 1 }],
    action: "order.line-added",
    reason: null,
    payload: { orderId: "order-1", line: capturedLine("line-2") },
    ...overrides,
  };
}

test("opens a scoped account with captured table, actor and explicitly unknown tax facts", () => {
  const result = applyPosOperation(
    createPosOperationsState(scope),
    openCommand(),
    owner,
  );
  assert.equal(result.duplicate, false);
  assert.deepEqual(result.state.orders[0], {
    orderId: "order-1",
    revision: 1,
    status: "open",
    orderType: "mesa",
    tableId: "table-4",
    customer: null,
    createdByActorId: "owner-1",
    openedAt: "2026-09-30T12:00:00.000Z",
    lines: [capturedLine()],
    discounts: [],
    preparationId: null,
    splitFrom: null,
    history: [
      {
        commandId: "open-command-1",
        action: "order.opened",
        actorId: "owner-1",
        occurredAt: "2026-09-30T12:00:00.000Z",
        reason: null,
      },
    ],
    closedAt: null,
    cancellationReason: null,
    cancelledByActorId: null,
  });
});

test("delivery orders preserve the original five POS types and require contact facts", () => {
  for (const orderType of ["local", "mesa", "llevar", "recoger"] as const) {
    const command = openCommand({
      commandId: `open-${orderType}`,
      payload: {
        orderId: `order-${orderType}`,
        orderType,
        tableId: null,
        customer: null,
        lines: [capturedLine()],
      },
      expectedRevisions: [
        { kind: "order", id: `order-${orderType}`, revision: 0 },
      ],
    });
    assert.equal(validatePosOperationCommand(command).action, "order.opened");
  }
  const delivery = openCommand({
    payload: {
      orderId: "delivery-1",
      orderType: "DOMICILIO",
      tableId: null,
      customer: { name: "Ana", phone: "5551234", address: "Centro 1" },
      lines: [capturedLine()],
    },
    expectedRevisions: [{ kind: "order", id: "delivery-1", revision: 0 }],
  });
  const opened = applyPosOperation(
    createPosOperationsState(scope),
    delivery,
    owner,
  ).state.orders[0]!;
  assert.equal(opened.orderType, "DOMICILIO");
  assert.deepEqual(opened.customer, {
    name: "Ana",
    phone: "5551234",
    address: "Centro 1",
  });
  assert.throws(
    () =>
      validatePosOperationCommand({
        ...delivery,
        payload: {
          ...delivery.payload,
          customer: { name: "Ana", phone: null, address: null },
        },
      }),
    /delivery customer.phone/,
  );
});

test("strict field allowlists reject price, discount, credentials and session data escaping its action", () => {
  const invalid = [
    { ...openCommand(), accessToken: "secret" },
    {
      ...openCommand(),
      payload: { ...openCommand().payload, discountCents: 100 },
    },
    {
      ...openCommand(),
      payload: {
        ...openCommand().payload,
        lines: [capturedLine("line-1", { currency: "USD" } as never)],
      },
    },
    {
      ...openCommand(),
      payload: {
        ...openCommand().payload,
        lines: [capturedLine("line-1", { catalogPriceVersionId: "invented" })],
      },
    },
    {
      ...openCommand(),
      payload: {
        ...openCommand().payload,
        customerId: "external-customer-1",
      } as never,
    },
  ];
  for (const command of invalid)
    assert.throws(() => validatePosOperationCommand(command));
  assert.throws(
    () =>
      validatePosOperationCommand({
        ...openCommand(),
        action: "inventory.adjusted",
      }),
    { code: "UNSUPPORTED_OPERATION_ACTION" },
  );
});

test("line appends use guarded revisions, preserve creator, and retain original actor", () => {
  const opened = applyPosOperation(
    createPosOperationsState(scope),
    openCommand(),
    owner,
  ).state;
  const cashier: PosOperationAuthority = {
    ...scope,
    actorId: "cashier-1",
    role: "barra",
    capabilities: ["openOrder"],
  };
  const command = lineAddedCommand();
  const added = applyPosOperation(opened, command, cashier).state;
  assert.equal(added.orders[0]?.revision, 2);
  assert.equal(added.orders[0]?.createdByActorId, "owner-1");
  assert.equal(added.orders[0]?.history[1]?.actorId, "cashier-1");
  assert.equal(added.orders[0]?.lines.length, 2);
  assert.throws(
    () =>
      applyPosOperation(
        opened,
        lineAddedCommand({
          expectedRevisions: [{ kind: "order", id: "order-1", revision: 0 }],
        }),
        cashier,
      ),
    PosOperationRevisionConflict,
  );
  assert.equal(opened.orders[0]?.revision, 1);
  assert.equal(opened.orders[0]?.lines.length, 1);
});

test("full command identity conflicts on retry and current authority is checked before retry", () => {
  const initial = createPosOperationsState(scope);
  const opened = applyPosOperation(initial, openCommand(), owner).state;
  const identical = applyPosOperation(opened, openCommand(), owner);
  assert.equal(identical.duplicate, true);
  assert.deepEqual(identical.state, opened);

  const changed = openCommand({
    payload: { ...openCommand().payload, tableId: "table-5" },
  });
  assert.throws(() => applyPosOperation(opened, changed, owner), {
    code: "OPERATION_COMMAND_ID_CONFLICT",
  });

  const revoked = { ...owner, capabilities: [] };
  assert.throws(() => applyPosOperation(opened, openCommand(), revoked), {
    code: "OPERATION_CAPABILITY_DENIED",
  });
  assert.throws(
    () =>
      applyPosOperation(initial, openCommand(), {
        ...owner,
        actorId: "another-actor",
      }),
    { code: "OPERATION_AUTHORITY_MISMATCH" },
  );
});

test("history replays after role revocation while new writes remain denied", () => {
  const command = openCommand();
  const revokedHistory = replayPosOperations(scope, [command]);
  assert.equal(revokedHistory.orders[0]?.status, "open");
  assert.equal(revokedHistory.orders[0]?.createdByActorId, "owner-1");
  const noLongerAuthorized = { ...owner, capabilities: [] };
  assert.throws(
    () =>
      applyPosOperation(revokedHistory, lineAddedCommand(), {
        ...noLongerAuthorized,
        actorId: "cashier-1",
        role: "barra",
        capabilities: [],
      }),
    PosOperationError,
  );
});
