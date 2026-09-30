import { chromium, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const origin = "http://127.0.0.1:4191";
const ownerCapabilities = [
  "openOrder",
  "checkout",
  "cancelWithReason",
  "cancelPreparationWithReason",
  "discountWithReason",
  "prepareOrder",
  "refundSaleWithReason",
];

function scope() {
  return {
    branchId: `branch-${randomUUID()}`,
    deviceId: `device-${randomUUID()}`,
  };
}

function line(lineId, name) {
  return {
    lineId,
    productId: `product-${lineId}`,
    nameSnapshot: name,
    quantity: 1,
    currency: "MXN",
    baseUnitPriceCents: 3000,
    modifierTotalCents: 0,
    unitPriceCents: 3000,
    lineTotalCents: 3000,
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

function refs(values) {
  return values.toSorted((left, right) =>
    left.kind === right.kind
      ? left.id.localeCompare(right.id)
      : left.kind.localeCompare(right.kind),
  );
}

function command(scopeValue, action, payload, expectedRevisions, extra = {}) {
  return {
    schemaVersion: 1,
    commandId: extra.commandId ?? `cmd-${randomUUID()}`,
    branchId: scopeValue.branchId,
    actorId: extra.actorId ?? "owner-user",
    deviceId: scopeValue.deviceId,
    occurredAt: extra.occurredAt ?? "2026-09-30T12:00:00.000Z",
    expectedRevisions: refs(expectedRevisions),
    action,
    reason: extra.reason ?? null,
    payload,
  };
}

async function init(page, scopeValue) {
  await page.evaluate(async (currentScope) => {
    const { openPosOperationsJournal } =
      await import("/src/offline-sync/pos-operations-journal.ts");
    window.operationJournal = await openPosOperationsJournal(currentScope);
  }, scopeValue);
}

async function append(
  page,
  candidate,
  role = "duena",
  capabilities = ownerCapabilities,
) {
  return page.evaluate(
    async ({ commandValue, currentRole, currentCapabilities }) => {
      const authority = {
        actorId: commandValue.actorId,
        branchId: commandValue.branchId,
        deviceId: commandValue.deviceId,
        role: currentRole,
        capabilities: currentCapabilities,
      };
      const result = await window.operationJournal.append(
        commandValue,
        authority,
      );
      return { duplicate: result.duplicate, component: result.component };
    },
    {
      commandValue: candidate,
      currentRole: role,
      currentCapabilities: capabilities,
    },
  );
}

async function snapshot(page) {
  return page.evaluate(() => window.operationJournal.readSnapshot());
}

test("cold restart replays paid, refunded, cancelled, and unfinished-kitchen facts", async () => {
  const profile = await mkdtemp(
    join(tmpdir(), "karma-pos-operations-restart-"),
  );
  const currentScope = scope();
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await init(page, currentScope);

    const opened = command(
      currentScope,
      "order.opened",
      {
        orderId: "order-main",
        orderType: "mesa",
        tableId: "table-4",
        customer: null,
        lines: [line("line-one", "Americano"), line("line-two", "Pan dulce")],
      },
      [{ kind: "order", id: "order-main", revision: 0 }],
      { commandId: "open-main" },
    );
    await append(page, opened);
    expect((await append(page, opened)).duplicate).toBe(true);
    const revokedRetry = await page.evaluate(async (candidate) => {
      try {
        await window.operationJournal.append(candidate, {
          actorId: candidate.actorId,
          branchId: candidate.branchId,
          deviceId: candidate.deviceId,
          role: "duena",
          capabilities: [],
        });
        return "unexpected-success";
      } catch (error) {
        return error.code;
      }
    }, opened);
    expect(revokedRetry).toBe("OPERATION_CAPABILITY_DENIED");
    const changedRetry = structuredClone(opened);
    changedRetry.payload.tableId = "table-5";
    const changedRetryCode = await page.evaluate(async (candidate) => {
      try {
        await window.operationJournal.append(candidate, {
          actorId: candidate.actorId,
          branchId: candidate.branchId,
          deviceId: candidate.deviceId,
          role: "duena",
          capabilities: ["openOrder"],
        });
        return "unexpected-success";
      } catch (error) {
        return error.code;
      }
    }, changedRetry);
    expect(changedRetryCode).toBe("OPERATION_COMMAND_ID_CONFLICT");

    await append(
      page,
      command(
        currentScope,
        "order.line-changed",
        {
          orderId: "order-main",
          lineId: "line-one",
          line: { ...line("line-one", "Americano"), notes: "Sin azúcar" },
        },
        [{ kind: "order", id: "order-main", revision: 1 }],
        { actorId: "barista-user", occurredAt: "2026-09-30T12:01:00.000Z" },
      ),
      "barra",
      ["openOrder"],
    );
    await append(
      page,
      command(
        currentScope,
        "order.discounted",
        { orderId: "order-main", amountCents: 500 },
        [{ kind: "order", id: "order-main", revision: 2 }],
        {
          reason: "Cortesía autorizada",
          occurredAt: "2026-09-30T12:02:00.000Z",
        },
      ),
    );
    await append(
      page,
      command(
        currentScope,
        "preparation.sent",
        { orderId: "order-main", preparationId: "prep-main" },
        [
          { kind: "order", id: "order-main", revision: 3 },
          { kind: "preparation", id: "prep-main", revision: 0 },
        ],
      ),
    );
    await append(
      page,
      command(
        currentScope,
        "preparation.transitioned",
        {
          orderId: "order-main",
          preparationId: "prep-main",
          nextStatus: "preparing",
        },
        [
          { kind: "order", id: "order-main", revision: 4 },
          { kind: "preparation", id: "prep-main", revision: 1 },
        ],
        { actorId: "barista-user", occurredAt: "2026-09-30T12:03:00.000Z" },
      ),
      "barra",
      ["prepareOrder"],
    );
    await append(
      page,
      command(
        currentScope,
        "order.split",
        {
          sourceOrderId: "order-main",
          childOrderId: "order-child",
          transfers: [
            { lineId: "line-two", childLineId: "line-two-child", quantity: 1 },
          ],
        },
        [
          { kind: "order", id: "order-child", revision: 0 },
          { kind: "order", id: "order-main", revision: 4 },
          { kind: "preparation", id: "prep-main", revision: 2 },
        ],
        { actorId: "waiter-user", occurredAt: "2026-09-30T12:04:00.000Z" },
      ),
      "mesero",
      ["openOrder"],
    );
    await append(
      page,
      command(
        currentScope,
        "preparation.transitioned",
        {
          orderId: "order-main",
          preparationId: "prep-main",
          nextStatus: "ready",
        },
        [
          { kind: "order", id: "order-main", revision: 5 },
          { kind: "preparation", id: "prep-main", revision: 3 },
        ],
        { actorId: "barista-user", occurredAt: "2026-09-30T12:05:00.000Z" },
      ),
      "barra",
      ["prepareOrder"],
    );
    await append(
      page,
      command(
        currentScope,
        "order.checked-out",
        {
          orderId: "order-main",
          saleId: "sale-main",
          payments: [
            {
              paymentId: "cash-main",
              method: "cash",
              netAmountCents: 2750,
              tipCents: 200,
              tenderedCents: 2950,
              changeCents: 0,
              recordMode: "manual",
              verification: "not-applicable",
            },
          ],
        },
        [
          { kind: "order", id: "order-main", revision: 5 },
          { kind: "preparation", id: "prep-main", revision: 4 },
          { kind: "sale", id: "sale-main", revision: 0 },
        ],
        { actorId: "cashier-user", occurredAt: "2026-09-30T12:06:00.000Z" },
      ),
      "barra",
      ["checkout"],
    );
    await append(
      page,
      command(
        currentScope,
        "sale.refunded",
        {
          saleId: "sale-main",
          refundId: "refund-main",
          allocations: [
            { paymentId: "cash-main", method: "cash", amountCents: 500 },
          ],
        },
        [{ kind: "sale", id: "sale-main", revision: 1 }],
        {
          reason: "Producto no entregado",
          occurredAt: "2026-09-30T12:07:00.000Z",
        },
      ),
    );
    await append(
      page,
      command(
        currentScope,
        "order.cancelled",
        { orderId: "order-child" },
        [{ kind: "order", id: "order-child", revision: 1 }],
        {
          actorId: "manager-user",
          reason: "Cliente canceló",
          occurredAt: "2026-09-30T12:08:00.000Z",
        },
      ),
      "encargado",
      ["cancelWithReason"],
    );
    const beforeRestart = await snapshot(page);
    expect(
      beforeRestart.state.orders.find((item) => item.orderId === "order-main")
        .status,
    ).toBe("closed");
    expect(
      beforeRestart.state.orders.find((item) => item.orderId === "order-child")
        .status,
    ).toBe("cancelled");
    expect(beforeRestart.state.sales[0].refunds[0].amountCents).toBe(500);
    expect(beforeRestart.state.sales[0].payments[0]).toMatchObject({
      netAmountCents: 2750,
      tipCents: 200,
      tenderedCents: 2950,
      changeCents: 0,
    });
    expect(beforeRestart.state.preparations[0].status).toBe("ready");
    expect(beforeRestart.remoteStatus).toBe("not-connected");
    expect(
      beforeRestart.commands.map((record) => record.command.actorId),
    ).toContain("waiter-user");

    await page.evaluate(() => window.operationJournal.close());
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    const restartedPage = await context.newPage();
    await restartedPage.goto(origin, { waitUntil: "domcontentloaded" });
    await init(restartedPage, currentScope);
    const afterRestart = await snapshot(restartedPage);
    expect(
      afterRestart.state.orders.map((item) => [item.orderId, item.status]),
    ).toEqual([
      ["order-child", "cancelled"],
      ["order-main", "closed"],
    ]);
    expect(afterRestart.state.sales[0].refunds[0].reason).toBe(
      "Producto no entregado",
    );
    expect(
      afterRestart.state.preparations[0].history.map((event) => event.to),
    ).toEqual(["queued", "preparing", "ready"]);
    await restartedPage.evaluate(() => window.operationJournal.close());
    for (const otherScope of [
      { branchId: `branch-${randomUUID()}`, deviceId: currentScope.deviceId },
      { branchId: currentScope.branchId, deviceId: `device-${randomUUID()}` },
    ]) {
      await init(restartedPage, otherScope);
      expect((await snapshot(restartedPage)).state.orders).toHaveLength(0);
      await restartedPage.evaluate(() => window.operationJournal.close());
    }
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("two tabs serialize multi-aggregate writes and retain a stale revision conflict", async () => {
  const profile = await mkdtemp(
    join(tmpdir(), "karma-pos-operations-contention-"),
  );
  const currentScope = scope();
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    const first = await context.newPage();
    const second = await context.newPage();
    await Promise.all([
      first.goto(origin, { waitUntil: "domcontentloaded" }),
      second.goto(origin, { waitUntil: "domcontentloaded" }),
    ]);
    await Promise.all([init(first, currentScope), init(second, currentScope)]);
    const candidates = ["first", "second"].map((suffix) =>
      command(
        currentScope,
        "order.opened",
        {
          orderId: "one-order",
          orderType: "local",
          tableId: null,
          customer: null,
          lines: [line("one-line", "Café")],
        },
        [{ kind: "order", id: "one-order", revision: 0 }],
        {
          commandId: `open-${suffix}`,
          occurredAt: `2026-09-30T12:00:0${suffix === "first" ? 0 : 1}.000Z`,
        },
      ),
    );
    const outcomes = await Promise.all(
      [first, second].map(async (page, index) =>
        page.evaluate(async (candidate) => {
          try {
            await window.operationJournal.append(candidate, {
              actorId: candidate.actorId,
              branchId: candidate.branchId,
              deviceId: candidate.deviceId,
              role: "duena",
              capabilities: ["openOrder"],
            });
            return "committed";
          } catch (error) {
            return error.code;
          }
        }, candidates[index]),
      ),
    );
    expect(outcomes.sort()).toEqual([
      "OPERATION_REVISION_CONFLICT",
      "committed",
    ]);
    const saved = await snapshot(first);
    expect(saved.commands).toHaveLength(1);
    expect(saved.conflicts).toHaveLength(1);
    expect(saved.conflicts[0].expected.revision).toBe(0);
    expect(saved.conflicts[0].actualRevision).toBe(1);
    await Promise.all([
      first.evaluate(() => window.operationJournal.close()),
      second.evaluate(() => window.operationJournal.close()),
    ]);
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("restart rejects tampered operational projections and aggregate-event rows", async () => {
  const profile = await mkdtemp(join(tmpdir(), "karma-pos-operations-tamper-"));
  const currentScope = scope();
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await init(page, currentScope);
    const originalCommand = command(
      currentScope,
      "order.opened",
      {
        orderId: "tamper-order",
        orderType: "mesa",
        tableId: "table-1",
        customer: null,
        lines: [line("tamper-line", "Café")],
      },
      [{ kind: "order", id: "tamper-order", revision: 0 }],
    );
    await append(page, originalCommand);
    await page.evaluate(() => window.operationJournal.close());
    const databaseName = await page.evaluate(async (currentScope) => {
      const canonical = JSON.stringify({
        branchId: currentScope.branchId,
        deviceId: currentScope.deviceId,
      });
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical),
      );
      return `karma-pos-operations-v1-${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    }, currentScope);
    const tamperCode = await page.evaluate(async (name) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(
        ["aggregateProjections"],
        "readwrite",
      );
      const store = transaction.objectStore("aggregateProjections");
      const projection = await new Promise((resolve, reject) => {
        const request = store.get(["order", "tamper-order"]);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      projection.value.lines[0].nameSnapshot = "Inventado";
      store.put(projection);
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
      return "tampered";
    }, databaseName);
    expect(tamperCode).toBe("tampered");
    const openCode = await page.evaluate(async (currentScope) => {
      const { openPosOperationsJournal } =
        await import("/src/offline-sync/pos-operations-journal.ts");
      try {
        await openPosOperationsJournal(currentScope);
        return "unexpected-success";
      } catch (error) {
        return error.code;
      }
    }, currentScope);
    expect(openCode).toBe("LOCAL_OPERATIONS_INTEGRITY_ERROR");

    const repairAndTamperEvent = await page.evaluate(async (name) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(
        ["aggregateProjections", "aggregateEvents"],
        "readwrite",
      );
      const projections = transaction.objectStore("aggregateProjections");
      const saved = await new Promise((resolve, reject) => {
        const request = projections.get(["order", "tamper-order"]);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      saved.value.lines[0].nameSnapshot = "Café";
      projections.put(saved);
      transaction
        .objectStore("aggregateEvents")
        .delete(["order", "tamper-order", 1]);
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
      return "tampered";
    }, databaseName);
    expect(repairAndTamperEvent).toBe("tampered");
    const eventIndexOpenCode = await page.evaluate(async (currentScope) => {
      const { openPosOperationsJournal } =
        await import("/src/offline-sync/pos-operations-journal.ts");
      try {
        await openPosOperationsJournal(currentScope);
        return "unexpected-success";
      } catch (error) {
        return error.code;
      }
    }, currentScope);
    expect(eventIndexOpenCode).toBe("LOCAL_OPERATIONS_INTEGRITY_ERROR");

    const commandTampered = await page.evaluate(
      async ({ name, currentScope, commandId }) => {
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open(name, 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction(
          ["operationCommands", "aggregateEvents"],
          "readwrite",
        );
        const commands = transaction.objectStore("operationCommands");
        const saved = await new Promise((resolve, reject) => {
          const request = commands.get(commandId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        saved.command.payload.tableId = "table-altered";
        commands.put(saved);
        transaction.objectStore("aggregateEvents").put({
          branchId: currentScope.branchId,
          deviceId: currentScope.deviceId,
          kind: "order",
          aggregateId: "tamper-order",
          revision: 1,
          commandId,
          sequence: 1,
        });
        await new Promise((resolve, reject) => {
          transaction.oncomplete = resolve;
          transaction.onabort = () => reject(transaction.error);
        });
        database.close();
        return "tampered";
      },
      {
        name: databaseName,
        currentScope,
        commandId: originalCommand.commandId,
      },
    );
    expect(commandTampered).toBe("tampered");
    const commandOpenCode = await page.evaluate(async (currentScope) => {
      const { openPosOperationsJournal } =
        await import("/src/offline-sync/pos-operations-journal.ts");
      try {
        await openPosOperationsJournal(currentScope);
        return "unexpected-success";
      } catch (error) {
        return error.code;
      }
    }, currentScope);
    expect(commandOpenCode).toBe("LOCAL_OPERATIONS_INTEGRITY_ERROR");
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("a failed multi-store IDB transaction exposes no operation projection", async () => {
  const profile = await mkdtemp(
    join(tmpdir(), "karma-pos-operations-write-failure-"),
  );
  const currentScope = scope();
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await init(page, currentScope);
    const candidate = command(
      currentScope,
      "order.opened",
      {
        orderId: "failed-order",
        orderType: "local",
        tableId: null,
        customer: null,
        lines: [line("failed-line", "Café")],
      },
      [{ kind: "order", id: "failed-order", revision: 0 }],
    );
    const failureCode = await page.evaluate(async (candidate) => {
      const descriptor = Object.getOwnPropertyDescriptor(
        IDBObjectStore.prototype,
        "put",
      );
      let injected = false;
      Object.defineProperty(IDBObjectStore.prototype, "put", {
        ...descriptor,
        value: function (...args) {
          if (!injected && this.name === "aggregateProjections") {
            injected = true;
            throw new DOMException("quota exceeded", "QuotaExceededError");
          }
          return descriptor.value.apply(this, args);
        },
      });
      try {
        await window.operationJournal.append(candidate, {
          actorId: candidate.actorId,
          branchId: candidate.branchId,
          deviceId: candidate.deviceId,
          role: "duena",
          capabilities: ["openOrder"],
        });
        return "unexpected-success";
      } catch (error) {
        return error.code ?? error.name;
      } finally {
        Object.defineProperty(IDBObjectStore.prototype, "put", descriptor);
      }
    }, candidate);
    expect(failureCode).toBe("LOCAL_STORAGE_FAILURE");
    const afterFailure = await snapshot(page);
    expect(afterFailure.commands).toHaveLength(0);
    expect(afterFailure.state.orders).toHaveLength(0);
    expect(afterFailure.state.sales).toHaveLength(0);
    const retry = await append(page, candidate);
    expect(retry.duplicate).toBe(false);
    expect((await snapshot(page)).state.orders[0].status).toBe("open");
    await page.evaluate(() => window.operationJournal.close());
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
