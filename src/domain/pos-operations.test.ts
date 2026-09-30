import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPosOperation,
  createPosOperationsState,
  MAX_POS_OPERATION_BYTES,
  PosOperationError,
  PosOperationRevisionConflict,
  replayPosOperations,
  validatePosOperationCommand,
  type PosOperationAuthority,
  type PosOperationCommand,
  type PosOperationLine,
  type PosOperationAction,
  type PosOperationPayloads,
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
    "refundSaleWithReason",
  ],
};

let generatedCommandNumber = 1;

function operation<TAction extends PosOperationAction>(
  action: TAction,
  payload: PosOperationPayloads[TAction],
  expectedRevisions: PosOperationCommand["expectedRevisions"],
  options: {
    actorId?: string;
    commandId?: string;
    occurredAt?: string;
    reason?: string | null;
  } = {},
): Extract<PosOperationCommand, { action: TAction }> {
  return {
    schemaVersion: 1,
    commandId: options.commandId ?? `operation-${generatedCommandNumber++}`,
    branchId: scope.branchId,
    actorId: options.actorId ?? owner.actorId,
    deviceId: scope.deviceId,
    occurredAt: options.occurredAt ?? "2026-09-30T12:10:00.000Z",
    expectedRevisions: canonicalRevisions(expectedRevisions),
    action,
    reason: options.reason ?? null,
    payload,
  } as Extract<PosOperationCommand, { action: TAction }>;
}

function revision(
  kind: "order" | "preparation" | "sale",
  id: string,
  value: number,
) {
  return { kind, id, revision: value } as const;
}

function canonicalRevisions(refs: PosOperationCommand["expectedRevisions"]) {
  return [...refs].sort((left, right) =>
    left.kind === right.kind
      ? left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0
      : left.kind < right.kind
        ? -1
        : 1,
  );
}

function authority(
  actorId: string,
  role: PosOperationAuthority["role"],
  capabilities: PosOperationAuthority["capabilities"],
): PosOperationAuthority {
  return { ...scope, actorId, role, capabilities };
}

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
    splitOperations: [],
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

