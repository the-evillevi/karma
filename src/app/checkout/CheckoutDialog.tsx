import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PAYMENT_METHOD_LABELS } from "../../domain/checkout.ts";
import type { CloseSaleInput } from "../../domain/checkout.ts";
import type { Order } from "../../domain/journal.ts";
import { formatMXN, parsePesos } from "../../domain/money.ts";
import { headerLabel } from "../../domain/order-header.ts";
import { orderTotals } from "../../domain/order.ts";
import { PaymentRejectedError, settle } from "../../domain/payment.ts";
import type { PaymentMethod, Settlement } from "../../domain/payment.ts";
import {
  amountDue,
  suggestedTipCents,
  tipOptions,
  tipPercentLabel,
} from "../../domain/tip.ts";

type CheckoutDialogProps = {
  order: Order;
  taxRateBps: number;
  onCancel: () => void;
  /** Resolves when the sale is closed; rejects with the error to show. */
  onConfirm: (input: CloseSaleInput) => Promise<void>;
  errorText: (error: unknown) => string;
};

type TipChoice = "none" | "custom" | number;

const METHODS: PaymentMethod[] = ["cash", "card", "transfer"];

const chipClass =
  "inline-flex min-h-11 flex-col items-center justify-center rounded-[var(--radius-button)] border border-border bg-card px-2 text-sm leading-tight outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring";
const activeChip =
  "border-primary bg-primary font-medium text-primary-foreground";

