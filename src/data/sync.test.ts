// @vitest-environment node
// Spec: Linear EVL-126, slice [C]. Test names are the scenario titles.
import { describe, expect, it } from "vitest";
import { closeSale, closedSales } from "../domain/checkout.ts";
import { saveOrder } from "../domain/commands.ts";
import { applyBatch, emptyState, replay } from "../domain/journal.ts";
import type { CommandBatch, PosState } from "../domain/journal.ts";
import { nextToSync, receiveBatch } from "../domain/sync.ts";
import type { PushResult } from "../domain/sync.ts";
import {
  americano,
  catalog,
  linesOf,
  luis,
  meta,
  mostrador,
} from "../domain/testing.ts";
import { syncPending } from "./sync.ts";
import type { SyncServer } from "./sync.ts";

/**
 * An in-memory server that follows `receiveBatch`. `failures` scripts what
 * goes wrong, one entry per request, in order:
 * - "unreachable": the request never arrives.
 * - "response-lost": the server stores the batch but the reply never comes back.
 */
function fakeServer(failures: ("unreachable" | "response-lost" | "ok")[] = []) {
  let log: readonly CommandBatch[] = [];
  const requests: CommandBatch[] = [];
  const server: SyncServer = {
    async push(batch) {
      requests.push(structuredClone(batch));
      const failure = failures[requests.length - 1] ?? "ok";
      if (failure === "unreachable") throw new Error("Failed to fetch");
      const received = receiveBatch(log, structuredClone(batch));
      log = received.log;
      if (failure === "response-lost") throw new Error("Connection reset");
      return received.result;
    },
  };
  return { server, requests, log: () => log };
}

/** A journal of `count` cash sales of one Americano ($50.00) each. */
function salesJournal(count: number): CommandBatch[] {
  const journal: CommandBatch[] = [];
  let state: PosState = emptyState();
  for (let index = 1; index <= count; index += 1) {
    const orderId = `o-${index}`;
    for (const batch of [
      saveOrder(state, meta(`save-${index}`, luis, "10:05"), {
        orderId,
        header: mostrador,
        lines: linesOf([americano]),
      }),
    ]) {
      journal.push(batch);
      state = applyBatch(state, batch);
    }
    const charge = closeSale(
      state,
      meta(`op-${index}`, luis, "10:06"),
      {
        orderId,
        tipCents: 0,
        payment: { method: "cash", receivedCents: 5000 },
      },
      catalog.taxRateBps,
    );
    journal.push(charge);
    state = applyBatch(state, charge);
  }
  return journal;
}

/** One charge with the identifier from the scenarios, and the save before it. */
function chargeOp123(): CommandBatch[] {
  let state = emptyState();
  const save = saveOrder(state, meta("save-1", luis, "10:05"), {
    orderId: "o-1",
    header: mostrador,
    lines: linesOf([americano]),
  });
  state = applyBatch(state, save);
  const charge = closeSale(
    state,
    meta("op-123", luis, "10:06"),
    {
      orderId: "o-1",
      tipCents: 0,
      payment: { method: "cash", receivedCents: 5000 },
    },
    catalog.taxRateBps,
  );
  return [save, charge];
}