test("serialized order types preserve their table and contact requirements", () => {
  for (const orderType of ["local", "mesa"] as const) {
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
  for (const orderType of ["llevar", "recoger"] as const) {
    const command = openCommand({
      payload: {
        orderId: `order-${orderType}`,
        orderType,
        tableId: null,
        customer: { name: "Ana", phone: "5551234", address: null },
        lines: [capturedLine()],
      },
      expectedRevisions: [
        { kind: "order", id: `order-${orderType}`, revision: 0 },
      ],
    });
    assert.equal(validatePosOperationCommand(command).action, "order.opened");
    assert.throws(
      () =>
        validatePosOperationCommand({
          ...command,
          payload: { ...command.payload, customer: null },
        }),
      new RegExp(`${orderType} requires customer contact`),
    );
  }
  const delivery = openCommand({
    payload: {
      orderId: "delivery-1",
      orderType: "domicilio",
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
  assert.equal(opened.orderType, "domicilio");
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

test("captured modifier effects reconcile when their amount facts are complete", () => {
  const command = openCommand();
  const validLine = capturedLine("line-1", {
    modifierTotalCents: 100,
    unitPriceCents: 6100,
    lineTotalCents: 6100,
    modifiers: [
      {
        groupId: "milk",
        optionId: "oat",
        nameSnapshot: "Avena",
        quantity: 1,
        unit: null,
        priceEffectCents: 100,
      },
    ],
  });
  assert.equal(
    validatePosOperationCommand({
      ...command,
      payload: { ...command.payload, lines: [validLine] },
    }).action,
    "order.opened",
  );
  const inconsistent = capturedLine("line-1", {
    baseUnitPriceCents: null,
    modifierTotalCents: 0,
    modifiers: [
      {
        groupId: "milk",
        optionId: "oat",
        nameSnapshot: "Avena",
        quantity: 1,
        unit: null,
        priceEffectCents: 100,
      },
    ],
  });
  assert.throws(
    () =>
      validatePosOperationCommand({
        ...command,
        payload: { ...command.payload, lines: [inconsistent] },
      }),
    /modifier effects do not equal modifierTotalCents/,
  );
});

test("operation payloads have a total serialized size limit in addition to field bounds", () => {
  const command = openCommand();
  const modifiers = Array.from({ length: 100 }, (_, index) => ({
    groupId: `group-${index}`,
    optionId: `option-${index}`,
    nameSnapshot: "A".repeat(160),
    quantity: 1,
    unit: null,
    priceEffectCents: null,
  }));
  const lines = Array.from({ length: 200 }, (_, index) =>
    capturedLine(`line-${index}`, { modifiers }),
  );
  assert.throws(
    () =>
      validatePosOperationCommand({
        ...command,
        payload: { ...command.payload, lines },
      }),
    { code: "OPERATION_TOO_LARGE" },
  );
  assert.ok(MAX_POS_OPERATION_BYTES <= 1_000_000);
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
  assert.throws(
    () =>
      applyPosOperation(
        opened,
        openCommand({ occurredAt: "2026-09-30T12:00:01.000Z" }),
        owner,
      ),
    { code: "OPERATION_COMMAND_ID_CONFLICT" },
  );

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

test("order line/detail changes are revision guarded and cannot leave an empty draft", () => {
  const opened = applyPosOperation(
    createPosOperationsState(scope),
    openCommand({
      payload: {
        orderId: "order-1",
        orderType: "llevar",
        tableId: null,
        customer: { name: "Ana", phone: "5551234", address: null },
        lines: [capturedLine()],
      },
    }),
    owner,
  ).state;
  const changedLine = capturedLine("line-1", {
    quantity: 2,
    lineTotalCents: 12000,
    notes: "Sin azúcar",
  });
  const changed = applyPosOperation(
    opened,
    operation(
      "order.line-changed",
      { orderId: "order-1", lineId: "line-1", line: changedLine },
      [revision("order", "order-1", 1)],
      { actorId: "cashier-1" },
    ),
    authority("cashier-1", "barra", ["openOrder"]),
  ).state;
  assert.equal(changed.orders[0]?.lines[0]?.quantity, 2);
  assert.equal(changed.orders[0]?.history.at(-1)?.actorId, "cashier-1");

  const details = applyPosOperation(
    changed,
    operation(
      "order.details-changed",
      {
        orderId: "order-1",
        customer: {
          name: "Ana María",
          phone: "5559999",
          address: "Nueva dirección",
        },
      },
      [revision("order", "order-1", 2)],
    ),
    owner,
  ).state;
  assert.deepEqual(details.orders[0]?.customer, {
    name: "Ana María",
    phone: "5559999",
    address: "Nueva dirección",
  });
  assert.throws(
    () =>
      applyPosOperation(
        details,
        operation(
          "order.line-removed",
          { orderId: "order-1", lineId: "line-1" },
          [revision("order", "order-1", 3)],
        ),
        owner,
      ),
    { code: "ORDER_MUST_RETAIN_LINE" },
  );
  assert.equal(details.orders[0]?.revision, 3);
  assert.equal(details.orders[0]?.lines.length, 1);
});

test("discounts and cancellation preserve reason and actor without mutating the input", () => {
  const opened = applyPosOperation(
    createPosOperationsState(scope),
    openCommand(),
    owner,
  ).state;
  const discounted = applyPosOperation(
    opened,
    operation(
      "order.discounted",
      { orderId: "order-1", amountCents: 1000 },
      [revision("order", "order-1", 1)],
      { reason: "Cortesía autorizada" },
    ),
    owner,
  ).state;
  assert.equal(discounted.orders[0]?.discounts[0]?.allocatedCents, 1000);
  assert.equal(discounted.orders[0]?.discounts[0]?.actorId, owner.actorId);
  assert.equal(
    discounted.orders[0]?.discounts[0]?.reason,
    "Cortesía autorizada",
  );

  const sent = applyPosOperation(
    discounted,
    operation(
      "preparation.sent",
      { orderId: "order-1", preparationId: "prep-1" },
      [revision("order", "order-1", 2), revision("preparation", "prep-1", 0)],
    ),
    owner,
  ).state;
  const activePreparation = structuredClone(sent.preparations[0]);
  const cancelled = applyPosOperation(
    sent,
    operation(
      "order.cancelled",
      { orderId: "order-1" },
      [revision("order", "order-1", 3)],
      { actorId: "manager-1", reason: "Cliente se retiró" },
    ),
    authority("manager-1", "encargado", ["cancelWithReason"]),
  ).state;
  assert.equal(cancelled.orders[0]?.status, "cancelled");
  assert.equal(cancelled.orders[0]?.cancellationReason, "Cliente se retiró");
  assert.equal(cancelled.orders[0]?.cancelledByActorId, "manager-1");
  assert.deepEqual(cancelled.preparations[0], activePreparation);
  assert.equal(opened.orders[0]?.status, "open");
  assert.throws(
    () =>
      applyPosOperation(
        cancelled,
        operation(
          "order.discounted",
          { orderId: "order-1", amountCents: 1 },
          [revision("order", "order-1", 4)],
          { reason: "Error" },
        ),
        owner,
      ),
    { code: "ORDER_NOT_OPEN" },
  );
});

test("prep send, progress, split lineage, and checkout preserve unfinished kitchen work", () => {
  const twoLines = [
    capturedLine("line-1", { quantity: 2, lineTotalCents: 12000 }),
    capturedLine("line-2", {
      productId: "product-2",
      nameSnapshot: "Latte",
      baseUnitPriceCents: 5000,
      unitPriceCents: 5000,
      lineTotalCents: 5000,
    }),
  ];
  const opened = applyPosOperation(
    createPosOperationsState(scope),
    openCommand({ payload: { ...openCommand().payload, lines: twoLines } }),
    owner,
  ).state;
  const discounted = applyPosOperation(
    opened,
    operation(
      "order.discounted",
      { orderId: "order-1", amountCents: 5001 },
      [revision("order", "order-1", 1)],
      { reason: "Descuento de gerente" },
    ),
    owner,
  ).state;
  const sent = applyPosOperation(
    discounted,
    operation(
      "preparation.sent",
      { orderId: "order-1", preparationId: "prep-1" },
      [revision("order", "order-1", 2), revision("preparation", "prep-1", 0)],
      { actorId: "waiter-1" },
    ),
    authority("waiter-1", "mesero", ["openOrder"]),
  ).state;
  assert.equal(sent.preparations[0]?.status, "queued");
  assert.equal(sent.preparations[0]?.createdByActorId, "waiter-1");

  const splitAuthority = authority("waiter-1", "mesero", ["openOrder"]);
  const beforeSplitOrder = sent.orders[0]!;
  const beforeSplitSubtotal = beforeSplitOrder.lines.reduce(
    (sum, line) => sum + (line.lineTotalCents ?? 0),
    0,
  );
  const beforeSplitDiscount = beforeSplitOrder.discounts.reduce(
    (sum, item) => sum + item.allocatedCents,
    0,
  );
  const splitCommand = operation(
    "order.split",
    {
      sourceOrderId: "order-1",
      childOrderId: "order-2",
      transfers: [
        { lineId: "line-1", childLineId: "line-1-child", quantity: 1 },
      ],
    },
    [
      revision("order", "order-1", 3),
      revision("order", "order-2", 0),
      revision("preparation", "prep-1", 1),
    ],
    { actorId: "waiter-1" },
  );
  const staleSplit = {
    ...splitCommand,
    expectedRevisions: splitCommand.expectedRevisions.map((ref) =>
      ref.kind === "preparation" ? { ...ref, revision: 0 } : ref,
    ),
  };
  const sentBeforeStaleSplit = structuredClone(sent);
  assert.throws(
    () => applyPosOperation(sent, staleSplit, splitAuthority),
    PosOperationRevisionConflict,
  );
  assert.deepEqual(sent, sentBeforeStaleSplit);
  const split = applyPosOperation(sent, splitCommand, splitAuthority).state;
  const source = split.orders.find((order) => order.orderId === "order-1")!;
  const child = split.orders.find((order) => order.orderId === "order-2")!;
  const ticket = split.preparations[0]!;
  const afterSplitSubtotal = [source, child].reduce(
    (sum, order) =>
      sum +
      order.lines.reduce(
        (lineSum, line) => lineSum + (line.lineTotalCents ?? 0),
        0,
      ),
    0,
  );
  const afterSplitDiscount = [source, child].reduce(
    (sum, order) =>
      sum +
      order.discounts.reduce(
        (discountSum, item) => discountSum + item.allocatedCents,
        0,
      ),
    0,
  );
  assert.equal(afterSplitSubtotal, beforeSplitSubtotal);
  assert.equal(afterSplitDiscount, beforeSplitDiscount);
  assert.equal(
    afterSplitSubtotal - afterSplitDiscount,
    beforeSplitSubtotal - beforeSplitDiscount,
  );
  assert.equal(split.preparations.length, 1);
  assert.equal(source.orderType, "mesa");
  assert.equal(source.tableId, "table-4");
  assert.deepEqual(ticket.linkedOrderIds, ["order-1", "order-2"]);
  assert.equal(ticket.lines.length, 2);
  assert.equal(source.splitOperations[0]?.actorId, "waiter-1");
  assert.deepEqual(child.splitFrom, {
    orderId: "order-1",
    commandId: splitCommand.commandId,
  });

  const progressing = applyPosOperation(
    split,
    operation(
      "preparation.transitioned",
      { orderId: "order-1", preparationId: "prep-1", nextStatus: "preparing" },
      [revision("order", "order-1", 4), revision("preparation", "prep-1", 2)],
      { actorId: "barista-1" },
    ),
    authority("barista-1", "barra", ["prepareOrder"]),
  ).state;
  const preparationBeforeCheckout = structuredClone(
    progressing.preparations[0],
  );
  const orderRevision = progressing.orders.find(
    (order) => order.orderId === "order-1",
  )!.revision;
  const subtotal = progressing.orders
    .find((order) => order.orderId === "order-1")!
    .lines.reduce((sum, line) => sum + (line.lineTotalCents ?? 0), 0);
  const discount = progressing.orders
    .find((order) => order.orderId === "order-1")!
    .discounts.reduce((sum, item) => sum + item.allocatedCents, 0);
  const due = subtotal - discount;
  const checkout = applyPosOperation(
    progressing,
    operation(
      "order.checked-out",
      {
        orderId: "order-1",
        saleId: "sale-1",
        payments: [
          {
            paymentId: "payment-cash",
            method: "cash",
            netAmountCents: due,
            tipCents: 0,
            tenderedCents: due,
            changeCents: 0,
            recordMode: "manual",
            verification: "not-applicable",
          },
        ],
      },
      [
        revision("order", "order-1", orderRevision),
        revision("preparation", "prep-1", preparationBeforeCheckout!.revision),
        revision("sale", "sale-1", 0),
      ],
      { actorId: "cashier-1" },
    ),
    authority("cashier-1", "barra", ["checkout"]),
  ).state;
  assert.equal(
    checkout.orders.find((order) => order.orderId === "order-1")?.status,
    "closed",
  );
  assert.deepEqual(checkout.preparations[0], preparationBeforeCheckout);
  assert.equal(checkout.sales[0]?.closedByActorId, "cashier-1");
  assert.equal(checkout.sales[0]?.preparationId, "prep-1");
});

test("openOrder role matrix can split for every authorized position", () => {
  const roles: PosOperationAuthority["role"][] = [
    "duena",
    "encargado",
    "barra",
    "mesero",
  ];
  for (const [index, role] of roles.entries()) {
    const orderId = `split-${role}`;
    const initial = applyPosOperation(
      createPosOperationsState(scope),
      openCommand({
        commandId: `open-${role}`,
        payload: {
          orderId,
          orderType: "mesa",
          tableId: "table-4",
          customer: null,
          lines: [
            capturedLine(`line-${role}`, {
              quantity: 2,
              lineTotalCents: 12000,
            }),
          ],
        },
        expectedRevisions: [revision("order", orderId, 0)],
      }),
      owner,
    ).state;
    const actorId = `split-actor-${index}`;
    const permissions = authority(actorId, role, ["openOrder"]);
    const split = applyPosOperation(
      initial,
      operation(
        "order.split",
        {
          sourceOrderId: orderId,
          childOrderId: `${orderId}-child`,
          transfers: [
            {
              lineId: `line-${role}`,
              childLineId: `line-${role}-child`,
              quantity: 1,
            },
          ],
        },
        [
          revision("order", orderId, 1),
          revision("order", `${orderId}-child`, 0),
        ],
        { actorId },
      ),
      permissions,
    ).state;
    assert.equal(split.orders.length, 2);
  }
});

test("checkout and refunds append immutable money facts without reopening a paid account", () => {
  const opened = applyPosOperation(
    createPosOperationsState(scope),
    openCommand(),
    owner,
  ).state;
  const discounted = applyPosOperation(
    opened,
    operation(
      "order.discounted",
      { orderId: "order-1", amountCents: 500 },
      [revision("order", "order-1", 1)],
      { reason: "Ajuste autorizado" },
    ),
    owner,
  ).state;
  const checkoutCommand = operation(
    "order.checked-out",
    {
      orderId: "order-1",
      saleId: "sale-1",
      payments: [
        {
          paymentId: "payment-cash",
          method: "cash",
          netAmountCents: 3000,
          tipCents: 100,
          tenderedCents: 3300,
          changeCents: 200,
          recordMode: "manual",
          verification: "not-applicable",
        },
        {
          paymentId: "payment-card",
          method: "card",
          netAmountCents: 2500,
          tipCents: 50,
          tenderedCents: null,
          changeCents: null,
          recordMode: "manual",
          verification: "manual-unverified",
        },
      ],
    },
    [revision("order", "order-1", 2), revision("sale", "sale-1", 0)],
    { actorId: "cashier-1" },
  );
  const invalidNetCheckout = {
    ...checkoutCommand,
    payload: {
      ...checkoutCommand.payload,
      payments: checkoutCommand.payload.payments.map((payment) =>
        payment.paymentId === "payment-card"
          ? { ...payment, netAmountCents: payment.netAmountCents - 100 }
          : payment,
      ),
    },
  };
  assert.throws(
    () =>
      applyPosOperation(
        discounted,
        invalidNetCheckout,
        authority("cashier-1", "barra", ["checkout"]),
      ),
    /payment net does not equal/,
  );
  assert.equal(discounted.orders[0]?.status, "open");
  assert.equal(discounted.sales.length, 0);
  const checkedOut = applyPosOperation(
    discounted,
    checkoutCommand,
    authority("cashier-1", "barra", ["checkout"]),
  ).state;
  const sale = checkedOut.sales[0]!;
  const capturedPayments = structuredClone(sale.payments);
  assert.equal(sale.netTotalCents, 5500);
  assert.equal(sale.tipCents, 150);
  assert.equal(sale.payments[0]?.changeCents, 200);
  assert.equal(sale.payments[0]?.recordedByActorId, "cashier-1");
  assert.equal(sale.payments[1]?.verification, "manual-unverified");
  assert.equal(checkedOut.orders[0]?.status, "closed");

  const refundCommand = operation(
    "sale.refunded",
    {
      saleId: "sale-1",
      refundId: "refund-1",
      allocations: [
        { paymentId: "payment-cash", method: "cash", amountCents: 2000 },
        { paymentId: "payment-card", method: "card", amountCents: 500 },
      ],
    },
    [revision("sale", "sale-1", 1)],
    { actorId: "manager-1", reason: "Devolución autorizada" },
  );
  const refunded = applyPosOperation(
    checkedOut,
    refundCommand,
    authority("manager-1", "encargado", ["refundSaleWithReason"]),
  ).state;
  assert.equal(refunded.sales[0]?.refunds[0]?.amountCents, 2500);
  assert.equal(refunded.sales[0]?.refunds[0]?.actorId, "manager-1");
  assert.equal(refunded.sales[0]?.status, "closed");
  assert.deepEqual(refunded.sales[0]?.payments, capturedPayments);
  assert.equal(refunded.orders[0]?.status, "closed");

  assert.throws(
    () =>
      applyPosOperation(
        refunded,
        operation(
          "sale.refunded",
          {
            saleId: "sale-1",
            refundId: "refund-too-large",
            allocations: [
              { paymentId: "payment-cash", method: "cash", amountCents: 1001 },
            ],
          },
          [revision("sale", "sale-1", 2)],
          { actorId: "manager-1", reason: "Excede saldo" },
        ),
        authority("manager-1", "encargado", ["refundSaleWithReason"]),
      ),
    RangeError,
  );
  assert.throws(
    () =>
      applyPosOperation(
        refunded,
        operation(
          "sale.refunded",
          {
            saleId: "sale-1",
            refundId: "refund-denied",
            allocations: [
              { paymentId: "payment-cash", method: "cash", amountCents: 1 },
            ],
          },
          [revision("sale", "sale-1", 2)],
          { actorId: "waiter-1", reason: "Devolución" },
        ),
        authority("waiter-1", "mesero", ["refundSaleWithReason"]),
      ),
    { code: "OPERATION_ROLE_DENIED" },
  );
  const replayed = replayPosOperations(scope, refunded.commands);
  assert.deepEqual(replayed, refunded);
  assert.equal(replayed.orders[0]?.status, "closed");
  assert.equal(
    replayed.sales[0]?.refunds[0]?.commandId,
    refundCommand.commandId,
  );
  assert.throws(
    () =>
      applyPosOperation(
        refunded,
        operation(
          "order.line-added",
          { orderId: "order-1", line: capturedLine("line-2") },
          [revision("order", "order-1", 3)],
          { actorId: "cashier-1" },
        ),
        authority("cashier-1", "barra", ["openOrder"]),
      ),
    { code: "ORDER_NOT_OPEN" },
  );
});

test("checkout fails closed while catalog price provenance or amount is unknown", () => {
  const unknownLine = capturedLine("line-1", {
    baseUnitPriceCents: null,
    modifierTotalCents: null,
    unitPriceCents: null,
    lineTotalCents: null,
    priceEvidence: "unknown",
  });
  const opened = applyPosOperation(
    createPosOperationsState(scope),
    openCommand({
      payload: { ...openCommand().payload, lines: [unknownLine] },
    }),
    owner,
  ).state;
  const checkout = operation(
    "order.checked-out",
    { orderId: "order-1", saleId: "sale-unknown", payments: [] },
    [revision("order", "order-1", 1), revision("sale", "sale-unknown", 0)],
    { actorId: "cashier-1" },
  );
  assert.throws(
    () =>
      applyPosOperation(
        opened,
        checkout,
        authority("cashier-1", "barra", ["checkout"]),
      ),
    { code: "ORDER_PRICE_INCOMPLETE" },
  );
  assert.equal(opened.orders[0]?.status, "open");
  assert.equal(opened.sales.length, 0);
});

test("active preparation line edits touch both revisions and cancellation keeps its audit", () => {
  const opened = applyPosOperation(
    createPosOperationsState(scope),
    openCommand(),
    owner,
  ).state;
  const sent = applyPosOperation(
    opened,
    operation(
      "preparation.sent",
      { orderId: "order-1", preparationId: "prep-1" },
      [revision("order", "order-1", 1), revision("preparation", "prep-1", 0)],
    ),
    owner,
  ).state;
  const changed = applyPosOperation(
    sent,
    operation(
      "order.line-added",
      { orderId: "order-1", line: capturedLine("line-2") },
      [revision("order", "order-1", 2), revision("preparation", "prep-1", 1)],
      { actorId: "waiter-1" },
    ),
    authority("waiter-1", "mesero", ["openOrder"]),
  ).state;
  assert.equal(changed.orders[0]?.revision, 3);
  assert.equal(changed.preparations[0]?.revision, 2);
  assert.equal(changed.preparations[0]?.lines.length, 2);
  assert.equal(changed.commands.at(-1)?.actorId, "waiter-1");

  const cancelled = applyPosOperation(
    changed,
    operation(
      "preparation.cancelled",
      { orderId: "order-1", preparationId: "prep-1" },
      [revision("order", "order-1", 3), revision("preparation", "prep-1", 2)],
      { actorId: "manager-1", reason: "Duplicado en cocina" },
    ),
    authority("manager-1", "encargado", ["cancelPreparationWithReason"]),
  ).state;
  assert.equal(cancelled.preparations[0]?.status, "cancelled");
  assert.equal(
    cancelled.preparations[0]?.history.at(-1)?.reason,
    "Duplicado en cocina",
  );
  assert.equal(cancelled.preparations[0]?.history.at(-1)?.actorId, "manager-1");
  assert.equal(cancelled.orders[0]?.status, "open");
});

test("preparation can finish independently after its account is cancelled", () => {
  const opened = applyPosOperation(
    createPosOperationsState(scope),
    openCommand(),
    owner,
  ).state;
  const sent = applyPosOperation(
    opened,
    operation(
      "preparation.sent",
      { orderId: "order-1", preparationId: "prep-independent" },
      [
        revision("order", "order-1", 1),
        revision("preparation", "prep-independent", 0),
      ],
    ),
    owner,
  ).state;
  const cancelled = applyPosOperation(
    sent,
    operation(
      "order.cancelled",
      { orderId: "order-1" },
      [revision("order", "order-1", 2)],
      { reason: "Account cancelled separately" },
    ),
    owner,
  ).state;
  const progressed = applyPosOperation(
    cancelled,
    operation(
      "preparation.transitioned",
      {
        orderId: "order-1",
        preparationId: "prep-independent",
        nextStatus: "preparing",
      },
      [
        revision("order", "order-1", 3),
        revision("preparation", "prep-independent", 1),
      ],
    ),
    owner,
  ).state;
  assert.equal(progressed.orders[0]?.status, "cancelled");
  assert.equal(progressed.preparations[0]?.status, "preparing");
  assert.deepEqual(replayPosOperations(scope, progressed.commands), progressed);
});

test("replay rejects duplicate immutable history entries while command retries remain idempotent", () => {
  const command = openCommand();
  assert.throws(() => replayPosOperations(scope, [command, command]), {
    code: "OPERATION_DUPLICATE_HISTORY",
  });
  const opened = applyPosOperation(
    createPosOperationsState(scope),
    command,
    owner,
  ).state;
  assert.equal(applyPosOperation(opened, command, owner).duplicate, true);
});

test("line edits retain order size bounds and reject duplicate modifier identities", () => {
  const command = openCommand();
  const invalid = capturedLine();
  invalid.modifiers.push(structuredClone(invalid.modifiers[0]!));
  assert.throws(
    () =>
      validatePosOperationCommand({
        ...command,
        payload: { ...command.payload, lines: [invalid] },
      }),
    /modifier identity/,
  );
  const initial = applyPosOperation(
    createPosOperationsState(scope),
    {
      ...command,
      payload: {
        ...command.payload,
        lines: Array.from({ length: 200 }, (_, i) =>
          capturedLine(`bounded-${i}`),
        ),
      },
    },
    owner,
  ).state;
  assert.throws(
    () =>
      applyPosOperation(
        initial,
        operation(
          "order.line-added",
          { orderId: "order-1", line: capturedLine("overflow-line") },
          [revision("order", "order-1", 1)],
        ),
        owner,
      ),
    { code: "ORDER_TOO_MANY_LINES" },
  );
  assert.equal(initial.orders[0]?.lines.length, 200);
});

test("partial splits cannot duplicate a tax amount with unspecified unit versus line basis", () => {
  const knownTax = capturedLine("taxed", {
    quantity: 2,
    lineTotalCents: 12000,
    tax: {
      currency: "MXN",
      evidence: "prototype-captured",
      rateBasisPoints: 1600,
      amountCents: 1655,
      policyId: null,
    },
  });
  const initial = applyPosOperation(
    createPosOperationsState(scope),
    {
      ...openCommand(),
      payload: { ...openCommand().payload, lines: [knownTax] },
    },
    owner,
  ).state;
  assert.throws(
    () =>
      applyPosOperation(
        initial,
        operation(
          "order.split",
          {
            sourceOrderId: "order-1",
            childOrderId: "child-tax",
            transfers: [
              { lineId: "taxed", childLineId: "taxed-child", quantity: 1 },
            ],
          },
          [revision("order", "child-tax", 0), revision("order", "order-1", 1)],
        ),
        owner,
      ),
    { code: "SPLIT_TAX_BASIS_UNSUPPORTED" },
  );
  assert.equal(initial.orders.length, 1);
  assert.equal(initial.orders[0]?.lines[0]?.tax.amountCents, 1655);
});