export function CheckoutDialog({
  order,
  taxRateBps,
  onCancel,
  onConfirm,
  errorText,
}: CheckoutDialogProps) {
  const totals = orderTotals(order.lines, taxRateBps);
  const [tipChoice, setTipChoice] = useState<TipChoice>("none");
  const [customTip, setCustomTip] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [received, setReceived] = useState("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);

  const options = tipOptions(totals.totalCents);
  const customTipCents = parsePesos(customTip);
  const tipCents =
    tipChoice === "none"
      ? 0
      : tipChoice === "custom"
        ? customTipCents
        : suggestedTipCents(totals.totalCents, tipChoice);
  const due =
    tipCents === null
      ? null
      : amountDue(totals.totalCents, tipCents).totalDueCents;

  // Card and transfer are charged for the exact amount; only cash is typed.
  const receivedCents = method === "cash" ? parsePesos(received) : due;
  let settlement: Settlement | null = null;
  let problem = "";
  if (due === null) {
    problem = "Captura la propina en pesos, por ejemplo 37 o 37.50.";
  } else if (receivedCents === null) {
    problem =
      received.trim() === ""
        ? "Captura el efectivo recibido."
        : "Captura el efectivo en pesos, por ejemplo 200 o 200.50.";
  } else {
    try {
      settlement = settle(due, { method, receivedCents });
      if (!settlement.canConfirm) {
        problem = `Faltan ${formatMXN(settlement.pendingCents)} para cubrir el total.`;
      }
    } catch (error) {
      if (!(error instanceof PaymentRejectedError)) throw error;
      problem = errorText(error);
    }
  }
  const canConfirm = settlement?.canConfirm === true && !busy;

  async function confirm() {
    if (
      !settlement?.canConfirm ||
      tipCents === null ||
      receivedCents === null
    ) {
      return;
    }
    setBusy(true);
    setFailure("");
    try {
      await onConfirm({
        orderId: order.orderId,
        tipCents,
        payment: { method, receivedCents },
      });
    } catch (error) {
      setFailure(errorText(error));
      setBusy(false);
    }
  }

  const quickCash =
    due === null
      ? []
      : [
          ...new Set([
            due,
            ...[5000, 10000, 20000, 50000].map(
              (bill) => Math.ceil(due / bill) * bill,
            ),
          ]),
        ].slice(0, 4);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="flex max-h-[95dvh] flex-col gap-4 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cobrar {order.folio}</DialogTitle>
          <DialogDescription>
            {headerLabel(order.header)} · {totals.itemCount}{" "}
            {totals.itemCount === 1 ? "producto" : "productos"}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1">
          <fieldset
            role="radiogroup"
            aria-label="Propina"
            className="flex flex-col gap-2"
          >
            <legend className="pb-2 text-sm font-medium">Propina</legend>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                role="radio"
                aria-checked={tipChoice === "none"}
                onClick={() => setTipChoice("none")}
                className={cn(chipClass, tipChoice === "none" && activeChip)}
              >
                Sin propina
              </button>
              {options.map((option) =>
                option.kind === "percent" ? (
                  <button
                    key={option.percent}
                    type="button"
                    role="radio"
                    aria-checked={tipChoice === option.percent}
                    aria-label={`${option.percent} % ${formatMXN(option.tipCents)}`}
                    onClick={() => setTipChoice(option.percent)}
                    className={cn(
                      chipClass,
                      tipChoice === option.percent && activeChip,
                    )}
                  >
                    <span>{option.percent} %</span>
                    <span className="text-xs tabular-nums">
                      {formatMXN(option.tipCents)}
                    </span>
                  </button>
                ) : (
                  <button
                    key="custom"
                    type="button"
                    role="radio"
                    aria-checked={tipChoice === "custom"}
                    onClick={() => setTipChoice("custom")}
                    className={cn(
                      chipClass,
                      tipChoice === "custom" && activeChip,
                    )}
                  >
                    Otro
                  </button>
                ),
              )}
            </div>
            {tipChoice === "custom" && (
              <div className="flex items-end gap-3">
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor="custom-tip">Propina en pesos</Label>
                  <Input
                    id="custom-tip"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={customTip}
                    onChange={(event) => setCustomTip(event.target.value)}
                  />
                </div>
                <p
                  data-testid="tip-percent"
                  className="pb-3 text-sm text-muted-foreground tabular-nums"
                >
                  {customTipCents === null
                    ? "—"
                    : tipPercentLabel(customTipCents, totals.totalCents)}
                </p>
              </div>
            )}
          </fieldset>

          <dl className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-background p-3 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd data-testid="checkout-subtotal" className="tabular-nums">
                {formatMXN(totals.totalCents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Propina</dt>
              <dd data-testid="checkout-tip" className="tabular-nums">
                {tipCents === null ? "—" : formatMXN(tipCents)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <dt className="font-medium">Total a liquidar</dt>
              <dd
                data-testid="checkout-due"
                className="font-display text-3xl leading-none tabular-nums"
              >
                {due === null ? "—" : formatMXN(due)}
              </dd>
            </div>
          </dl>

          <fieldset
            role="radiogroup"
            aria-label="Método de pago"
            className="flex flex-col gap-2"
          >
            <legend className="pb-2 text-sm font-medium">Método de pago</legend>
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  role="radio"
                  aria-checked={method === candidate}
                  onClick={() => setMethod(candidate)}
                  className={cn(chipClass, method === candidate && activeChip)}
                >
                  {PAYMENT_METHOD_LABELS[candidate]}
                </button>
              ))}
            </div>
            {method === "card" && (
              <p className="text-sm text-muted-foreground">
                Cobra {due === null ? "el total" : formatMXN(due)} en la
                terminal y registra aquí el pago. Karma no se conecta a la
                terminal.
              </p>
            )}
            {method === "transfer" && (
              <p className="text-sm text-muted-foreground">
                Confirma que recibiste la transferencia por{" "}
                {due === null ? "el total" : formatMXN(due)} antes de registrar.
              </p>
            )}
          </fieldset>

          {method === "cash" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="cash-received">Efectivo recibido</Label>
              <Input
                id="cash-received"
                inputMode="decimal"
                placeholder="0.00"
                value={received}
                onChange={(event) => setReceived(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {quickCash.map((amount) => (
                  <Button
                    key={amount}
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setReceived(formatMXN(amount).slice(1).replace(/,/g, ""))
                    }
                  >
                    {formatMXN(amount)}
                  </Button>
                ))}
              </div>
              <div className="flex items-baseline justify-between text-sm">
                <span>Cambio</span>
                <span
                  data-testid="checkout-change"
                  className="text-xl font-medium tabular-nums"
                >
                  {formatMXN(settlement?.changeCents ?? 0)}
                </span>
              </div>
            </div>
          )}

          <p role="alert" className="min-h-5 text-sm font-medium">
            {failure || (canConfirm || busy ? "" : problem)}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Seguir capturando
          </Button>
          <Button onClick={confirm} disabled={!canConfirm}>
            {busy ? "Registrando…" : "Registrar pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
