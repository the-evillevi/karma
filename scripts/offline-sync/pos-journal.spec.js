import { chromium, test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = "http://127.0.0.1:4190";

test("branch/device journal replays after browser restart and keeps pending actor identity", async () => {
  const profile = await mkdtemp(join(tmpdir(), "karma-pos-journal-restart-"));
  const scope = {
    branchId: `branch-${crypto.randomUUID()}`,
    deviceId: `device-${crypto.randomUUID()}`,
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await initializeJournal(page, scope);

    const command = makeCommand(scope, {
      commandId: `command-${crypto.randomUUID()}`,
      actorId: "actor-original",
      expectedRevision: 0,
    });
    const created = await append(page, command);
    expect(created.duplicate).toBe(false);
    expect(created.command.revision).toBe(1);
    const beforeRestart = await read(page);
    expect(beforeRestart.queue).toHaveLength(1);
    expect(beforeRestart.queue[0].state).toBe("pending");
    expect(beforeRestart.queue[0].command.actorId).toBe("actor-original");
    await page.evaluate(() => window.posJournal.close());
    await context.close();

    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    const restartedPage = await context.newPage();
    await restartedPage.goto(origin, { waitUntil: "domcontentloaded" });
    await initializeJournal(restartedPage, scope);
    const afterRestart = await read(restartedPage);
    expect(afterRestart.projections[0].revision).toBe(1);
    expect(afterRestart.projections[0].order.lines[0].productNameSnapshot).toBe(
      "Café",
    );
    expect(afterRestart.queue[0].command.actorId).toBe("actor-original");
    expect(afterRestart.queue[0].state).toBe("pending");

    await append(
      restartedPage,
      makeCommand(scope, {
        commandId: `command-${crypto.randomUUID()}`,
        actorId: "actor-after-switch",
        expectedRevision: 1,
      }),
    );
    const afterIdentitySwitch = await read(restartedPage);
    expect(
      afterIdentitySwitch.queue.map((item) => item.command.actorId),
    ).toEqual(["actor-original", "actor-after-switch"]);

    const otherScopes = [
      {
        branchId: `branch-${crypto.randomUUID()}`,
        deviceId: scope.deviceId,
      },
      {
        branchId: scope.branchId,
        deviceId: `device-${crypto.randomUUID()}`,
      },
    ];
    for (const otherScope of otherScopes) {
      await restartedPage.evaluate(() => window.posJournal.close());
      await initializeJournal(restartedPage, otherScope);
      expect((await read(restartedPage)).commands).toHaveLength(0);
    }
    await restartedPage.evaluate(() => window.posJournal.close());
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("same command retries are idempotent; changed payload conflicts; IDB failure exposes no projection", async () => {
  const profile = await mkdtemp(join(tmpdir(), "karma-pos-journal-failure-"));
  const scope = {
    branchId: `branch-${crypto.randomUUID()}`,
    deviceId: `device-${crypto.randomUUID()}`,
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await initializeJournal(page, scope);
    const command = makeCommand(scope, {
      commandId: `command-${crypto.randomUUID()}`,
      actorId: "actor-a",
      expectedRevision: 0,
    });

    expect((await append(page, command)).duplicate).toBe(false);
    expect((await append(page, command)).duplicate).toBe(true);
    const changed = structuredClone(command);
    changed.payload.order.customer = {
      name: "Different",
      phone: null,
      address: null,
    };
    const conflictCode = await page.evaluate(async (candidate) => {
      try {
        await window.posJournal.appendSnapshot(candidate);
        return "unexpected-success";
      } catch (error) {
        return error.code;
      }
    }, changed);
    expect(conflictCode).toBe("LOCAL_COMMAND_ID_CONFLICT");

    const failed = makeCommand(scope, {
      commandId: `command-${crypto.randomUUID()}`,
      actorId: "actor-a",
      expectedRevision: 1,
    });
    const failureCode = await page.evaluate(async (candidate) => {
      const descriptor = Object.getOwnPropertyDescriptor(
        IDBObjectStore.prototype,
        "add",
      );
      if (!descriptor?.value)
        throw new Error("IndexedDB add method unavailable");
      let injected = false;
      Object.defineProperty(IDBObjectStore.prototype, "add", {
        ...descriptor,
        value: function (...args) {
          if (!injected) {
            injected = true;
            throw new DOMException("quota exceeded", "QuotaExceededError");
          }
          return descriptor.value.apply(this, args);
        },
      });
      try {
        await window.posJournal.appendSnapshot(candidate);
        return "unexpected-success";
      } catch (error) {
        return error.code;
      } finally {
        Object.defineProperty(IDBObjectStore.prototype, "add", descriptor);
      }
    }, failed);
    expect(failureCode).toBe("LOCAL_STORAGE_FAILED");
    const snapshot = await read(page);
    expect(snapshot.commands).toHaveLength(1);
    expect(snapshot.projections[0].revision).toBe(1);
    expect(snapshot.projections[0].order.customer).toBeNull();
    await page.evaluate(() => window.posJournal.close());
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("two tabs serialize revisions and preserve the losing snapshot for review", async () => {
  const profile = await mkdtemp(join(tmpdir(), "karma-pos-journal-tabs-"));
  const scope = {
    branchId: `branch-${crypto.randomUUID()}`,
    deviceId: `device-${crypto.randomUUID()}`,
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    const firstPage = await context.newPage();
    await firstPage.goto(origin, { waitUntil: "domcontentloaded" });
    await initializeJournal(firstPage, scope);
    await append(
      firstPage,
      makeCommand(scope, {
        commandId: `base-${crypto.randomUUID()}`,
        actorId: "actor-a",
        expectedRevision: 0,
      }),
    );

    const secondPage = await context.newPage();
    await secondPage.goto(origin, { waitUntil: "domcontentloaded" });
    await initializeJournal(secondPage, scope);
    const candidates = [
      makeCommand(scope, {
        commandId: `edit-${crypto.randomUUID()}`,
        actorId: "actor-a",
        expectedRevision: 1,
        customerName: "A edit",
      }),
      makeCommand(scope, {
        commandId: `edit-${crypto.randomUUID()}`,
        actorId: "actor-b",
        expectedRevision: 1,
        customerName: "B edit",
      }),
    ];
    const outcomes = await Promise.all(
      [firstPage, secondPage].map((page, index) =>
        page.evaluate(async (candidate) => {
          try {
            return {
              state: "saved",
              result: await window.posJournal.appendSnapshot(candidate),
            };
          } catch (error) {
            return { state: "rejected", code: error.code };
          }
        }, candidates[index]),
      ),
    );
    expect(
      outcomes.filter((outcome) => outcome.state === "saved"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.code === "LOCAL_REVISION_CONFLICT"),
    ).toHaveLength(1);

    const snapshot = await read(firstPage);
    expect(snapshot.projections[0].revision).toBe(2);
    expect(snapshot.commands).toHaveLength(2);
    expect(snapshot.conflicts).toHaveLength(1);
    expect(snapshot.conflicts[0].command.payload.order.customer.name).toMatch(
      / edit/,
    );
    expect(snapshot.diagnostics.map((entry) => entry.code)).toContain(
      "LOCAL_REVISION_CONFLICT",
    );
    await firstPage.evaluate(() => window.posJournal.close());
    await secondPage.evaluate(() => window.posJournal.close());
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("receipts, blocked states and safe diagnostics survive journal reload", async () => {
  const profile = await mkdtemp(join(tmpdir(), "karma-pos-journal-state-"));
  const scope = {
    branchId: `branch-${crypto.randomUUID()}`,
    deviceId: `device-${crypto.randomUUID()}`,
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await initializeJournal(page, scope);
    const acknowledged = makeCommand(scope, {
      commandId: `ack-${crypto.randomUUID()}`,
      actorId: "actor-a",
      expectedRevision: 0,
    });
    const blocked = makeCommand(scope, {
      commandId: `blocked-${crypto.randomUUID()}`,
      actorId: "actor-b",
      expectedRevision: 1,
    });
    await append(page, acknowledged);
    await append(page, blocked);
    await page.evaluate(
      async ({ commandId, blockedCommandId }) => {
        // This fixture verifies the local record format only; no remote request is made here.
        await window.posJournal.recordServerReceipt({
          commandId,
          serverReceivedAt: "2026-09-30T12:00:05Z",
          outcome: "inserted",
        });
        await window.posJournal.recordSyncBlock({
          commandId: blockedCommandId,
          code: "42501",
          blockedAt: "2026-09-30T12:00:06Z",
        });
        await window.posJournal.recordDiagnostic({
          diagnosticId: "safe-diagnostic-1",
          kind: "sync",
          code: "NETWORK_UNAVAILABLE",
          recordedAt: "2026-09-30T12:00:07Z",
        });
      },
      {
        commandId: acknowledged.commandId,
        blockedCommandId: blocked.commandId,
      },
    );
    await page.evaluate(() => window.posJournal.close());
    await initializeJournal(page, scope);
    const snapshot = await read(page);
    expect(snapshot.queue.map((entry) => entry.state)).toEqual([
      "acknowledged",
      "blocked",
    ]);
    expect(snapshot.receipts).toHaveLength(1);
    expect(snapshot.blocks[0].code).toBe("42501");
    expect(snapshot.diagnostics[0].code).toBe("NETWORK_UNAVAILABLE");
    await page.evaluate(() => window.posJournal.close());
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

async function initializeJournal(page, scope) {
  await page.evaluate(async (databaseScope) => {
    window.posJournalModule = await import("/src/offline-sync/pos-journal.ts");
    window.posJournal =
      await window.posJournalModule.openPosJournal(databaseScope);
  }, scope);
}

async function append(page, command) {
  return page.evaluate(
    (candidate) => window.posJournal.appendSnapshot(candidate),
    command,
  );
}

async function read(page) {
  return page.evaluate(() => window.posJournal.readSnapshot());
}

function makeCommand(
  scope,
  { commandId, actorId, expectedRevision, customerName = null },
) {
  return {
    commandId,
    branchId: scope.branchId,
    aggregateId: "order-1",
    actorId,
    deviceId: scope.deviceId,
    occurredAt: `2026-09-30T12:00:${String(expectedRevision).padStart(2, "0")}Z`,
    schemaVersion: 1,
    expectedRevision,
    action: "order.snapshot.saved",
    payload: {
      order: {
        orderId: "order-1",
        status: "open",
        orderType: "dine-in",
        tableId: "table-1",
        customer: customerName
          ? { name: customerName, phone: null, address: null }
          : null,
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
        discountCents: 0,
        totalCents: 1000,
        currency: "MXN",
        capturedAt: "2026-09-30T12:00:00Z",
      },
    },
  };
}
