// Money helpers. Amounts are integer centavos; formatting is display-only.

export type TaxBreakdown = {
  /** Amount before IVA. */
  netCents: number;
  /** IVA contained in the total. */
  taxCents: number;
};

/** "$1,234.50" for 123450. Negative amounts render as "-$5.00". */
export function formatMXN(cents: number): string {
  void cents;
  throw new Error("not implemented");
}

/**
 * Splits a tax-inclusive total into net and IVA.
 * net = total / (1 + rate), rounded to the centavo (half up); tax = total - net.
 */
export function taxBreakdown(
  totalCents: number,
  taxRateBps: number,
): TaxBreakdown {
  void totalCents;
  void taxRateBps;
  throw new Error("not implemented");
}