describe("EVL-126 [C] Cola de sincronización", () => {
  it("[C] Cada operación tiene identidad estable", async () => {
    // Dado un cobro capturado sin conexión con identificador op-123, cuando
    // la app reintenta el envío 3 veces, entonces las 3 solicitudes llevan
    // op-123
    const [save, charge] = chargeOp123();
    const { server, requests } = fakeServer([
      "unreachable",
      "unreachable",
      "ok",
    ]);
    // The save was already confirmed earlier; only the charge is pending.
    const acknowledged = new Set([save.commandId]);

    const first = await syncPending({
      journal: [save, charge],
      acknowledged,
      server,
    });
    const second = await syncPending({
      journal: [save, charge],
      acknowledged,
      server,
    });
    const third = await syncPending({
      journal: [save, charge],
      acknowledged,
      server,
    });

    expect(requests.map((request) => request.commandId)).toEqual([
      "op-123",
      "op-123",
      "op-123",
    ]);
    // Every attempt carries the very same content, not a re-created operation.
    expect(requests).toEqual([charge, charge, charge]);
    for (const failed of [first, second]) {
      expect(failed).toEqual({
        acknowledged: [],
        stoppedBy: "network",
        conflictId: null,
        remaining: 1,
      });
    }
    expect(third).toEqual({
      acknowledged: ["op-123"],
      stoppedBy: null,
      conflictId: null,
      remaining: 0,
    });
  });

  it("[C] Reintentar no duplica", async () => {
    // Dado el servidor ya aplicó op-123 pero la respuesta se perdió, cuando
    // la app reenvía op-123, entonces el servidor responde que ya existía y
    // queda una sola venta
    const journal = chargeOp123();
    const { server, requests, log } = fakeServer(["ok", "response-lost", "ok"]);

    const lost = await syncPending({
      journal,
      acknowledged: new Set(),
      server,
    });
    expect(lost).toEqual({
      acknowledged: ["save-1"],
      stoppedBy: "network",
      conflictId: null,
      remaining: 1,
    });
    // The server did store it; the device just does not know yet.
    expect(log().map((batch) => batch.commandId)).toEqual(["save-1", "op-123"]);

    const retried = await syncPending({
      journal,
      acknowledged: new Set(lost.acknowledged),
      server,
    });
    expect(requests.map((request) => request.commandId)).toEqual([
      "save-1",
      "op-123",
      "op-123",
    ]);
    expect(retried).toEqual({
      acknowledged: ["op-123"],
      stoppedBy: null,
      conflictId: null,
      remaining: 0,
    });
    expect(log()).toHaveLength(2);
    const onServer = replay(log());
    expect(closedSales(onServer)).toHaveLength(1);
    expect(onServer.orders["o-1"].sale?.settlement.netCents).toBe(5000);
    expect(onServer).toEqual(replay(journal));
  });

  it("sends the journal in order and stops at the first failure", async () => {
    // 3 sales = 6 batches. The third request fails: nothing after it may be
    // sent, or the server would replay a charge before its order exists.
    const journal = salesJournal(3);
    const { server, requests, log } = fakeServer(["ok", "ok", "unreachable"]);

    const report = await syncPending({
      journal,
      acknowledged: new Set(),
      server,
    });

    expect(requests.map((request) => request.commandId)).toEqual([
      "save-1",
      "op-1",
      "save-2",
    ]);
    expect(report).toEqual({
      acknowledged: ["save-1", "op-1"],
      stoppedBy: "network",
      conflictId: null,
      remaining: 4,
    });
    expect(log()).toHaveLength(2);

    const resumed = await syncPending({
      journal,
      acknowledged: new Set(report.acknowledged),
      server,
    });
    expect(resumed.acknowledged).toEqual(["save-2", "op-2", "save-3", "op-3"]);
    expect(resumed.remaining).toBe(0);
    expect(replay(log())).toEqual(replay(journal));
  });

  it("does not resend what the server already confirmed", async () => {
    const journal = salesJournal(2);
    const { server, requests } = fakeServer();
    const acknowledged = new Set(journal.map((batch) => batch.commandId));

    const report = await syncPending({ journal, acknowledged, server });

    expect(requests).toEqual([]);
    expect(report).toEqual({
      acknowledged: [],
      stoppedBy: null,
      conflictId: null,
      remaining: 0,
    });
  });

  it("stops on a conflict without overwriting the server", async () => {
    // The server already holds op-123 with other content (another device
    // reused the ID, or local data was tampered with). Nothing is overwritten
    // and the batch stays pending for review (EVL-126 [E]).
    const [save, charge] = chargeOp123();
    const { server, log } = fakeServer();
    const foreign: CommandBatch = {
      ...structuredClone(charge),
      deviceId: "otra-caja",
    };
    await server.push(save);
    await server.push(foreign);

    const report = await syncPending({
      journal: [save, charge],
      acknowledged: new Set(),
      server,
    });

    expect(report).toEqual({
      acknowledged: ["save-1"],
      stoppedBy: "conflict",
      conflictId: "op-123",
      remaining: 1,
    });
    expect(log()).toEqual([save, foreign]);
  });

  it("does not let the caller's data change while syncing", async () => {
    const journal = salesJournal(1);
    const before = structuredClone(journal);
    const acknowledged = new Set<string>();
    const { server } = fakeServer();
    await syncPending({ journal, acknowledged, server });
    expect(journal).toEqual(before);
    expect([...acknowledged]).toEqual([]);
  });
});

describe("EVL-126 [C] Reglas puras de sincronización", () => {
  it("the server accepts a new batch, recognises a repeat and refuses a forgery", () => {
    const [save, charge] = chargeOp123();
    const results: PushResult[] = [];
    let log: readonly CommandBatch[] = [];
    for (const batch of [save, charge]) {
      const received = receiveBatch(log, batch);
      results.push(received.result);
      log = received.log;
    }
    expect(results).toEqual(["accepted", "accepted"]);
    expect(log).toEqual([save, charge]);

    // The same batch again, even as a JSON copy with keys in another order.
    const reordered = Object.fromEntries(
      Object.entries(structuredClone(charge)).reverse(),
    ) as CommandBatch;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(charge));
    const repeat = receiveBatch(log, reordered);
    expect(repeat.result).toBe("duplicate");
    expect(repeat.log).toBe(log);

    const forged = { ...charge, at: "2026-11-15T23:59:00.000-06:00" };
    const refused = receiveBatch(log, forged);
    expect(refused.result).toBe("conflict");
    expect(refused.log).toBe(log);

    // The log is never mutated and does not alias the caller's batch.
    const input = structuredClone(save);
    const stored = receiveBatch([], input);
    input.actor.name = "changed later";
    expect(stored.log[0].actor.name).toBe("Luis");
  });

  it("lists what is still to send, in journal order", () => {
    const journal = salesJournal(2);
    const ids = (batches: CommandBatch[]) =>
      batches.map((batch) => batch.commandId);
    expect(ids(nextToSync(journal, new Set()))).toEqual([
      "save-1",
      "op-1",
      "save-2",
      "op-2",
    ]);
    expect(ids(nextToSync(journal, new Set(["save-1", "save-2"])))).toEqual([
      "op-1",
      "op-2",
    ]);
    expect(nextToSync(journal, new Set(ids(journal)))).toEqual([]);
    expect(nextToSync([], new Set(["x"]))).toEqual([]);
  });
});
