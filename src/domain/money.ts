export type TaxBreakdown = {
  netCents: number;
  taxCents: number;
};

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

export function parsePesos(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}
