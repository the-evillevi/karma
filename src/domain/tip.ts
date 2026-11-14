// Tips for checkout (EVL-123 [A]). Money is integer centavos.

export const TIP_SUGGESTIONS = [5, 10, 15, 20] as const;

export type TipSuggestion = (typeof TIP_SUGGESTIONS)[number];

export type TipOption =
  | { kind: "percent"; percent: TipSuggestion; tipCents: number }
  | { kind: "custom" };

export type AmountDue = {
  baseCents: number;
  tipCents: number;
  totalDueCents: number;
};

function validateCentavos(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Centavos must be a non-negative safe integer");
  }
}

/** Suggested tip for `percent` of the base, rounded to the centavo (half-up). */
export function suggestedTipCents(baseCents: number, percent: number): number {
  validateCentavos(baseCents);
  return Math.floor((baseCents * percent * 2 + 100) / 200);
}

/** The 5/10/15/20 % suggestions for this base, followed by a custom option. */
export function tipOptions(baseCents: number): TipOption[] {
  return [
    ...TIP_SUGGESTIONS.map((percent): TipOption => ({
      kind: "percent",
      percent,
      tipCents: suggestedTipCents(baseCents, percent),
    })),
    { kind: "custom" },
  ];
}

/** The tip as a percentage of the base, one decimal (e.g. "20.6 %"); "—" when the base is 0. */
export function tipPercentLabel(tipCents: number, baseCents: number): string {
  validateCentavos(tipCents);
  validateCentavos(baseCents);
  if (baseCents === 0) return "—";
  const tenths = Math.floor((tipCents * 2000 + baseCents) / (baseCents * 2));
  return `${Math.floor(tenths / 10)}.${tenths % 10} %`;
}

/** Amount to settle: base plus tip, counting the tip once. */
export function amountDue(baseCents: number, tipCents: number): AmountDue {
  validateCentavos(baseCents);
  validateCentavos(tipCents);
  return { baseCents, tipCents, totalDueCents: baseCents + tipCents };
}
