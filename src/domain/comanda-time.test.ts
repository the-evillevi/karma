// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  advancePreparation,
  durationLabel,
  sendComanda,
  timeInStatus,
  totalMinutes,
} from "./comanda.ts";
import { saveOrder } from "./commands.ts";
import { applyBatch, emptyState } from "./journal.ts";
import type { PosState, PreparationStatus } from "./journal.ts";
import { latte, linesOf, luis, mesa, meta, sofi } from "./testing.ts";

function sentAt(time: string): PosState {
  let state = applyBatch(
    emptyState(),
    saveOrder(emptyState(), meta("save", sofi, "10:00"), {
      orderId: "o-1",
      header: mesa(3),
      lines: linesOf([latte]),
    }),
  );
  state = applyBatch(
    state,
    sendComanda(state, meta("send", sofi, time), {
      orderId: "o-1",
      comandaId: "c-1",
    }),
  );
  return state;
}

function advanced(
  state: PosState,
  to: PreparationStatus,
  time: string,
): PosState {
  return applyBatch(
    state,
    advancePreparation(state, meta(`adv-${to}`, luis, time), {
      comandaId: "c-1",
      to,
    }),
  );
}

const at = (time: string) => `2026-11-15T${time}.000-06:00`;

describe("EVL-124 [F] Cronómetro de la comanda", () => {
  it("[F] La comanda guarda la hora de cada paso", () => {
    let state = sentAt("10:05");
    state = advanced(state, "preparing", "10:07");
    state = advanced(state, "ready", "10:15");
    state = advanced(state, "served", "10:17");
    const comanda = state.comandas["c-1"];
    expect(comanda.statusHistory).toEqual([
      { status: "queued", at: at("10:05:00") },
      { status: "preparing", at: at("10:07:00") },
      { status: "ready", at: at("10:15:00") },
      { status: "served", at: at("10:17:00") },
    ]);
    expect(comanda.updatedAt).toBe(at("10:17:00"));
    expect(totalMinutes(comanda, at("10:30:00"))).toBe(12);
    expect(timeInStatus(comanda, at("10:30:00"))).toEqual([
      { status: "queued", minutes: 2, current: false },
      { status: "preparing", minutes: 8, current: false },
      { status: "ready", minutes: 2, current: false },
      { status: "served", minutes: 0, current: true },
    ]);
  });

  it("Cuenta los minutos completos en cada estado y en total", () => {
    let state = sentAt("10:05");
    state = advanced(state, "preparing", "10:09");
    state = advanced(state, "ready", "10:15");
    const comanda = state.comandas["c-1"];
    expect(timeInStatus(comanda, at("10:17:30"))).toEqual([
      { status: "queued", minutes: 4, current: false },
      { status: "preparing", minutes: 6, current: false },
      { status: "ready", minutes: 2, current: true },
    ]);
    expect(totalMinutes(comanda, at("10:17:30"))).toBe(12);
  });

  it("Una comanda recién enviada lleva 0 minutos en cola", () => {
    const comanda = sentAt("10:05").comandas["c-1"];
    expect(timeInStatus(comanda, at("10:05:59"))).toEqual([
      { status: "queued", minutes: 0, current: true },
    ]);
    expect(totalMinutes(comanda, at("10:05:59"))).toBe(0);
  });

  it("[F] Un reloj adelantado no da tiempos negativos", () => {
    const comanda = sentAt("10:05").comandas["c-1"];
    expect(timeInStatus(comanda, at("10:01:00"))).toEqual([
      { status: "queued", minutes: 0, current: true },
    ]);
    expect(totalMinutes(comanda, at("10:01:00"))).toBe(0);
  });

  it("A step stamped before the previous one by a slower clock starts when the previous one did", () => {
    let state = sentAt("10:05");
    state = advanced(state, "preparing", "10:01");
    const comanda = state.comandas["c-1"];
    expect(timeInStatus(comanda, at("10:10:00"))).toEqual([
      { status: "queued", minutes: 0, current: false },
      { status: "preparing", minutes: 5, current: true },
    ]);
    expect(totalMinutes(comanda, at("10:10:00"))).toBe(5);

    const served = advanced(
      advanced(state, "ready", "10:03"),
      "served",
      "10:04",
    ).comandas["c-1"];
    expect(totalMinutes(served, at("10:30:00"))).toBe(0);
    expect(
      timeInStatus(served, at("10:30:00")).map((time) => time.minutes),
    ).toEqual([0, 0, 0, 0]);
  });

  it("Compara instantes aunque cambie la zona horaria", () => {
    const comanda = sentAt("10:05").comandas["c-1"];
    expect(totalMinutes(comanda, "2026-11-15T11:10:00.000-05:00")).toBe(5);
  });

  it("Escribe la duración en minutos y horas", () => {
    expect(
      [0, 1, 59, 60, 65, 125].map((minutes) => durationLabel(minutes)),
    ).toEqual(["<1 min", "1 min", "59 min", "1 h", "1 h 5 min", "2 h 5 min"]);
  });
});
