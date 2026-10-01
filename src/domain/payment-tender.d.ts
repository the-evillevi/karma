export type TenderMethod = "cash" | "card" | "transfer";

export interface EnteredTender {
  id: string | number;
  method: TenderMethod | "efectivo" | "tarjeta" | "transferencia";
  amount: string | number;
}

export interface CalculatedTenderPayment {
  id: string | number;
  method: TenderMethod;
  tenderedCents: number;
  netAmountCents: number;
  changeCents: number;
  tipCents: number;
}

export type TenderCalculation =
  | {
      valid: true;
      tenderedCents: number;
      netPaidCents: number;
      remainingCents: 0;
      changeCents: number;
      payments: CalculatedTenderPayment[];
    }
  | {
      valid: false;
      error: string;
      tenderedCents?: number;
      remainingCents?: number;
      changeCents?: number;
    };

export function moneyToCents(value: string | number): number;
export function calculateTender(
  totalDueCents: number,
  tenders: readonly EnteredTender[],
  options?: { tipCents?: number },
): TenderCalculation;

/** Additional exports from the existing JS payment module. */
export function centsToMoney(cents: number): number;
export function paymentNetCents(payment: unknown): number | null;
export function paymentMethodTotalsCents(
  sales: unknown,
): Record<string, number>;
