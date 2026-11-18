// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PaymentRejectedError, settle } from "./payment.ts";
import type { PaymentInput, PaymentRejection } from "./payment.ts";
import { amountDue } from "./tip.ts";

function rejection(
  amountDueCents: number,
  payment: PaymentInput,
): PaymentRejection | "not rejected" {
  try {
    settle(amountDueCents, payment);
  } catch (error) {
    if (error instanceof PaymentRejectedError) return error.reason;
    throw error;
  }
  return "not rejected";
}

describe("EVL-123 [B] Un solo pago", () => {
  it("[B] Un pago exacto cuadra", () => {
    expect(settle(15000, { method: "card", receivedCents: 15000 })).toEqual({
      method: "card",
      amountDueCents: 15000,
      receivedCents: 15000,
      changeCents: 0,
      netCents: 15000,
      pendingCents: 0,
      canConfirm: true,
    });
  });

  it("[B] El pago cubre la orden más la propina", () => {
    const due = amountDue(10000, 1000).totalDueCents;
    const result = settle(due, { method: "card", receivedCents: 11000 });
    expect(result.amountDueCents).toBe(11000);
    expect(result.pendingCents).toBe(0);
    expect(result.canConfirm).toBe(true);
  });

  it("[B] No se cierra con saldo pendiente", () => {
    const result = settle(15000, { method: "card", receivedCents: 10000 });
    expect(result.netCents).toBe(10000);
    expect(result.pendingCents).toBe(5000);
    expect(result.canConfirm).toBe(false);
  });

  it("[B] Tarjeta o transferencia no pueden exceder el saldo", () => {
    expect(rejection(15000, { method: "card", receivedCents: 20000 })).toBe(
      "only-cash-gives-change",
    );
    expect(rejection(15000, { method: "transfer", receivedCents: 15001 })).toBe(
      "only-cash-gives-change",
    );
  });

  it("[B] El efectivo de más genera cambio", () => {
    expect(settle(5000, { method: "cash", receivedCents: 10000 })).toEqual({
      method: "cash",
      amountDueCents: 5000,
      receivedCents: 10000,
      changeCents: 5000,
      netCents: 5000,
      pendingCents: 0,
      canConfirm: true,
    });
  });

  it("[B] Un pago de $0.00 o negativo se rechaza", () => {
    expect(rejection(15000, { method: "cash", receivedCents: 0 })).toBe(
      "invalid-amount",
    );
    expect(rejection(15000, { method: "card", receivedCents: -1000 })).toBe(
      "invalid-amount",
    );
  });

  it.each([
    ["fractional payment", 15000, 100.5],
    ["NaN payment", 15000, Number.NaN],
    ["negative amount due", -1, 1000],
    ["fractional amount due", 150.5, 1000],
  ])("rejects money that is not integer centavos: %s", (_label, due, paid) => {
    expect(() => settle(due, { method: "cash", receivedCents: paid })).toThrow(
      RangeError,
    );
  });
});
