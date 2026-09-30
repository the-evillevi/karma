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

test("versionchange invalidates cached journals; blocked late opens close without downgrading", async () => {
  const profile = await mkdtemp(join(tmpdir(), "karma-pos-journal-lifecycle-"));
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
    await append(
      page,
      makeCommand(scope, {
        commandId: `command-${crypto.randomUUID()}`,
        actorId: "actor-a",
        expectedRevision: 0,
      }),
    );

    const lifecycle = await page.evaluate(async (databaseScope) => {
      const module = window.posJournalModule;
      const first = window.posJournal;
      const databaseName = first.database.name;
      const alternateFactory = {
        open: (...args) => indexedDB.open(...args),
      };
      const alternate = await module.openPosJournal(databaseScope, {
        indexedDBFactory: alternateFactory,
      });
      const separateFactoryCache = alternate !== first;

      const blockerRequest = indexedDB.open(databaseName);
      const blocker = await new Promise((resolve, reject) => {
        blockerRequest.onsuccess = () => resolve(blockerRequest.result);
        blockerRequest.onerror = () => reject(blockerRequest.error);
      });

      let resolveLateSuccess;
      const lateSuccess = new Promise((resolve) => {
        resolveLateSuccess = resolve;
      });
      const upgradeFactory = {
        open: (name) => {
          const request = indexedDB.open(name, 2);
          request.addEventListener("success", () => resolveLateSuccess());
          return request;
        },
      };
      let blockedCode;
      try {
        await module.openPosJournal(databaseScope, {
          indexedDBFactory: upgradeFactory,
        });
      } catch (error) {
        blockedCode = error.code;
      }
      blocker.close();
      await lateSuccess;

      let firstClosedCode;
      try {
        await first.readSnapshot();
      } catch (error) {
        firstClosedCode = error.code;
      }
      let alternateClosedCode;
      try {
        await alternate.readSnapshot();
      } catch (error) {
        alternateClosedCode = error.code;
      }

      const deleteRequest = indexedDB.deleteDatabase(databaseName);
      const deleteResult = await new Promise((resolve, reject) => {
        deleteRequest.onsuccess = () => resolve("deleted");
        deleteRequest.onerror = () => reject(deleteRequest.error);
        deleteRequest.onblocked = () =>
          reject(new Error("database remained open"));
      });
      const reopened = await module.openPosJournal(databaseScope);
      const reopenedCount = (await reopened.readSnapshot()).commands.length;
      reopened.close();
      return {
        blockedCode,
        firstClosedCode,
        alternateClosedCode,
        separateFactoryCache,
        deleteResult,
        reopenedCount,
      };
    }, scope);

    expect(lifecycle).toEqual({
      blockedCode: "LOCAL_DATABASE_UPGRADE_BLOCKED",
      firstClosedCode: "LOCAL_DATABASE_CLOSED",
      alternateClosedCode: "LOCAL_DATABASE_CLOSED",
      separateFactoryCache: true,
      deleteResult: "deleted",
      reopenedCount: 0,
    });
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("a future database version is preserved and rejected without downgrade", async () => {
  const profile = await mkdtemp(
    join(tmpdir(), "karma-pos-journal-future-version-"),
  );
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
    const result = await page.evaluate(async (databaseScope) => {
      const journal = window.posJournal;
      const databaseName = journal.database.name;
      journal.close();
      const futureRequest = indexedDB.open(databaseName, 2);
      const futureDatabase = await new Promise((resolve, reject) => {
        futureRequest.onupgradeneeded = () => {
          const database = futureRequest.result;
          database.createObjectStore("future-data", { keyPath: "id" });
        };
        futureRequest.onsuccess = () => resolve(futureRequest.result);
        futureRequest.onerror = () => reject(futureRequest.error);
      });
      futureDatabase.close();

      let openCode;
      try {
        await window.posJournalModule.openPosJournal(databaseScope);
      } catch (error) {
        openCode = error.code;
      }
      const verifyRequest = indexedDB.open(databaseName);
      const storedVersion = await new Promise((resolve, reject) => {
        verifyRequest.onsuccess = () => {
          resolve(verifyRequest.result.version);
          verifyRequest.result.close();
        };
        verifyRequest.onerror = () => reject(verifyRequest.error);
      });
      return { openCode, storedVersion };
    }, scope);
    expect(result).toEqual({
      openCode: "LOCAL_SCHEMA_VERSION_UNSUPPORTED",
      storedVersion: 2,
    });
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("tampered saved heads or projections fail closed for replay, retry and append", async () => {
  const profile = await mkdtemp(join(tmpdir(), "karma-pos-journal-integrity-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });

    for (const corruptedStore of ["aggregateHeads", "orderProjections"]) {
      const scope = {
        branchId: `branch-${crypto.randomUUID()}`,
        deviceId: `device-${crypto.randomUUID()}`,
      };
      await initializeJournal(page, scope);
      const command = makeCommand(scope, {
        commandId: `command-${crypto.randomUUID()}`,
        actorId: "actor-original",
        expectedRevision: 0,
      });
      await append(page, command);

      await page.evaluate(async (storeName) => {
        const journal = window.posJournal;
        const databaseName = journal.database.name;
        const aggregateKey = `${journal.scope.branchId}\u0000order-1`;
        journal.close();
        const request = indexedDB.open(databaseName, 1);
        const database = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        const recordRequest = store.get(aggregateKey);
        recordRequest.onsuccess = () => {
          const record = recordRequest.result;
          if (storeName === "aggregateHeads") record.revision = 9;
          else
            record.order.customer = {
              name: "tampered",
              phone: null,
              address: null,
            };
          store.put(record);
        };
        await new Promise((resolve, reject) => {
          transaction.oncomplete = resolve;
          transaction.onabort = () => reject(transaction.error);
          transaction.onerror = () => reject(transaction.error);
        });
        database.close();
      }, corruptedStore);

      await initializeJournal(page, scope);
      const outcomes = await page.evaluate(async (candidate) => {
        const outcome = async (action) => {
          try {
            await action();
            return "unexpected-success";
          } catch (error) {
            return error.code;
          }
        };
        return {
          snapshot: await outcome(() => window.posJournal.readSnapshot()),
          retry: await outcome(() =>
            window.posJournal.appendSnapshot(candidate),
          ),
          append: await outcome(() =>
            window.posJournal.appendSnapshot({
              ...candidate,
              commandId: `${candidate.commandId}-next`,
              expectedRevision: 1,
            }),
          ),
        };
      }, command);
      expect(outcomes).toEqual({
        snapshot: "LOCAL_JOURNAL_INTEGRITY_ERROR",
        retry: "LOCAL_JOURNAL_INTEGRITY_ERROR",
        append: "LOCAL_JOURNAL_INTEGRITY_ERROR",
      });

      const persistedCommands = await page.evaluate(async () => {
        const journal = window.posJournal;
        const databaseName = journal.database.name;
        journal.close();
        const request = indexedDB.open(databaseName, 1);
        const database = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction("commands", "readonly");
        const countRequest = transaction.objectStore("commands").count();
        const count = await new Promise((resolve, reject) => {
          countRequest.onsuccess = () => resolve(countRequest.result);
          countRequest.onerror = () => reject(countRequest.error);
        });
        database.close();
        return count;
      });
      expect(persistedCommands).toBe(1);
    }
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

test("a verified receipt clears an earlier block and safe diagnostics survive reload", async () => {
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
      commandId: `receipt-${crypto.randomUUID()}`,
      actorId: "actor-a",
      expectedRevision: 0,
    });
    await append(page, acknowledged);
    await page.evaluate(
      async ({ commandId }) => {
        // This fixture verifies the local record format only; no remote request is made here.
        await window.posJournal.recordSyncBlock({
          commandId,
          code: "NETWORK_UNAVAILABLE",
          blockedAt: "2026-09-30T12:00:04Z",
        });
        await window.posJournal.recordServerReceipt({
          commandId,
          serverReceivedAt: "2026-09-30T12:00:05Z",
          outcome: "inserted",
        });
        await window.posJournal.recordDiagnostic({
          diagnosticId: "safe-diagnostic-1",
          kind: "sync",
          code: "NETWORK_UNAVAILABLE",
          recordedAt: "2026-09-30T12:00:07Z",
        });
      },
      { commandId: acknowledged.commandId },
    );
    await page.evaluate(() => window.posJournal.close());
    await initializeJournal(page, scope);
    const snapshot = await read(page);
    expect(snapshot.queue.map((entry) => entry.state)).toEqual([
      "acknowledged",
    ]);
    expect(snapshot.receipts).toHaveLength(1);
    expect(snapshot.blocks).toHaveLength(0);
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
