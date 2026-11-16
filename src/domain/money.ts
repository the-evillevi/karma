// Money helpers. Amounts are integer centavos; formatting is display-only.

export type TaxBreakdown = {
  /** Amount before IVA. */
  netCents: number;
  /** IVA contained in the total. */
  taxCents: number;
};

/** "$1,234.50" for 123450. Negative amounts render as "-$5.00". */
export function formatMXN(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("Centavos must be a safe integer");
  }
  const amount = Math.abs(cents);
  const pesos = String(Math.floor(amount / 100));
  const groups: string[] = [];
  for (let end = pesos.length; end > 0; end -= 3) {
    groups.unshift(pesos.slice(Math.max(0, end - 3), end));
  }
  return `${cents < 0 ? "-" : ""}$${groups.join(",")}.${String(amount % 100).padStart(2, "0")}`;
}

/**
 * Splits a tax-inclusive total into net and IVA.
 * net = total / (1 + rate), rounded to the centavo (half up); tax = total - net.
 */
export function taxBreakdown(
  totalCents: number,
  taxRateBps: number,
): TaxBreakdown {
  if (
    !Number.isSafeInteger(totalCents) ||
    totalCents < 0 ||
    !Number.isSafeInteger(taxRateBps) ||
    taxRateBps < 0
  ) {
    throw new RangeError(
      "Total and tax rate must be non-negative safe integers",
    );
  }
  const divisor = 10000n + BigInt(taxRateBps);
  const netCents = Number(
    (BigInt(totalCents) * 20000n + divisor) / (2n * divisor),
  );
  return { netCents, taxCents: totalCents - netCents };
}

/**
 * Centavos from what a cashier types: "150", "150.5", "150.50", "$1,250.00".
 * Returns null when the text is not a non-negative peso amount with at most
 * two decimals. Uses no floating point.
 */
export function parsePesos(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}
