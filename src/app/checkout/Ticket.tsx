import { PAYMENT_METHOD_LABELS } from "../../domain/checkout.ts";
import type { Order } from "../../domain/journal.ts";
import { formatMXN } from "../../domain/money.ts";
import { headerLabel } from "../../domain/order-header.ts";
import { lineTotalCents } from "../../domain/order.ts";
import { BUSINESS_NAME } from "../business.ts";
import { timeOfDay } from "../clock.ts";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function dateOf(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

export function Ticket({ order }: { order: Order }) {
  const sale = order.sale;
  if (!sale) return null;
  const { settlement, totals } = sale;
  const cash = settlement.method === "cash";

  return (
    <article
      aria-label={`Ticket ${order.folio}`}
      className="mx-auto flex w-full max-w-xs flex-col gap-3 rounded-[var(--radius-control)] border border-border bg-white p-4 font-mono text-xs text-foreground"
    >
      <header className="flex flex-col items-center gap-1 text-center">
        <p className="font-display text-2xl leading-none">{BUSINESS_NAME}</p>
        <p>Folio {order.folio}</p>
        <p>
          {dateOf(sale.closedAt)} · {timeOfDay(sale.closedAt)}
        </p>
        <p>
          {headerLabel(order.header)} · Atendió {sale.closedBy.name}
        </p>
      </header>

      <ul className="flex flex-col gap-2 border-y border-dashed border-border py-3">
        {order.lines.map((line) => (
          <li key={line.lineId} className="flex flex-col">
            <div className="flex items-baseline justify-between gap-4">
              <span>
                {line.quantity} × {line.name}
              </span>
              <span className="tabular-nums">
                {formatMXN(lineTotalCents(line))}
              </span>
            </div>
            {line.modifiers.length > 0 && (
              <span className="pl-4 text-muted-foreground">
                {line.modifiers.map((modifier) => modifier.name).join(", ")}
              </span>
            )}
          </li>
        ))}
      </ul>

      <dl className="flex flex-col gap-1">
        <Row label="Total" value={formatMXN(totals.totalCents)} />
        <Row label="Base" value={formatMXN(totals.netCents)} />
        <Row label="IVA 16 %" value={formatMXN(totals.taxCents)} />
        <Row label="Propina" value={formatMXN(sale.tipCents)} />
        <div className="flex items-baseline justify-between gap-4 border-t border-dashed border-border pt-1 text-sm font-bold">
          <dt>Total a liquidar</dt>
          <dd className="tabular-nums">
            {formatMXN(settlement.amountDueCents)}
          </dd>
        </div>
        <Row
          label={PAYMENT_METHOD_LABELS[settlement.method]}
          value={formatMXN(
            cash ? settlement.receivedCents : settlement.netCents,
          )}
        />
        {cash && (
          <Row label="Cambio" value={formatMXN(settlement.changeCents)} />
        )}
      </dl>
      <p className="text-center text-muted-foreground">
        Precios con IVA incluido
      </p>
    </article>
  );
}
