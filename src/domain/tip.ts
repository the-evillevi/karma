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

export function suggestedTipCents(baseCents: number, percent: number): number {
  validateCentavos(baseCents);
  return Math.floor((baseCents * percent * 2 + 100) / 200);
}

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

export function tipPercentLabel(tipCents: number, baseCents: number): string {
  validateCentavos(tipCents);
  validateCentavos(baseCents);
  if (baseCents === 0) return "—";
  const tenths = Math.floor((tipCents * 2000 + baseCents) / (baseCents * 2));
  return `${Math.floor(tenths / 10)}.${tenths % 10} %`;
}

export function amountDue(baseCents: number, tipCents: number): AmountDue {
  validateCentavos(baseCents);
  validateCentavos(tipCents);
  return { baseCents, tipCents, totalDueCents: baseCents + tipCents };
}
