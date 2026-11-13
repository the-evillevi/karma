// @vitest-environment node
// Spec: Linear EVL-123, slice [A]. Test names are the scenario titles.
import { describe, expect, it } from "vitest";
import {
  amountDue,
  suggestedTipCents,
  tipOptions,
  tipPercentLabel,
} from "./tip.ts";

describe("EVL-123 [A] Propinas", () => {
  it("[A] Propina sugerida del 10 %", () => {
    // Dado una orden de $200.00, cuando elijo 10 %,
    // entonces la propina es $20.00 y el total a liquidar es $220.00
    const tip = suggestedTipCents(20000, 10);
    expect(tip).toBe(2000);
    expect(amountDue(20000, tip).totalDueCents).toBe(22000);
  });

  it("[A] Las sugerencias son 5, 10, 15 y 20 %", () => {
    // Dado una orden de $100.00, cuando abro las opciones de propina,
    // entonces veo $5, $10, $15, $20 y "Otro"
    expect(tipOptions(10000)).toEqual([
      { kind: "percent", percent: 5, tipCents: 500 },
      { kind: "percent", percent: 10, tipCents: 1000 },
      { kind: "percent", percent: 15, tipCents: 1500 },
      { kind: "percent", percent: 20, tipCents: 2000 },
      { kind: "custom" },
    ]);
  });

  it("[A] Propina libre muestra su porcentaje sin rechazarla", () => {
    // Dado una orden de $180.00, cuando capturo "Otro" con $37.00,
    // entonces la propina es $37.00 y se muestra "20.6 %"
    expect(tipPercentLabel(3700, 18000)).toBe("20.6 %");
    expect(amountDue(18000, 3700)).toEqual({
      baseCents: 18000,
      tipCents: 3700,
      totalDueCents: 21700,
    });
  });

  it("[A] La propina no se suma dos veces", () => {
    // Dado una orden de $100.00 con propina de $10.00,
    // entonces subtotal $100.00, propina $10.00 y total $110.00
    expect(amountDue(10000, 1000)).toEqual({
      baseCents: 10000,
      tipCents: 1000,
      totalDueCents: 11000,
    });
  });

  it("[A] La propina sugerida se redondea al centavo", () => {
    // Dado una orden de $45.50, cuando elijo 15 %,
    // entonces la propina es $6.83 (682.5 centavos suben)
    expect(suggestedTipCents(4550, 15)).toBe(683);
  });

  it("[A] El porcentaje de una propina libre sobre $0 no se muestra", () => {
    // Dado una orden de $0.00, cuando capturo "Otro" con $10.00,
    // entonces la propina es $10.00 y el porcentaje es "—"
    expect(tipPercentLabel(1000, 0)).toBe("—");
    expect(amountDue(0, 1000).totalDueCents).toBe(1000);
  });

  it.each([
    ["negative base", () => suggestedTipCents(-1, 10)],
    ["fractional base", () => suggestedTipCents(10.5, 10)],
    ["negative tip", () => amountDue(10000, -100)],
    ["fractional tip", () => tipPercentLabel(0.5, 10000)],
  ])("rejects invalid centavos: %s", (_label, call) => {
    expect(call).toThrow(RangeError);
  });
});
