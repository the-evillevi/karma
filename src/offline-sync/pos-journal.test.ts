import test from "node:test";
import assert from "node:assert/strict";
import {
  POS_JOURNAL_SCHEMA_VERSION,
  POS_ORDER_SNAPSHOT_ACTION,
  PosJournalIntegrityError,
  replayPosJournalCommands,
  reducePosSnapshotCommand,
  validatePosSnapshotCommand,
  type PosJournalCommand,
  type PosOrderSnapshot,
  type PosSnapshotCommandInput,
} from "./pos-journal.ts";

const scope = { branchId: "branch-1", deviceId: "device-1" };

test("version 1 accepts only a complete, immutable open-order snapshot in its branch and device journal", () => {
  const input = command({
    commandId: "open-1",
    actorId: "actor-a",
    expectedRevision: 0,
  });
  assert.deepEqual(validatePosSnapshotCommand(input, scope), input);

  assert.throws(
    () =>
      validatePosSnapshotCommand(
        { ...input, branchId: "another-branch" },
        scope,
      ),
    { code: "LOCAL_SCOPE_MISMATCH" },
  );
  assert.throws(
    () =>
      validatePosSnapshotCommand(
        {
          ...input,
          action: "sale.completed",
        } as unknown as PosSnapshotCommandInput,
        scope,
      ),
    { code: "UNSUPPORTED_LOCAL_ACTION" },
  );
  const withCredential = structuredClone(input);
  (
    withCredential.payload.order as PosOrderSnapshot & {
      serviceRoleKey?: string;
    }
  ).serviceRoleKey = "must-not-persist";
  assert.throws(
    () => validatePosSnapshotCommand(withCredential, scope),
    /unsupported fields/,
  );
  assert.throws(
    () =>
      validatePosSnapshotCommand(
        {
          ...input,
          payload: { order: { ...input.payload.order, totalCents: 901 } },
        },
        scope,
      ),
    /Total must equal subtotal after the saved discount/,
  );
});

test("snapshot replay is deterministic by aggregate revision and retains the original actor on each command", () => {
  const first = storedCommand(
    command({ commandId: "open-1", actorId: "actor-a", expectedRevision: 0 }),
    1,
  );
  const second = storedCommand(
    command({
      commandId: "open-2",
      actorId: "actor-b",
      expectedRevision: 1,
      orderStatus: "open",
    }),
    2,
  );

  const replayed = replayPosJournalCommands([second, first]);
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0]?.revision, 2);
  assert.equal(replayed[0]?.order.status, "open");
  assert.equal(replayed[0]?.lastCommand.actorId, "actor-b");
  assert.equal(replayed[0]?.lastCommand.commandId, "open-2");
});

test("reducer replaces snapshots without mutating earlier projection state", () => {
  const first = storedCommand(
    command({ commandId: "open-1", actorId: "actor-a", expectedRevision: 0 }),
    1,
  );
  const prior = reducePosSnapshotCommand(null, first);
  const priorCopy = structuredClone(prior);
  const next = storedCommand(
    command({
      commandId: "open-2",
      actorId: "actor-b",
      expectedRevision: 1,
      orderStatus: "open",
    }),
    2,
  );

  const updated = reducePosSnapshotCommand(prior, next);
  assert.deepEqual(prior, priorCopy);
  assert.equal(updated.order.status, "open");
  assert.equal(updated.revision, 2);
});

test("replay fails closed when a persisted aggregate revision is missing", () => {
  const second = storedCommand(
    command({
      commandId: "open-2",
      actorId: "actor-b",
      expectedRevision: 1,
      orderStatus: "open",
    }),
    2,
  );
  assert.throws(
    () => replayPosJournalCommands([second]),
    PosJournalIntegrityError,
  );
});

function command({
  commandId,
  actorId,
  expectedRevision,
  orderStatus = "draft",
}: {
  commandId: string;
  actorId: string;
  expectedRevision: number;
  orderStatus?: PosOrderSnapshot["status"];
}): PosSnapshotCommandInput {
  return {
    commandId,
    branchId: scope.branchId,
    aggregateId: "order-1",
    actorId,
    deviceId: scope.deviceId,
    occurredAt: `2026-09-30T12:00:0${expectedRevision}Z`,
    schemaVersion: POS_JOURNAL_SCHEMA_VERSION,
    expectedRevision,
    action: POS_ORDER_SNAPSHOT_ACTION,
    payload: { order: snapshot(orderStatus) },
  };
}

function snapshot(status: PosOrderSnapshot["status"]): PosOrderSnapshot {
  return {
    orderId: "order-1",
    status,
    orderType: "dine-in",
    tableId: "table-1",
    customer: null,
    lines: [
      {
        lineId: "line-1",
        productId: "product-1",
        productNameSnapshot: "Café",
        unitPriceCents: 1000,
        quantity: 1,
        taxRateBasisPoints: 1600,
        priceIncludesTax: true,
        catalogPriceVersionId: "price-1",
        modifierSnapshots: [],
      },
    ],
    subtotalCents: 1000,
    discountCents: 100,
    totalCents: 900,
    currency: "MXN",
    capturedAt: "2026-09-30T12:00:00Z",
  };
}

function storedCommand(
  input: PosSnapshotCommandInput,
  revision: number,
): PosJournalCommand {
  return {
    ...input,
    aggregateKey: `${input.branchId}\u0000${input.aggregateId}`,
    revision,
  };
}
