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

/** Suggested tip for `percent` of the base, rounded to the centavo (half-up). */
export function suggestedTipCents(baseCents: number, percent: number): number {
  void baseCents;
  void percent;
  throw new Error("not implemented");
}

/** The 5/10/15/20 % suggestions for this base, followed by a custom option. */
export function tipOptions(baseCents: number): TipOption[] {
  void baseCents;
  throw new Error("not implemented");
}

/** The tip as a percentage of the base, one decimal (e.g. "20.6 %"); "—" when the base is 0. */
export function tipPercentLabel(tipCents: number, baseCents: number): string {
  void tipCents;
  void baseCents;
  throw new Error("not implemented");
}

/** Amount to settle: base plus tip, counting the tip once. */
export function amountDue(baseCents: number, tipCents: number): AmountDue {
  void baseCents;
  void tipCents;
  throw new Error("not implemented");
}
